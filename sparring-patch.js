/**
 * DRAGON WORLD Z — Sparring System Patch v1.0
 * ─────────────────────────────────────────────
 * INSTALACIÓN: agregar este <script> al final de game.html,
 * justo ANTES del cierre </body>, después de todos los otros scripts.
 *
 *   <script src="sparring-patch.js"></script>
 *
 * QUÉ HACE:
 *  1. Al aceptar una invitación de party → activa automáticamente modo "partyCombat"
 *  2. performPartyAction('sparring') → calcula daño real basado en STR/DEF
 *  3. El golpe viaja por Firebase → el receptor activa animación "hurt" + descuenta HP
 *  4. Número de daño flotante aparece sobre el personaje que recibe
 *  5. Si HP llega a 0 → "K.O." con respawn automático a los 3 segundos
 *  6. Botón "RENDIRSE" en partyCombat para terminar el sparring limpiamente
 */

(function patchSparring() {
  "use strict";

  // ── Espera a que el juego esté listo (Firebase + player inicializados) ──────
  function waitForGame(cb, attempts) {
    attempts = attempts || 0;
    if (attempts > 120) { console.warn("[sparring] timeout esperando init"); return; }
    const ready =
      typeof window.db !== "undefined" &&
      typeof window.myPlayerId !== "undefined" && window.myPlayerId &&
      typeof window.player !== "undefined" && window.player.maxHp > 0;
    if (ready) { cb(); }
    else       { setTimeout(() => waitForGame(cb, attempts + 1), 250); }
  }

  waitForGame(init);

  // ════════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════════
  function init() {

    // ── Acceso seguro a variables globales del juego ──────────────────
    const G = {
      get db()            { return window.db; },
      get myId()          { return window.myPlayerId; },
      get player()        { return window.player; },
      get otherPlayers()  { return window.otherPlayers; },
      get combatEffects() { return window.combatEffects; },
      get csAnimator()    { return window.csAnimator; },
      get cam()           { return window.cam; },
      get isFlying()      { return window.isFlying; },
      get isPartyMember() { return window.isPartyMember; },
      get selectedPlayerId()          { return window.selectedPlayerId; },
      set selectedPlayerId(v)         { window.selectedPlayerId = v; },
      get mpConnected()               { return window.mpConnected; },
    };

    // ── Configuración de daño ─────────────────────────────────────────
    const DMG_CONFIG = {
      sparring:  { base: 0.08, variance: 0.04, kiCost: 5,  label: "SPARRING" },
      ki_clash:  { base: 0.12, variance: 0.05, kiCost: 18, label: "KI CLASH" },
      gut_hit:   { base: 0.10, variance: 0.03, kiCost: 8,  label: "ESTOMAGO" },
      face_hit:  { base: 0.09, variance: 0.06, kiCost: 6,  label: "CARA"     },
    };

    // Acciones que reciben daño (selfHit = el que ejecuta "recibe")
    const RECEIVE_ACTIONS = new Set(["take_gut", "take_face", "lose"]);

    // ── Cooldown por jugador para evitar spam ─────────────────────────
    const hitCooldowns = {};  // targetId → timestamp
    const HIT_COOLDOWN_MS = 600;

    // ── Rastreo de K.O. en curso ──────────────────────────────────────
    let myKoInProgress = false;

    // ════════════════════════════════════════════════════════════════════
    //  CÁLCULO DE DAÑO
    // ════════════════════════════════════════════════════════════════════
    function calcDamage(actionId, attackerStr, defenderDef, defenderMaxHp) {
      const cfg = DMG_CONFIG[actionId] || DMG_CONFIG.sparring;
      const variance = (Math.random() * cfg.variance * 2) - cfg.variance;
      const rawRatio  = cfg.base + variance;
      // Factor STR/DEF: más fuerza o menos defensa = más daño
      const statFactor = Math.max(0.5, Math.min(2.0, attackerStr / Math.max(1, defenderDef)));
      const dmg = Math.max(1, Math.round(defenderMaxHp * rawRatio * statFactor));
      return dmg;
    }

    // ════════════════════════════════════════════════════════════════════
    //  APLICAR DAÑO LOCAL (cuando me pegan a mí)
    // ════════════════════════════════════════════════════════════════════
    function applyDamageToSelf(dmg, actionId, attackerName) {
      const p = G.player;
      if (!p) return;

      p.hp = Math.max(0, p.hp - dmg);

      // Actualizar barra de HP en HUD
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Número de daño flotante sobre mi personaje (posición relativa al canvas)
      const canvas = document.getElementById("gameCanvas");
      if (canvas && G.cam) {
        const sx = p.x - G.cam.x;
        const sy = p.y - G.cam.y;
        spawnDamageNumber(sx, sy - 60, dmg, actionId === "ki_clash" ? "#00e5ff" : "#ff1744");
      }

      // Efecto en combatEffects (texto flotante del sistema existente)
      if (G.combatEffects) {
        G.combatEffects.push({ x:p.x, y:p.y - 55, text:`-${dmg}`, timer:1.5, color:"#ff1744" });
        G.combatEffects.push({ x:p.x, y:p.y - 36, text:(attackerName || "???") + " GOLPEA", timer:1.0, color:"#ffab91" });
      }

      // Animación hurt → vuelve a idle
      if (G.csAnimator) {
        G.csAnimator.play("hurt", () => {
          if (G.csAnimator) G.csAnimator.play(G.isFlying ? "fly" : "idle");
        });
      }

      // Flash rojo en la pantalla
      screenFlash("#ff1744", 0.35);

      // Toast de daño
      if (typeof window.showHudToast === "function") {
        window.showHudToast(`💥 -${dmg} HP de ${attackerName || "???"}`, "dmg");
      }

      // K.O.
      if (p.hp <= 0 && !myKoInProgress) handleKO(attackerName);

      // Publicar HP actualizado a Firebase
      if (G.mpConnected && G.myId) {
        G.db.ref("players/" + G.myId).update({ hp: p.hp, t: Date.now() });
      }
    }

    // ════════════════════════════════════════════════════════════════════
    //  K.O.
    // ════════════════════════════════════════════════════════════════════
    function handleKO(attackerName) {
      myKoInProgress = true;
      const p = G.player;

      if (G.csAnimator) G.csAnimator.play("death");

      if (typeof window.showHudToast === "function") {
        window.showHudToast(`💫 K.O. por ${attackerName || "???"}`, "dmg");
      }

      // Mensaje en chat
      if (G.mpConnected && G.myId) {
        G.db.ref("chat").push().set({
          id: G.myId,
          name: "SISTEMA",
          text: `💀 ${p.name} fue noqueado por ${attackerName || "???"} en el sparring.`,
          t: Date.now(),
        });
      }

      // Mostrar overlay de K.O.
      showKoOverlay(attackerName);

      // Respawn a los 3 segundos
      setTimeout(() => {
        p.hp = Math.floor(p.maxHp * 0.3);  // respawn con 30% HP
        myKoInProgress = false;
        hideKoOverlay();
        if (G.csAnimator) G.csAnimator.play("idle");
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (G.mpConnected && G.myId) {
          G.db.ref("players/" + G.myId).update({ hp: p.hp, t: Date.now() });
        }
        if (typeof window.showHudToast === "function") {
          window.showHudToast("⚡ Recuperado (30% HP)", "xp");
        }
      }, 3000);
    }

    // ════════════════════════════════════════════════════════════════════
    //  ENVIAR GOLPE A OBJETIVO (vía Firebase partyActions)
    // ════════════════════════════════════════════════════════════════════
    function sendHitToTarget(targetId, actionId, dmg) {
      if (!G.mpConnected || !G.myId) return;
      const p = G.player;

      // Cooldown anti-spam
      const now = Date.now();
      if (hitCooldowns[targetId] && now - hitCooldowns[targetId] < HIT_COOLDOWN_MS) return;
      hitCooldowns[targetId] = now;

      G.db.ref("partyActions/" + targetId).set({
        fromId:       G.myId,
        fromName:     p.name,
        type:         "sparringHit",
        actionId,
        dmg,
        attackerStr:  p.strength,
        anim:         "hurt",
        t:            now,
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  RECIBIR GOLPE ENTRANTE (listener de Firebase)
    //  ─ Se cuelga del partyActions listener ya existente en initMultiplayer()
    //  ─ Lo interceptamos extendiendo la lógica via monkey-patch del callback
    // ════════════════════════════════════════════════════════════════════
    function hookIncomingHits() {
      if (!G.myId || !G.db) return;

      G.db.ref("partyActions/" + G.myId).on("value", (snap) => {
        const act = snap.val();
        if (!act || act.fromId === G.myId) return;

        if (act.type === "sparringHit") {
          // Daño ya calculado por el atacante, lo aplicamos
          applyDamageToSelf(act.dmg || 1, act.actionId || "sparring", act.fromName || "???");
          G.db.ref("partyActions/" + G.myId).remove();
          return;
        }

        // ── Comportamiento original preservado ────────────────────────
        if (act.type === "pushBack") {
          G.player.x += Number(act.dx) || 0;
          if (G.combatEffects) {
            G.combatEffects.push({ x:G.player.x, y:G.player.y - 44, text:act.text || "PIERDE", timer:1.3, color:"#ff5252" });
          }
        } else if (act.type !== "sparringHit") {
          if (G.combatEffects) {
            G.combatEffects.push({ x:G.player.x, y:G.player.y - 50, text:act.icon || "✨", timer:1.2, color:"#f5c400" });
            G.combatEffects.push({ x:G.player.x, y:G.player.y - 32, text:act.text || "PARTY",  timer:1.0, color:"#00e5ff" });
          }
        }

        if (G.csAnimator && act.type !== "sparringHit") {
          G.csAnimator.play(act.anim || "hurt", () => {
            if (G.csAnimator) G.csAnimator.play(G.isFlying ? "fly" : "idle");
          });
        }
        G.db.ref("partyActions/" + G.myId).remove();
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE DE performPartyAction — agrega lógica de daño real
    // ════════════════════════════════════════════════════════════════════
    const _originalPerformPartyAction = window.performPartyAction;

    window.performPartyAction = function performPartyAction(actionId) {
      const cfg = DMG_CONFIG[actionId];
      const isReceiveAction = RECEIVE_ACTIONS.has(actionId);

      // Si no es acción de combate con daño, delegar al original
      if (!cfg && !isReceiveAction) {
        if (_originalPerformPartyAction) return _originalPerformPartyAction(actionId);
        return;
      }

      const targetId = (G.selectedPlayerId && G.otherPlayers[G.selectedPlayerId])
        ? G.selectedPlayerId
        : getNearestPartyMember();

      if (!targetId || !G.otherPlayers[targetId]) {
        if (typeof window.showHudToast === "function") {
          window.showHudToast("Selecciona un miembro de party", "info");
        }
        return;
      }

      if (!G.isPartyMember(targetId)) {
        if (typeof window.showHudToast === "function") {
          window.showHudToast("Solo funciona en party", "dmg");
        }
        return;
      }

      G.selectedPlayerId = targetId;
      const p        = G.player;
      const target   = G.otherPlayers[targetId];
      const midX     = (p.x + (target.x || p.x)) / 2;
      const midY     = (p.y + (target.y || p.y)) / 2;

      // ── Acciones de RECIBIR (selfHit) — el que pulsa recibe daño ────
      if (isReceiveAction) {
        const fakeDmg = Math.max(1, Math.round(p.maxHp * 0.08 * (0.8 + Math.random() * 0.4)));
        applyDamageToSelf(fakeDmg, actionId, target.name || "???");
        if (G.combatEffects) {
          G.combatEffects.push({ x:midX, y:midY - 50, text:"RECIBE", timer:1.2, color:"#ffab91" });
        }
        return;
      }

      // ── Ki cost ──────────────────────────────────────────────────────
      if (p.ki < cfg.kiCost) {
        if (typeof window.showHudToast === "function") {
          window.showHudToast(`⚡ Ki insuficiente (necesitás ${cfg.kiCost})`, "info");
        }
        return;
      }
      p.ki = Math.max(0, p.ki - cfg.kiCost);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // ── Calcular daño ────────────────────────────────────────────────
      const defenderMaxHp = target.maxHp || 500;
      const defenderDef   = target.defense || 80;
      const dmg = calcDamage(actionId, p.strength, defenderDef, defenderMaxHp);

      // ── Efectos visuales locales ──────────────────────────────────────
      const hitColors = { ki_clash:"#00e5ff", face_hit:"#ff5252", gut_hit:"#ff7043", sparring:"#f5c400" };
      const hitColor  = hitColors[actionId] || "#f5c400";
      if (G.combatEffects) {
        G.combatEffects.push({ x:midX, y:midY - 58, text:`-${dmg}`,        timer:1.6, color:"#ff1744" });
        G.combatEffects.push({ x:midX, y:midY - 36, text:cfg.label,         timer:1.0, color:hitColor   });
      }

      // Animación del atacante
      const animMap = { ki_clash:"ki_charge", sparring:"attack_1", gut_hit:"attack_1", face_hit:"attack_2" };
      if (G.csAnimator) {
        G.csAnimator.play(animMap[actionId] || "attack_1", () => {
          if (G.csAnimator) G.csAnimator.play(G.isFlying ? "fly" : "idle");
        });
      }

      // Flash leve en pantalla del atacante
      screenFlash(hitColor, 0.18);

      // Toast del atacante
      if (typeof window.showHudToast === "function") {
        window.showHudToast(`${cfg.label} → -${dmg} HP`, "xp");
      }

      // Publicar animación del atacante en Firebase
      if (G.mpConnected && G.myId) {
        G.db.ref("players/" + G.myId).update({
          animAction: animMap[actionId] || "attack_1",
          t: Date.now(),
        });
      }

      // ── Enviar golpe al objetivo ──────────────────────────────────────
      sendHitToTarget(targetId, actionId, dmg);
    };

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE DE acceptPartyInvite — activa partyCombat al entrar
    // ════════════════════════════════════════════════════════════════════
    const _originalAcceptPartyInvite = window.acceptPartyInvite;

    window.acceptPartyInvite = function acceptPartyInvite() {
      if (_originalAcceptPartyInvite) _originalAcceptPartyInvite();
      // Al entrar a la party, arrancar en modo combate directamente
      setTimeout(() => {
        if (typeof window.setControlMode === "function") {
          window.setControlMode("partyCombat");
          showSparringReadyBanner();
        }
      }, 400);
    };

    // ════════════════════════════════════════════════════════════════════
    //  UTILIDADES: UI
    // ════════════════════════════════════════════════════════════════════

    /** Número de daño flotante animado sobre el canvas (DOM overlay) */
    function spawnDamageNumber(canvasX, canvasY, dmg, color) {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const el = document.createElement("div");
      el.textContent = `-${dmg}`;
      el.style.cssText = `
        position:absolute;
        left:${canvasX - 24}px;
        top:${canvasY}px;
        font-family:'Orbitron',monospace;
        font-size:22px;
        font-weight:900;
        color:${color || "#ff1744"};
        text-shadow:0 0 10px ${color || "#ff1744"},0 2px 0 rgba(0,0,0,0.8);
        pointer-events:none;
        z-index:50;
        animation:spawnDmgNum 1.4s forwards;
      `;
      hud.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }

    /** Flash de pantalla rojo al recibir golpe */
    function screenFlash(color, opacity) {
      let overlay = document.getElementById("sparringFlashOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "sparringFlashOverlay";
        overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;transition:opacity 0.35s ease;opacity:0;";
        document.body.appendChild(overlay);
      }
      overlay.style.background = color || "#ff1744";
      overlay.style.opacity = String(opacity || 0.35);
      setTimeout(() => { overlay.style.opacity = "0"; }, 120);
    }

    /** Banner "¡SPARRING LISTO!" al entrar a la party */
    function showSparringReadyBanner() {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const banner = document.createElement("div");
      banner.style.cssText = `
        position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        font-family:'Orbitron',monospace;font-size:clamp(18px,4vw,32px);font-weight:900;
        letter-spacing:4px;color:#f5c400;
        text-shadow:0 0 20px #f5c400,0 0 40px #ff6a00;
        pointer-events:none;z-index:60;animation:spawnDmgNum 2.5s forwards;
        text-align:center;line-height:1.4;
      `;
      banner.innerHTML = "🥊 SPARRING INICIADO<br><span style='font-size:0.55em;color:#ff7043;letter-spacing:2px'>¡DAÑO REAL ACTIVADO!</span>";
      hud.appendChild(banner);
      setTimeout(() => banner.remove(), 2500);
    }

    /** Overlay de K.O. */
    function showKoOverlay(attackerName) {
      let overlay = document.getElementById("sparringKoOverlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "sparringKoOverlay";
        overlay.style.cssText = `
          position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
          justify-content:center;background:rgba(60,0,0,0.82);z-index:150;
          font-family:'Orbitron',monospace;text-align:center;
        `;
        overlay.innerHTML = `
          <div style="font-size:clamp(40px,10vw,80px);font-weight:900;color:#ff1744;
               text-shadow:0 0 40px #ff1744;letter-spacing:6px;margin-bottom:12px;">K.O.</div>
          <div id="sparringKoSub" style="font-size:clamp(12px,3vw,18px);color:#ff7043;
               letter-spacing:3px;margin-bottom:28px;"></div>
          <div style="font-size:11px;color:#8892b0;letter-spacing:2px;">RECUPERÁNDOTE EN 3 SEGUNDOS...</div>
        `;
        document.body.appendChild(overlay);
      }
      const sub = overlay.querySelector("#sparringKoSub");
      if (sub) sub.textContent = `Derrotado por ${attackerName || "???"}`;
      overlay.style.display = "flex";
    }

    function hideKoOverlay() {
      const overlay = document.getElementById("sparringKoOverlay");
      if (overlay) overlay.style.display = "none";
    }

    // ── Botón "RENDIRSE" en el modo partyCombat ───────────────────────
    function injectSurrenderButton() {
      const hud = document.getElementById("hud");
      if (!hud || document.getElementById("sparringSurrenderBtn")) return;
      const btn = document.createElement("button");
      btn.id = "sparringSurrenderBtn";
      btn.textContent = "🏳 RENDIRSE";
      btn.style.cssText = `
        position:absolute;bottom:20px;left:50%;transform:translateX(calc(-50% - 80px));
        padding:10px 18px;background:rgba(255,23,68,.18);border:1px solid #ff1744;
        border-radius:8px;color:#ff5252;font-family:'Orbitron',monospace;font-size:9px;
        letter-spacing:2px;cursor:pointer;pointer-events:auto;z-index:20;display:none;
        touch-action:manipulation;transition:background .15s;
      `;
      btn.addEventListener("click", surrenderSparring);
      hud.appendChild(btn);
    }

    function surrenderSparring() {
      const p = G.player;
      // Notificar al contrincante
      const targetId = G.selectedPlayerId && G.otherPlayers[G.selectedPlayerId]
        ? G.selectedPlayerId
        : getNearestPartyMember();
      if (targetId && G.mpConnected && G.myId) {
        G.db.ref("partyActions/" + targetId).set({
          fromId:   G.myId,
          fromName: p.name,
          type:     "effect",
          anim:     "attack_2",
          icon:     "🏆",
          text:     "GANA",
          t:        Date.now(),
        });
      }
      if (G.combatEffects) {
        G.combatEffects.push({ x:p.x, y:p.y - 52, text:"ME RINDO", timer:1.8, color:"#90a4ae" });
      }
      if (G.csAnimator) G.csAnimator.play("hurt", () => { if (G.csAnimator) G.csAnimator.play("idle"); });
      if (typeof window.showHudToast === "function") window.showHudToast("🏳 Te rendiste", "info");
      if (typeof window.setControlMode === "function") window.setControlMode("partyFriendly");
    }
    window.surrenderSparring = surrenderSparring;

    // Mostrar/ocultar botón de rendición según el modo de control
    const _originalSetControlMode = window.setControlMode;
    window.setControlMode = function setControlMode(mode) {
      if (_originalSetControlMode) _originalSetControlMode(mode);
      const btn = document.getElementById("sparringSurrenderBtn");
      if (btn) btn.style.display = mode === "partyCombat" ? "block" : "none";
    };

    // ── Inyectar CSS de animaciones ───────────────────────────────────
    function injectCSS() {
      if (document.getElementById("sparringPatchCSS")) return;
      const style = document.createElement("style");
      style.id = "sparringPatchCSS";
      style.textContent = `
        @keyframes spawnDmgNum {
          0%   { opacity:0; transform:translateY(0) scale(0.6); }
          15%  { opacity:1; transform:translateY(-14px) scale(1.2); }
          60%  { opacity:1; transform:translateY(-30px) scale(1); }
          100% { opacity:0; transform:translateY(-55px) scale(0.85); }
        }
      `;
      document.head.appendChild(style);
    }

    // ── Helper: jugador de party más cercano ──────────────────────────
    function getNearestPartyMember() {
      const p = G.player;
      let best = null, bestDist = Infinity;
      for (const [id, op] of Object.entries(G.otherPlayers)) {
        if (!G.isPartyMember(id)) continue;
        const d = Math.hypot((op.x || 0) - p.x, (op.y || 0) - p.y);
        if (d < bestDist) { bestDist = d; best = id; }
      }
      return best;
    }

    // ════════════════════════════════════════════════════════════════════
    //  ARRANQUE
    // ════════════════════════════════════════════════════════════════════
    injectCSS();
    injectSurrenderButton();
    hookIncomingHits();

    console.log("[sparring-patch] ✅ Sistema de sparring con daño real activado");
  }

})();
