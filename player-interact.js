// @ts-nocheck
/**
 * DRAGON WORLD Z — Player Interact System v1.0.0
 *
 * Permite clickear/tocar a cualquier jugador en pantalla para abrir
 * un menú contextual con acciones: Invitar a party, Ver perfil, etc.
 *
 * Se integra con el sistema existente sin modificar game.html:
 *   - Lee otherPlayers y cam de window (ya expuestos globalmente)
 *   - Usa screenToWorld de game.html si está disponible
 *   - Escribe en Firebase path: partyInvites/{targetId}
 *   - Llama a PvpSystem.sendPartyInvite si está disponible
 */

"use strict";

(function () {

  // ── Hitbox de cada jugador (en coords de mundo, centrado en p.x, pie en p.y)
  const HIT_W  = 60;  // ancho del hitbox en px de mundo
  const HIT_H  = 140; // alto del hitbox en px de mundo

  // ── Estado del menú contextual abierto
  let _openMenu    = null; // { id, el }
  let _tapTimer    = null; // para distinguir tap de drag en mobile

  // ── Helpers
  const G = {
    get canvas()  { return document.getElementById("gameCanvas"); },
    get cam()     { return window.cam || { x: 0, y: 0, zoom: 1 }; },
    get others()  { return window.otherPlayers || {}; },
    get myId()    { return window.myPlayerId; },
    get myPlayer(){ return window.player; },
    get db()      { return window.db; },
    get online()  { return window.mpConnected; },
  };

  function toast(msg, type) {
    if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
  }

  function isPartyMember(id) {
    return !!(window.PvpSystem?.isPartyMember?.(id));
  }

  function isInParty() {
    try {
      const ids = window.PvpSystem?.getPartyMemberIds?.() || [];
      return ids.length > 0;
    } catch(e) { return false; }
  }

  // ── Convierte coordenadas de pantalla → mundo (replica screenToWorld de game.html)
  function _screenToWorld(clientX, clientY) {
    if (typeof window.screenToWorld === "function") {
      return window.screenToWorld(clientX, clientY);
    }
    const canvas = G.canvas;
    if (!canvas) return { x: clientX, y: clientY };
    const rect = canvas.getBoundingClientRect();
    const sx   = (clientX - rect.left) * (canvas.width  / rect.width);
    const sy   = (clientY - rect.top)  * (canvas.height / rect.height);
    const z    = G.cam.zoom || 1;
    return {
      x: ((sx - canvas.width  / 2) / z) + canvas.width  / 2 + G.cam.x,
      y: ((sy - canvas.height / 2) / z) + canvas.height / 2 + G.cam.y,
    };
  }

  // ── Busca el jugador clickeado más cercano en las coords de mundo dadas
  function _getPlayerAtWorld(wx, wy) {
    const others = G.others;
    let best     = null;
    let bestDist = Infinity;

    for (const [id, p] of Object.entries(others)) {
      if (p.fusionHidden) continue;
      if (p.inTrailerDrive) continue;
      if (id === G.myId) continue;
      // Hitbox: centrado en p.x, pie en p.y, alto HIT_H
      const left   = p.x - HIT_W  / 2;
      const right  = p.x + HIT_W  / 2;
      const bottom = p.y;
      const top    = p.y - HIT_H;
      if (wx >= left && wx <= right && wy >= top && wy <= bottom) {
        const dist = Math.hypot(wx - p.x, wy - (p.y - HIT_H / 2));
        if (dist < bestDist) { best = { id, p }; bestDist = dist; }
      }
    }
    return best;
  }

  // ════════════════════════════════════════════════════════
  //  MENÚ CONTEXTUAL
  // ════════════════════════════════════════════════════════

  function _closeMenu() {
    if (_openMenu) {
      _openMenu.el.remove();
      _openMenu = null;
    }
  }

  function _openPlayerMenu(id, p, screenX, screenY) {
    _closeMenu();

    const name        = p.name || "?";
    const level       = p.level ? `Lv.${p.level}` : "";
    const inParty     = isPartyMember(id);
    const partyFull   = (() => {
      try { return (window.PvpSystem?.getPartyMemberIds?.() || []).length >= 4; } catch(e) { return false; }
    })();

    // ── Construir acciones disponibles
    const actions = [];

    // Invitar a party
    if (!inParty) {
      actions.push({
        icon:     "⚔️",
        label:    "Invitar a Party",
        disabled: partyFull,
        hint:     partyFull ? "Party llena (máx 4)" : null,
        fn:       () => _sendPartyInvite(id, p),
      });
    } else {
      actions.push({
        icon:  "✓",
        label: "En tu party",
        disabled: true,
      });
    }

    // Desafío PvP (si el pvp-system lo expone)
    if (typeof window.PvpSystem?.sendChallenge === "function") {
      actions.push({
        icon:  "🥊",
        label: "Desafiar a combate",
        fn:    () => window.PvpSystem.sendChallenge(id),
      });
    }

    // Proponer fusión (si fusion-system está cargado)
    if (typeof window.FusionSystem?.proposeFusion === "function" && inParty) {
      actions.push({
        icon:  "⚡",
        label: "Proponer Fusión Metamoru",
        fn:    () => window.FusionSystem.proposeFusion("metamoru", id),
      });
      actions.push({
        icon:  "💍",
        label: "Proponer Fusión Potara",
        fn:    () => window.FusionSystem.proposeFusion("potara", id),
      });
    }

    if (actions.length === 0) return; // nada que mostrar

    // ── Crear elemento del menú
    const el  = document.createElement("div");
    el.id     = "playerContextMenu";
    el.style.cssText = `
      position: fixed;
      z-index: 300;
      background: rgba(8, 9, 15, 0.97);
      border: 1px solid rgba(0, 229, 255, 0.35);
      border-radius: 10px;
      padding: 10px 0 6px;
      min-width: 210px;
      font-family: Orbitron, monospace;
      color: #fff;
      box-shadow: 0 0 24px rgba(0, 229, 255, 0.18), 0 4px 20px rgba(0,0,0,.6);
      pointer-events: auto;
      user-select: none;
    `;

    // Cabecera con nombre
    const auraColor = p.appearance?.auraColor || p.charColor || "#00e5ff";
    el.innerHTML = `
      <div style="padding:0 14px 8px;border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:6px">
        <div style="font-size:11px;font-weight:bold;color:${auraColor};letter-spacing:1px;
                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">
          ${name}
        </div>
        ${level ? `<div style="font-size:8px;color:#5a7aaa;letter-spacing:1px;margin-top:1px">${level}</div>` : ""}
      </div>
      <div id="_picmActions"></div>
    `;

    const actContainer = el.querySelector("#_picmActions");
    actions.forEach(a => {
      const btn = document.createElement("button");
      btn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 14px;
        background: none;
        border: none;
        color: ${a.disabled ? "#444" : "#c8cfe8"};
        font-family: Orbitron, monospace;
        font-size: 9px;
        letter-spacing: 0.5px;
        cursor: ${a.disabled ? "default" : "pointer"};
        text-align: left;
        transition: background 0.12s;
      `;
      btn.innerHTML = `
        <span style="font-size:14px;opacity:${a.disabled ? 0.3 : 1}">${a.icon || "●"}</span>
        <span>${a.label}</span>
        ${a.hint ? `<span style="margin-left:auto;font-size:8px;color:#ff7043">${a.hint}</span>` : ""}
      `;
      if (!a.disabled && a.fn) {
        btn.onmouseenter = () => { btn.style.background = "rgba(0,229,255,0.07)"; };
        btn.onmouseleave = () => { btn.style.background = "none"; };
        btn.onclick = (e) => {
          e.stopPropagation();
          _closeMenu();
          a.fn();
        };
      }
      actContainer.appendChild(btn);
    });

    document.body.appendChild(el);

    // ── Posicionar el menú (ajustar si se sale de pantalla)
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 220, mh = el.offsetHeight || 160;
    let mx = screenX + 10;
    let my = screenY - 20;
    if (mx + mw > vw - 8) mx = screenX - mw - 10;
    if (my + mh > vh - 8) my = vh - mh - 8;
    if (my < 8)           my = 8;
    el.style.left = mx + "px";
    el.style.top  = my + "px";

    _openMenu = { id, el };
  }

  // ════════════════════════════════════════════════════════
  //  ACCIONES
  // ════════════════════════════════════════════════════════

  function _sendPartyInvite(targetId, p) {
    if (!G.online || !G.myId) return toast("Conectate al servidor primero", "dmg");

    const targetName = p.name || "?";

    // 1. Intentar usar la API del PvpSystem si la expone
    if (typeof window.PvpSystem?.sendPartyInvite === "function") {
      window.PvpSystem.sendPartyInvite(targetId);
      toast(`Invitación enviada a ${targetName}`, "info");
      return;
    }

    // 2. Fallback: escribir directo en Firebase path partyInvites/{targetId}
    if (!G.db) return toast("Sin conexión a la base de datos", "dmg");

    const myName = G.myPlayer?.name || "?";
    G.db.ref("partyInvites/" + targetId).set({
      fromId:   G.myId,
      fromName: myName,
      t:        Date.now(),
    });
    toast(`Invitación de party enviada a ${targetName}`, "info");
  }

  // ════════════════════════════════════════════════════════
  //  LISTENERS PARA INVITACIONES RECIBIDAS
  //  (por si el PvpSystem no las maneja, las escuchamos nosotros)
  // ════════════════════════════════════════════════════════

  let _inviteListener = null;

  function _listenIncomingInvites() {
    if (!G.db || !G.myId) {
      setTimeout(_listenIncomingInvites, 500);
      return;
    }
    // Si el PvpSystem ya maneja partyInvites, no necesitamos hacer nada aquí.
    // Pero si no, mostramos el modal de aceptar/rechazar.
    if (_inviteListener) _inviteListener.off();
    _inviteListener = G.db.ref("partyInvites/" + G.myId);
    _inviteListener.on("value", snap => {
      const inv = snap.val();
      if (!inv || !inv.fromId) return;
      // Ignorar invitaciones antiguas (>20s)
      if (Date.now() - (inv.t || 0) > 20000) {
        snap.ref.remove();
        return;
      }
      // Si el PvpSystem ya está manejando la invitación (tiene su propio listener), salir
      if (window.PvpSystem?._handlesPartyInvites) return;

      _showInviteModal(inv, snap.ref);
    });
  }

  function _showInviteModal(inv, ref) {
    if (document.getElementById("picmInviteModal")) return;
    const el = document.createElement("div");
    el.id    = "picmInviteModal";
    el.style.cssText = `
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      z-index: 310;
      background: rgba(8, 9, 15, 0.97);
      border: 1px solid #00e5ff;
      border-radius: 12px;
      padding: 20px 24px;
      text-align: center;
      font-family: Orbitron, monospace;
      color: #fff;
      min-width: 260px;
      box-shadow: 0 0 30px rgba(0,229,255,0.3);
      pointer-events: auto;
    `;
    el.innerHTML = `
      <div style="font-size:9px;letter-spacing:2px;color:#00e5ff;margin-bottom:6px">INVITACIÓN DE PARTY</div>
      <div style="font-size:12px;margin-bottom:14px">
        <b style="color:#f5c400">${inv.fromName || "?"}</b> te invita a su party
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="picmAcceptBtn"
          style="padding:10px 20px;background:rgba(0,229,255,.15);border:1px solid #00e5ff;
                 border-radius:6px;color:#00e5ff;font-family:Orbitron,monospace;
                 font-size:9px;letter-spacing:1px;cursor:pointer">✓ UNIRSE</button>
        <button id="picmDeclineBtn"
          style="padding:10px 20px;background:rgba(255,23,68,.15);border:1px solid #ff5252;
                 border-radius:6px;color:#ff5252;font-family:Orbitron,monospace;
                 font-size:9px;letter-spacing:1px;cursor:pointer">✕ RECHAZAR</button>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById("picmAcceptBtn").onclick = () => {
      el.remove();
      ref.remove();
      // Intentar unirse via PvpSystem
      if (typeof window.PvpSystem?.joinParty === "function") {
        window.PvpSystem.joinParty(inv.fromId);
      } else {
        // Fallback: escribir en partyAccept/{fromId} para que el iniciador lo lea
        if (G.db) {
          G.db.ref("partyAccept/" + inv.fromId).set({
            fromId:   G.myId,
            fromName: G.myPlayer?.name || "?",
            t:        Date.now(),
          });
        }
      }
      toast(`Te uniste a la party de ${inv.fromName}`, "xp");
    };

    document.getElementById("picmDeclineBtn").onclick = () => {
      el.remove();
      ref.remove();
      toast("Invitación rechazada", "info");
    };

    // Auto-cerrar en 15s
    setTimeout(() => {
      if (document.getElementById("picmInviteModal")) {
        el.remove();
        ref.remove();
      }
    }, 15000);
  }

  // ════════════════════════════════════════════════════════
  //  EVENTOS EN EL CANVAS
  // ════════════════════════════════════════════════════════

  function _onCanvasPointerDown(e) {
    // Solo funcionar en estado "playing" (no en combate, menús, etc.)
    if (window.gameState && window.gameState !== "playing") return;
    // No interferir con el clic en NPCs de combate (sala_entrenamiento / simulador_combate)
    const map = window.currentMap || "";
    if (map === "simulador_combate" || map === "sala_entrenamiento") return;
    // No procesar si hay otro modal abierto consumiendo el click
    if (e.target !== G.canvas) return;

    const wx = _screenToWorld(e.clientX, e.clientY);
    // Guardar posición y tiempo para distinguir tap de drag
    e._picm_startX    = e.clientX;
    e._picm_startY    = e.clientY;
    e._picm_startTime = Date.now();
    e._picm_worldHit  = _getPlayerAtWorld(wx.x, wx.y);
  }

  function _onCanvasPointerUp(e) {
    if (window.gameState && window.gameState !== "playing") return;
    const map = window.currentMap || "";
    if (map === "simulador_combate" || map === "sala_entrenamiento") return;
    if (e.target !== G.canvas) return;

    const hit = e._picm_worldHit;
    if (!hit) {
      // Click en vacío → cerrar menú abierto
      _closeMenu();
      return;
    }

    // Verificar que no fue un drag (movimiento)
    const dx    = Math.abs(e.clientX - (e._picm_startX || e.clientX));
    const dy    = Math.abs(e.clientY - (e._picm_startY || e.clientY));
    const dt    = Date.now() - (e._picm_startTime || Date.now());
    const isDrag = dx > 12 || dy > 12 || dt > 600;
    if (isDrag) { _closeMenu(); return; }

    e.stopPropagation();
    e.preventDefault();
    _openPlayerMenu(hit.id, hit.p, e.clientX, e.clientY);
  }

  // Para pointerdown necesitamos asociar el hit al evento — usamos un WeakMap
  // ya que los eventos no son el mismo objeto en pointerdown y pointerup.
  // Solución: guardamos en una variable compartida el último pointerdown.
  let _lastPointerDown = null;

  function _initCanvasListeners() {
    const canvas = G.canvas;
    if (!canvas) { setTimeout(_initCanvasListeners, 300); return; }

    canvas.addEventListener("pointerdown", (e) => {
      if (window.gameState && window.gameState !== "playing") return;
      const map = window.currentMap || "";
      if (map === "simulador_combate" || map === "sala_entrenamiento") return;
      if (e.target !== canvas) return;

      const w = _screenToWorld(e.clientX, e.clientY);
      _lastPointerDown = {
        clientX: e.clientX,
        clientY: e.clientY,
        time:    Date.now(),
        hit:     _getPlayerAtWorld(w.x, w.y),
      };
    }, { capture: false, passive: true });

    canvas.addEventListener("pointerup", (e) => {
      if (!_lastPointerDown) return;
      if (window.gameState && window.gameState !== "playing") return;
      const map = window.currentMap || "";
      if (map === "simulador_combate" || map === "sala_entrenamiento") return;
      if (e.target !== canvas) return;

      const down = _lastPointerDown;
      _lastPointerDown = null;

      if (!down.hit) {
        // Click en vacío
        if (_openMenu) _closeMenu();
        return;
      }

      const dx     = Math.abs(e.clientX - down.clientX);
      const dy     = Math.abs(e.clientY - down.clientY);
      const dt     = Date.now() - down.time;
      const isDrag = dx > 14 || dy > 14 || dt > 700;
      if (isDrag) { _closeMenu(); return; }

      e.stopPropagation();
      _openPlayerMenu(down.hit.id, down.hit.p, e.clientX, e.clientY);
    }, { capture: false });

    // Cerrar con click fuera del menú
    document.addEventListener("pointerdown", (e) => {
      if (!_openMenu) return;
      if (_openMenu.el.contains(e.target)) return;
      _closeMenu();
    }, { capture: true, passive: true });

    // Cerrar con Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && _openMenu) _closeMenu();
    });
  }

  // ════════════════════════════════════════════════════════
  //  CURSOR — hint visual al pasar por encima de un jugador
  // ════════════════════════════════════════════════════════

  function _initHoverCursor() {
    const canvas = G.canvas;
    if (!canvas) return;

    canvas.addEventListener("pointermove", (e) => {
      if (window.gameState && window.gameState !== "playing") return;
      const map = window.currentMap || "";
      if (map === "simulador_combate" || map === "sala_entrenamiento") return;
      if (e.target !== canvas) return;

      const w   = _screenToWorld(e.clientX, e.clientY);
      const hit = _getPlayerAtWorld(w.x, w.y);
      canvas.style.cursor = hit ? "pointer" : "";
    }, { passive: true });
  }

  // ════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════

  function _waitForGame(cb, n) {
    n = n || 0;
    if (n > 400) return;
    if (window.db && window.myPlayerId && window.player && window.otherPlayers !== undefined) {
      cb();
      return;
    }
    setTimeout(() => _waitForGame(cb, n + 1), 150);
  }

  function main() {
    _initCanvasListeners();
    _initHoverCursor();
    _listenIncomingInvites();

    // Exponer API pública
    window.PlayerInteractSystem = {
      openMenuForPlayer: (id) => {
        const p = window.otherPlayers?.[id];
        if (!p) return;
        const canvas = G.canvas;
        if (!canvas) return;
        // Abrir el menú en el centro de la pantalla como fallback
        _openPlayerMenu(id, p, window.innerWidth / 2, window.innerHeight / 2);
      },
    };

    console.log("[player-interact] Sistema de interacción con jugadores listo");
  }

  _waitForGame(main);

})();
