// @ts-nocheck
/**
 * DRAGON WORLD Z — Fusion System v2.0.0
 *
 * ══════════════════════════════════════════════════════════════════
 *  SISTEMA DE FUSIÓN — Metamoru y Potara
 *
 *  Firebase paths:
 *    fusionRequests/{requestId}   → propuesta de fusión entre dos jugadores
 *    fusionState/{partyId}        → estado activo de fusión (quién controla, swap)
 *
 *  FLUJO CORRECTO:
 *    1. Jugador A (iniciador) propone fusión (Metamoru o Potara) al jugador B de la party
 *    2. B acepta → SOLO el iniciador (A) abre el picker con sus transformaciones GUARDADAS
 *    3. Si el iniciador no elige en 7s → cancelación automática
 *    4. El iniciador elige → se graba en Firebase (initiatorTransform)
 *    5. Ambos se posicionan:
 *         A (iniciador): izquierda, mirando → (facing = 1)
 *         B (partner):   derecha,  mirando ← (facing = -1)
 *    6. Ambos reproducen la animación de fusión (fusion_metamoru / fusion_potara)
 *    7. Al completarse la animación → B desaparece, A recibe la skin de fusión
 *    8. A puede presionar SWAP para ceder control a B
 *    9. Cualquiera puede ROMPER la fusión (revert)
 *
 *  ANIMACIONES (SPECIAL_ACTIONS_META — setSpecialMode):
 *    fusion_metamoru  → row 27, 4 frames
 *    fusion_potara    → row 28, 3 frames
 * ══════════════════════════════════════════════════════════════════
 */

"use strict";

(function () {

  // ═══════════════════════════════════════════════════════════════
  //  CONSTANTES
  // ═══════════════════════════════════════════════════════════════

  const FUSION_CHOOSE_TIMEOUT_MS = 7000;   // tiempo para elegir transformación
  const FUSION_ANIM_TYPES = {
    metamoru: "fusion_metamoru",
    potara:   "fusion_potara",
  };

  // ═══════════════════════════════════════════════════════════════
  //  ESTADO LOCAL
  // ═══════════════════════════════════════════════════════════════

  /** Solicitud pendiente recibida (modal de aceptar/rechazar visible) */
  let _pendingRequest = null;

  /** Estado de fusión activa local */
  let _activeFusion = null;
  /*
    _activeFusion = {
      id:            string,          // Firebase key
      type:          "metamoru"|"potara",
      initiatorId:   string,
      partnerId:     string,
      transformId:   string,          // id de la transformación elegida por el iniciador
      controlId:     string,          // quién mueve el personaje ahora mismo
      myRole:        "initiator"|"partner",
    }
  */

  /** Timer de cancelación de elección */
  let _chooseTimer = null;

  /** Listeners Firebase */
  let _reqListener  = null;
  let _stateListener = null;

  /** Skin base del jugador guardada para revertir */
  let _savedAppearance = null;

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS — acceso a globals del juego
  // ═══════════════════════════════════════════════════════════════

  const G = {
    get db()       { return window.db; },
    get myId()     { return window.myPlayerId; },
    get player()   { return window.player; },
    get others()   { return window.otherPlayers || {}; },
    get animators(){ return window.otherPlayerAnimators || {}; },
    get myAnim()   { return window.csAnimator; },
    get online()   { return window.mpConnected; },
    get TS()       { return window.TransformationsSystem; },
    get CS()       { return window.CharacterSystem; },
  };

  function toast(msg, type) {
    if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
  }

  function isPartyMember(id) {
    return !!(window.PvpSystem?.isPartyMember?.(id));
  }

  function waitForGame(cb, n) {
    n = n || 0;
    if (n > 400) return;
    if (window.db && window.myPlayerId && window.player && window.TransformationsSystem && window.PvpSystem) {
      cb();
      return;
    }
    setTimeout(() => waitForGame(cb, n + 1), 150);
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRANSFORMACIONES GUARDADAS DEL JUGADOR
  // ═══════════════════════════════════════════════════════════════

  /**
   * Obtiene las transformaciones previamente guardadas del jugador local.
   * Usa window._loadSavedTransformations expuesto por game.html.
   * Si no está disponible, lee directamente desde localStorage.
   */
  function _getMyFusionTransforms() {
    // Intentar usar la función expuesta por game.html (más completa, resuelve skins)
    if (typeof window._loadSavedTransformations === "function") {
      return window._loadSavedTransformations() || [];
    }
    // Fallback: leer directamente desde localStorage
    try {
      const slotRaw  = localStorage.getItem("dragonCreatorZ_slots");
      const activeSlot = parseInt(localStorage.getItem("dragonCreatorZ_activeSlot") || "0", 10);
      if (slotRaw) {
        const slots = JSON.parse(slotRaw);
        const slot  = slots[activeSlot];
        if (Array.isArray(slot?.transformations) && slot.transformations.length > 0) {
          return slot.transformations;
        }
      }
      const raw = localStorage.getItem("dragonCreatorZ_transformations");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch(e) {}
    return [];
  }

  // ═══════════════════════════════════════════════════════════════
  //  ANIMACIÓN DE FUSIÓN — reproducción local + broadcast
  // ═══════════════════════════════════════════════════════════════

  /**
   * Posiciona a los dos jugadores para la animación:
   *   - Iniciador a la izquierda, mirando derecha  (facing = 1)
   *   - Partner  a la derecha,  mirando izquierda  (facing = -1)
   * Ambos se pegan (x cercano) y quedan el uno frente al otro.
   * También sincroniza la posición/facing del jugador local a Firebase.
   */
  function _positionForFusion(initiatorId, partnerId) {
    const p     = G.player;
    const myId  = G.myId;
    const other = G.others[initiatorId === myId ? partnerId : initiatorId];

    // Usar la posición del otro jugador como referencia para el centro
    let midX = p.x;
    if (other) midX = (p.x + (other.x || p.x)) / 2;

    if (myId === initiatorId) {
      p.x      = midX - 28;
      p.facing = 1;           // mira a la derecha → hacia el partner
    } else {
      p.x      = midX + 28;
      p.facing = -1;          // mira a la izquierda → hacia el iniciador
    }

    // Publicar posición/facing inmediatamente para que el otro lo vea
    if (typeof window.sendPlayerUpdate === "function") {
      // Llamar al original aunque esté bloqueado temporalmente
      const orig = window.sendPlayerUpdate.__fusionOrig || window.sendPlayerUpdate;
      try { orig.call(window); } catch(e) {}
    }
  }

  // Velocidad de la animación de fusión (más bajo = más lento)
  const FUSION_ANIM_SPEED = 0.55;

  /**
   * Reproduce la animación de fusión en el animator local (lenta).
   */
  function _playFusionAnim(type, onComplete) {
    const anim    = G.myAnim;
    if (!anim) { onComplete && onComplete(); return; }
    const animKey = FUSION_ANIM_TYPES[type] || "fusion_metamoru";
    anim.setBattleMode  && anim.setBattleMode(false);
    anim.setSpecialMode && anim.setSpecialMode(true);
    // Bajar la velocidad del animator para que la anim sea lenta y dramática
    if (anim.setSpeed)        anim.setSpeed(FUSION_ANIM_SPEED);
    else if (anim.animSpeed !== undefined) anim.animSpeed = FUSION_ANIM_SPEED;
    anim.play(animKey, () => {
      // Restaurar velocidad normal
      if (anim.setSpeed)        anim.setSpeed(1);
      else if (anim.animSpeed !== undefined) anim.animSpeed = 1;
      anim.setSpecialMode && anim.setSpecialMode(false);
      anim.play("idle");
      onComplete && onComplete();
    });
  }

  /**
   * Reproduce la animación de fusión en el animator remoto de un jugador (lenta).
   */
  function _playRemoteFusionAnim(playerId, type) {
    const anim    = G.animators[playerId];
    if (!anim) return;
    const animKey = FUSION_ANIM_TYPES[type] || "fusion_metamoru";
    anim.setBattleMode  && anim.setBattleMode(false);
    anim.setSpecialMode && anim.setSpecialMode(true);
    if (anim.setSpeed)        anim.setSpeed(FUSION_ANIM_SPEED);
    else if (anim.animSpeed !== undefined) anim.animSpeed = FUSION_ANIM_SPEED;
    anim.play(animKey, () => {
      if (anim.setSpeed)        anim.setSpeed(1);
      else if (anim.animSpeed !== undefined) anim.animSpeed = 1;
      anim.setSpecialMode && anim.setSpecialMode(false);
      anim.play("idle");
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SKIN DE FUSIÓN — aplicar/revertir
  // ═══════════════════════════════════════════════════════════════

  function _saveMySkin() {
    const p = G.player;
    _savedAppearance = JSON.parse(JSON.stringify(p.appearance || {}));
  }

  function _applyFusionSkin(transformId) {
    // Buscar en transformaciones guardadas del jugador primero
    const myTrans = _getMyFusionTransforms();
    const saved   = myTrans.find(t => t.id === transformId);

    const TS = G.TS;
    if (!TS) return;

    if (saved) {
      // Registrar la transformación guardada y aplicarla
      if (typeof TS.registerTransformation === "function") {
        TS.registerTransformation(Object.assign({}, saved));
      }
      if (typeof window.applyTransformationFromDrop === "function") {
        // Usar el flujo completo de game.html (animación + skin + stats)
        window.applyTransformationFromDrop(transformId);
        return;
      }
    }

    // Fallback: transformPlayer directo
    if (typeof TS.transformPlayer === "function") {
      TS.transformPlayer(transformId, { raceId: G.player?.race || "all", bypassRace: true });
    }

    if (typeof window.publishMyAppearance === "function") {
      window.publishMyAppearance(true);
    }
  }

  function _revertFusionSkin() {
    const TS = G.TS;
    if (TS && typeof TS.revertTransformation === "function") {
      TS.revertTransformation();
    }
    if (_savedAppearance && G.player) {
      Object.assign(G.player.appearance || {}, _savedAppearance);
    }
    if (typeof window.publishMyAppearance === "function") {
      window.publishMyAppearance(true);
    }
    _savedAppearance = null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  OCULTAR / MOSTRAR JUGADOR REMOTO
  // ═══════════════════════════════════════════════════════════════

  function _hideRemotePlayer(playerId) {
    if (!G.db) return;
    G.db.ref("players/" + playerId).update({ fusionHidden: true, t: Date.now() });
  }

  function _showRemotePlayer(playerId) {
    if (!G.db) return;
    G.db.ref("players/" + playerId).update({ fusionHidden: false, t: Date.now() });
  }

  function _patchRenderLoop() {
    if (window._fusionHookApplied) return;
    window._fusionHookApplied = true;
    // fusionHidden llega vía Firebase al objeto otherPlayers[id].fusionHidden
    // El render loop en game.html ya puede leer ese campo para saltar el dibujo.
  }

  // ═══════════════════════════════════════════════════════════════
  //  FIREBASE — PATHS
  // ═══════════════════════════════════════════════════════════════

  function _reqRef(id)   { return G.db.ref("fusionRequests/" + id); }
  function _stateRef(id) { return G.db.ref("fusionState/" + id); }

  // ═══════════════════════════════════════════════════════════════
  //  PROPONER FUSIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Inicia la propuesta de fusión con un jugador de la party.
   * @param {"metamoru"|"potara"} type
   * @param {string} targetId
   */
  function proposeFusion(type, targetId) {
    if (!G.online || !G.myId) return toast("Conectate al servidor primero", "dmg");
    if (!isPartyMember(targetId))  return toast("El jugador no está en tu party", "dmg");
    if (_activeFusion)             return toast("Ya estás en una fusión activa", "dmg");
    if (!FUSION_ANIM_TYPES[type])  return toast("Tipo de fusión inválido", "dmg");

    // Verificar que el iniciador tiene transformaciones guardadas
    const myTransforms = _getMyFusionTransforms();
    if (myTransforms.length === 0) {
      return toast("Necesitás tener transformaciones guardadas para fusionarte", "dmg");
    }

    const id = "fus_" + G.myId + "_" + targetId + "_" + Date.now();
    _reqRef(id).set({
      id,
      type,
      initiatorId:   G.myId,
      initiatorName: G.player?.name || "?",
      partnerId:     targetId,
      partnerName:   G.others[targetId]?.name || "?",
      status:        "pending",
      initiatorTransform: null,
      t:             Date.now(),
    });
    toast(`Propuesta de fusión ${type === "metamoru" ? "Metamoru" : "Potara"} enviada`, "info");
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAL — ACEPTAR / RECHAZAR FUSIÓN
  // ═══════════════════════════════════════════════════════════════

  function _showFusionInviteModal(req) {
    _removeFusionModal("fusionInviteModal");
    const typeName = req.type === "metamoru" ? "⚡ METAMORU" : "💍 POTARA";
    const el = document.createElement("div");
    el.id = "fusionInviteModal";
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:210;background:rgba(8,9,15,.97);border:1px solid #ce93d8;
      border-radius:12px;padding:20px 24px;text-align:center;
      font-family:Orbitron,monospace;color:#fff;min-width:280px;
      box-shadow:0 0 30px rgba(206,147,216,.4);pointer-events:auto;
    `;
    el.innerHTML = `
      <div style="font-size:10px;letter-spacing:2px;color:#ce93d8;margin-bottom:6px">PROPUESTA DE FUSIÓN</div>
      <div style="font-size:13px;font-weight:bold;margin-bottom:4px">${typeName}</div>
      <div style="font-size:10px;color:#c8cfe8;margin-bottom:16px">
        <b style="color:#f5c400">${req.initiatorName}</b> quiere fusionarse con vos
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="fusAcceptBtn" style="padding:10px 20px;background:rgba(206,147,216,.2);border:1px solid #ce93d8;border-radius:6px;color:#ce93d8;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer">✓ ACEPTAR</button>
        <button id="fusDeclineBtn" style="padding:10px 20px;background:rgba(255,23,68,.15);border:1px solid #ff5252;border-radius:6px;color:#ff5252;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer">✕ RECHAZAR</button>
      </div>
    `;
    document.body.appendChild(el);
    document.getElementById("fusAcceptBtn").onclick  = () => _acceptFusionRequest(req);
    document.getElementById("fusDeclineBtn").onclick = () => _declineFusionRequest(req);
  }

  function _acceptFusionRequest(req) {
    _removeFusionModal("fusionInviteModal");
    // Actualizar estado → "choosing": el partner aceptó, ahora el iniciador elige
    _reqRef(req.id).update({ status: "choosing", t: Date.now() });
    // El partner solo espera — mostramos un indicador de espera
    _showWaitingModal(req.initiatorName);
    _pendingRequest = req;
  }

  function _declineFusionRequest(req) {
    _removeFusionModal("fusionInviteModal");
    _reqRef(req.id).update({ status: "cancelled", cancelReason: "declined", t: Date.now() });
    _pendingRequest = null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAL DE ESPERA (para el partner mientras el iniciador elige)
  // ═══════════════════════════════════════════════════════════════

  function _showWaitingModal(initiatorName) {
    _removeFusionModal("fusionWaitModal");
    const el = document.createElement("div");
    el.id = "fusionWaitModal";
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:210;background:rgba(8,9,15,.97);border:1px solid #ce93d8;
      border-radius:12px;padding:20px 24px;text-align:center;
      font-family:Orbitron,monospace;color:#fff;min-width:260px;
      box-shadow:0 0 30px rgba(206,147,216,.4);pointer-events:auto;
    `;
    el.innerHTML = `
      <div style="font-size:10px;letter-spacing:2px;color:#ce93d8;margin-bottom:8px">FUSIÓN EN PROCESO</div>
      <div style="font-size:10px;color:#c8cfe8;margin-bottom:6px">
        Esperando que <b style="color:#f5c400">${initiatorName || "tu compañero"}</b><br>
        elija la forma de fusión...
      </div>
      <div style="margin-top:10px;display:flex;justify-content:center;gap:6px">
        <span style="width:8px;height:8px;background:#ce93d8;border-radius:50%;display:inline-block;animation:fusWaitPulse 1s infinite 0s"></span>
        <span style="width:8px;height:8px;background:#ce93d8;border-radius:50%;display:inline-block;animation:fusWaitPulse 1s infinite 0.3s"></span>
        <span style="width:8px;height:8px;background:#ce93d8;border-radius:50%;display:inline-block;animation:fusWaitPulse 1s infinite 0.6s"></span>
      </div>
      <style>
        @keyframes fusWaitPulse { 0%,100%{opacity:.2} 50%{opacity:1} }
      </style>
    `;
    document.body.appendChild(el);
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAL — ELEGIR TRANSFORMACIÓN (SOLO EL INICIADOR)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Muestra el selector de transformaciones GUARDADAS del iniciador.
   * Solo se llama para el iniciador cuando el partner acepta.
   */
  function _showTransformPickerForInitiator(req) {
    _removeFusionModal("fusionPickerModal");

    // Cargar las transformaciones guardadas del jugador
    const myTransforms = _getMyFusionTransforms();
    const typeName     = req.type === "metamoru" ? "⚡ METAMORU" : "💍 POTARA";

    let optHtml = "";
    if (myTransforms.length === 0) {
      optHtml = `<div style="color:#8892b0;font-size:10px;text-align:center;padding:12px;">
        Sin transformaciones guardadas.<br>
        <span style="font-size:9px">Creálas en el editor de personaje.</span>
      </div>`;
    } else {
      myTransforms.forEach(tr => {
        const aura  = tr.auraColor  || "#fdd835";
        const icon  = tr.icon       || "⚡";
        const name  = tr.name       || tr.id;
        const level = tr.level      || 1;
        const mStr  = tr.multipliers?.str ?? (tr.multStr ?? 1);
        const mSpd  = tr.multipliers?.spd ?? (tr.multSpd ?? 1);

        optHtml += `
          <button class="fus-tf-opt" data-id="${tr.id}"
            style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;
                   background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
                   border-radius:6px;color:#e8eaf6;font-family:Rajdhani,sans-serif;
                   font-size:11px;cursor:pointer;text-align:left;margin-bottom:4px;">
            <span style="font-size:16px">${icon}</span>
            <span style="color:${aura};font-weight:bold">${name}</span>
            <span style="margin-left:auto;font-size:9px;color:#8892b0">Lv ${level} · ×${mStr} / ×${mSpd}</span>
          </button>`;
      });
    }

    const el = document.createElement("div");
    el.id = "fusionPickerModal";
    el.style.cssText = `
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:210;background:rgba(8,9,15,.97);border:1px solid #ce93d8;
      border-radius:12px;padding:16px 18px;font-family:Orbitron,monospace;
      color:#fff;width:min(320px,92vw);max-height:70vh;display:flex;
      flex-direction:column;box-shadow:0 0 30px rgba(206,147,216,.4);pointer-events:auto;
    `;
    el.innerHTML = `
      <div style="font-size:9px;letter-spacing:2px;color:#ce93d8;margin-bottom:4px">FUSIÓN ${typeName}</div>
      <div style="font-size:10px;color:#c8cfe8;margin-bottom:10px">Elegí tu forma fusionada</div>
      <div id="fusPickerList" style="overflow-y:auto;flex:1;padding-right:4px">${optHtml}</div>
      <div id="fusPickerTimer" style="margin-top:10px;font-size:9px;color:#ff7043;text-align:center">
        Tiempo restante: <span id="fusTimerSec">7</span>s
      </div>
      <button id="fusPickerCancelBtn" style="margin-top:8px;padding:7px;width:100%;
        background:rgba(255,23,68,.1);border:1px solid #ff5252;border-radius:6px;
        color:#ff5252;font-family:Orbitron,monospace;font-size:8px;cursor:pointer">
        CANCELAR FUSIÓN
      </button>
    `;
    document.body.appendChild(el);

    // Click en una opción
    el.querySelectorAll(".fus-tf-opt").forEach(btn => {
      btn.onclick = () => _initiatorChooseTransform(req, btn.dataset.id);
    });

    document.getElementById("fusPickerCancelBtn").onclick = () => {
      _cancelFusion(req, "user_cancel");
    };

    // Ticker visual del countdown
    let secs = Math.ceil(FUSION_CHOOSE_TIMEOUT_MS / 1000);
    const ticker = setInterval(() => {
      secs--;
      const secEl = document.getElementById("fusTimerSec");
      if (secEl) secEl.textContent = Math.max(0, secs);
      if (secs <= 0) clearInterval(ticker);
    }, 1000);
    el.__ticker = ticker;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LÓGICA DE ELECCIÓN (SOLO EL INICIADOR)
  // ═══════════════════════════════════════════════════════════════

  /**
   * El iniciador eligió su transformación.
   * Grabamos en Firebase y disparamos la secuencia de animación.
   */
  function _initiatorChooseTransform(req, transformId) {
    _removeFusionModal("fusionPickerModal");
    _clearChooseTimer();

    // Guardar la transformación elegida y marcar como "animating"
    _reqRef(req.id).update({
      initiatorTransform: transformId,
      status: "animating",
      t: Date.now(),
    });
    toast("¡Iniciando fusión!", "info");
  }

  // ═══════════════════════════════════════════════════════════════
  //  TIMEOUT DE ELECCIÓN
  // ═══════════════════════════════════════════════════════════════

  function _startChooseTimer(req) {
    _clearChooseTimer();
    _chooseTimer = setTimeout(() => {
      _removeFusionModal("fusionPickerModal");
      _cancelFusion(req, "timeout");
      toast("Fusión cancelada — tiempo agotado", "dmg");
    }, FUSION_CHOOSE_TIMEOUT_MS);
  }

  function _clearChooseTimer() {
    if (_chooseTimer) { clearTimeout(_chooseTimer); _chooseTimer = null; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SECUENCIA DE FUSIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Disparado cuando status === "animating".
   * Ambos jugadores se posicionan y reproducen la animación.
   * Al terminar → se aplica la skin de fusión.
   */
  function _startFusionSequence(req) {
    const myId   = G.myId;
    const isInit = myId === req.initiatorId;
    const role   = isInit ? "initiator" : "partner";

    // Cerrar modal de espera del partner
    _removeFusionModal("fusionWaitModal");
    _removeFusionModal("fusionPickerModal");

    // Posicionar ambos jugadores (también sincroniza facing a Firebase)
    _positionForFusion(req.initiatorId, req.partnerId);

    // Reproducir animación local y del otro jugador
    const otherId = isInit ? req.partnerId : req.initiatorId;
    _playRemoteFusionAnim(otherId, req.type);

    // Animación local → al completarse, aplicar transformación
    _playFusionAnim(req.type, () => {
      _onFusionAnimComplete(req, role);
    });
  }

  function _onFusionAnimComplete(req, role) {
    const transformId = req.initiatorTransform;

    if (role === "initiator") {
      // El iniciador aplica la skin de fusión y toma el control
      _saveMySkin();
      _applyFusionSkin(transformId);
      _hideRemotePlayer(req.partnerId);

      // Crear estado de fusión en Firebase
      const stateId = "fusst_" + req.id;
      _stateRef(stateId).set({
        id:          stateId,
        requestId:   req.id,
        type:        req.type,
        initiatorId: req.initiatorId,
        partnerId:   req.partnerId,
        transformId,
        controlId:   req.initiatorId,
        active:      true,
        t:           Date.now(),
      });

      _activeFusion = {
        id:          stateId,
        type:        req.type,
        initiatorId: req.initiatorId,
        partnerId:   req.partnerId,
        transformId,
        controlId:   req.initiatorId,
        myRole:      "initiator",
      };

      _listenFusionState(stateId);
      _showFusionHud();
      toast("¡FUSIÓN COMPLETA! Sos el piloto", "lvl");

    } else {
      // El partner: NO aplica skin propia. Se oculta y entra en modo espectador
      // siguiendo la posición del iniciador (el fusionado).
      _enterSpectatorMode(req.initiatorId);

      // Escuchar el fusionState para saber cuándo recuperar el control (SWAP)
      G.db.ref("fusionState").orderByChild("requestId").equalTo(req.id).once("value", snap => {
        const states = snap.val();
        if (!states) return;
        const stateId   = Object.keys(states)[0];
        const stateData = states[stateId];
        _activeFusion = {
          id:          stateId,
          type:        stateData.type,
          initiatorId: stateData.initiatorId,
          partnerId:   stateData.partnerId,
          transformId: stateData.transformId,
          controlId:   stateData.controlId,
          myRole:      "partner",
        };
        _listenFusionState(stateId);
        _updateFusionControl(stateData.controlId);
      });
    }

    // Limpiar request
    _reqRef(req.id).update({ status: "done", t: Date.now() });
    _pendingRequest = null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ESTADO DE FUSIÓN — LISTENER
  // ═══════════════════════════════════════════════════════════════

  function _listenFusionState(stateId) {
    if (_stateListener) _stateListener.off();
    _stateListener = G.db.ref("fusionState/" + stateId);
    _stateListener.on("value", snap => {
      const state = snap.val();
      if (!state) return;
      if (!state.active) {
        _onFusionEnded(state);
        return;
      }
      if (_activeFusion) {
        _activeFusion.controlId = state.controlId;
        _updateFusionControl(state.controlId);
        _showFusionHud();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODO ESPECTADOR (partner durante la fusión)
  // ═══════════════════════════════════════════════════════════════

  /** ID del jugador al que el espectador sigue */
  let _spectatorFollowId = null;
  /** rAF handle del loop de espectador */
  let _spectatorRaf = null;

  /**
   * El partner entra en modo espectador: su personaje se oculta
   * y la cámara sigue al iniciador (el fusionado).
   */
  function _enterSpectatorMode(followId) {
    _spectatorFollowId = followId;
    window._fusionInputBlocked = true;

    // Ocultar el propio personaje del partner en Firebase (para otros clientes)
    _hideRemotePlayer(G.myId);

    // Parchear drawPlayerChar para que el jugador local NO se renderice
    _hookDrawPlayerChar(false);

    // HUD de espectador
    _showSpectatorHud();

    // Loop: copiar posición de la cámara al jugador seguido
    function spectatorLoop() {
      if (!_spectatorFollowId) return;
      const target = G.others[_spectatorFollowId];
      if (target && G.player) {
        G.player.x = target.x;
        G.player.y = target.y;
      }
      _spectatorRaf = requestAnimationFrame(spectatorLoop);
    }
    if (_spectatorRaf) cancelAnimationFrame(_spectatorRaf);
    _spectatorRaf = requestAnimationFrame(spectatorLoop);

    toast("Sos espectador — tu compañero tiene el control", "info");
  }

  function _exitSpectatorMode() {
    _spectatorFollowId = null;
    if (_spectatorRaf) { cancelAnimationFrame(_spectatorRaf); _spectatorRaf = null; }
    _removeSpectatorHud();
    // Restaurar renderizado del jugador local
    _hookDrawPlayerChar(true);
    _showRemotePlayer(G.myId);
    window._fusionInputBlocked = false;
  }

  /**
   * Parchea window.drawPlayerChar para suprimir (visible=false) o restaurar (visible=true)
   * el renderizado del personaje local. Busca la función en el scope global o en G.
   */
  function _hookDrawPlayerChar(visible) {
    // Intentar encontrar la función (puede estar expuesta como window.drawPlayerChar)
    if (visible) {
      if (window._drawPlayerCharOrig) {
        window.drawPlayerChar = window._drawPlayerCharOrig;
        window._drawPlayerCharOrig = null;
      }
      // Flag global por si la función se lee directamente desde game loop
      window._fusionSpectatorHideLocal = false;
    } else {
      if (!window._drawPlayerCharOrig && typeof window.drawPlayerChar === "function") {
        window._drawPlayerCharOrig = window.drawPlayerChar;
        window.drawPlayerChar = function () {
          if (window._fusionSpectatorHideLocal) return;
          return window._drawPlayerCharOrig.apply(this, arguments);
        };
      }
      window._fusionSpectatorHideLocal = true;
    }
  }


  function _showSpectatorHud() {
    _removeSpectatorHud();
    const el = document.createElement("div");
    el.id = "fusionSpectatorHud";
    el.style.cssText = `
      position:fixed;top:14px;left:50%;transform:translateX(-50%);
      z-index:145;background:rgba(8,9,15,.88);border:1px solid rgba(206,147,216,.5);
      border-radius:8px;padding:6px 14px;font-family:Orbitron,monospace;
      color:#ce93d8;font-size:9px;letter-spacing:1px;pointer-events:none;
      box-shadow:0 0 12px rgba(206,147,216,.2);
    `;
    el.textContent = "👁 MODO ESPECTADOR — FUSIÓN ACTIVA";
    document.body.appendChild(el);
  }

  function _removeSpectatorHud() {
    const el = document.getElementById("fusionSpectatorHud");
    if (el) el.remove();
  }

  function _updateFusionControl(controlId) {
    const myId     = G.myId;
    const iControl = controlId === myId;

    if (iControl) {
      // Este jugador toma el control → salir del espectador, aplicar skin si es partner
      window._fusionInputBlocked = false;
      _exitSpectatorMode();
      if (_activeFusion) {
        if (_activeFusion.myRole === "partner") {
          // Partner tomando control por SWAP: aplicar skin fusionada y ocultar iniciador
          _saveMySkin();
          _applyFusionSkin(_activeFusion.transformId);
          _hideRemotePlayer(_activeFusion.initiatorId);
        } else {
          // Iniciador recuperando control: asegurarse de estar visible
          _showRemotePlayer(myId);
        }
      }
      _showFusionHud();
    } else {
      // Este jugador pierde el control → revertir skin y entrar en espectador
      window._fusionInputBlocked = true;
      _revertFusionSkin();
      if (_activeFusion) {
        // Mostrar al que ahora controla
        _showRemotePlayer(controlId);
        // Entrar en espectador siguiendo al controlador
        _enterSpectatorMode(controlId);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SWAP DE CONTROL
  // ═══════════════════════════════════════════════════════════════

  function swapFusionControl() {
    if (!_activeFusion)                              return toast("No estás en una fusión", "dmg");
    if (_activeFusion.controlId !== G.myId)          return toast("No tenés el control ahora mismo", "dmg");

    const otherId = G.myId === _activeFusion.initiatorId
      ? _activeFusion.partnerId
      : _activeFusion.initiatorId;

    _stateRef(_activeFusion.id).update({ controlId: otherId, t: Date.now() });
    toast("Control cedido a tu compañero de fusión", "info");
  }

  // ═══════════════════════════════════════════════════════════════
  //  DESHACER FUSIÓN
  // ═══════════════════════════════════════════════════════════════

  function splitFusion() {
    if (!_activeFusion) return toast("No estás en una fusión", "dmg");
    _stateRef(_activeFusion.id).update({ active: false, endReason: "split", t: Date.now() });
  }

  function _onFusionEnded(state) {
    _clearChooseTimer();
    if (_stateListener) { _stateListener.off(); _stateListener = null; }

    // Salir del espectador si estaba en ese modo
    _exitSpectatorMode();

    // Revertir transformación
    _revertFusionSkin();

    // Re-mostrar a ambos jugadores
    _showRemotePlayer(state.initiatorId);
    _showRemotePlayer(state.partnerId);

    // Restaurar control de input
    window._fusionInputBlocked = false;

    if (typeof window.setControlMode === "function") {
      window.setControlMode("rp");
    }

    _removeFusionModal("fusionHud");
    _removeSpectatorHud();
    _activeFusion = null;
    toast("La fusión se separó", "info");
  }

  function _onFusionCancelled(req) {
    _clearChooseTimer();
    _removeFusionModal("fusionPickerModal");
    _removeFusionModal("fusionInviteModal");
    _removeFusionModal("fusionWaitModal");
    _pendingRequest = null;

    const reasons = {
      declined:    "El otro jugador rechazó la fusión",
      timeout:     "Tiempo agotado — fusión cancelada",
      user_cancel: "Fusión cancelada",
    };
    toast(reasons[req.cancelReason] || "Fusión cancelada", "dmg");
  }

  function _cancelFusion(req, reason) {
    if (!G.db) return;
    _reqRef(req.id).update({ status: "cancelled", cancelReason: reason, t: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════
  //  HUD DE FUSIÓN
  // ═══════════════════════════════════════════════════════════════

  function _showFusionHud() {
    _removeFusionModal("fusionHud");
    if (!_activeFusion) return;

    const iControl  = _activeFusion.controlId === G.myId;
    const myTrans   = _getMyFusionTransforms();
    const tf        = myTrans.find(t => t.id === _activeFusion.transformId);
    const tfLabel   = tf?.name || _activeFusion.transformId;
    const typeName  = _activeFusion.type === "metamoru" ? "METAMORU" : "POTARA";

    const el = document.createElement("div");
    el.id    = "fusionHud";
    el.style.cssText = `
      position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
      z-index:145;background:rgba(8,9,15,.92);border:1px solid #ce93d8;
      border-radius:10px;padding:10px 16px;font-family:Orbitron,monospace;
      color:#fff;display:flex;align-items:center;gap:12px;pointer-events:auto;
      box-shadow:0 0 16px rgba(206,147,216,.3);
    `;
    el.innerHTML = `
      <div style="font-size:9px;color:#ce93d8;letter-spacing:1px">
        💍 FUSIÓN ${typeName}<br>
        <span style="color:#f5c400;font-size:10px">${tfLabel}</span>
      </div>
      <div style="width:1px;height:32px;background:rgba(206,147,216,.3)"></div>
      <div style="font-size:9px;color:${iControl ? "#69f0ae" : "#ff7043"}">
        ${iControl ? "🟢 CONTROLANDO" : "⏸ EN ESPERA"}
      </div>
      ${iControl ? `
        <button id="fusSwapBtn" style="padding:6px 10px;background:rgba(206,147,216,.2);
          border:1px solid #ce93d8;border-radius:6px;color:#ce93d8;
          font-family:Orbitron,monospace;font-size:8px;cursor:pointer">
          🔄 CEDER CONTROL
        </button>` : ""}
      <button id="fusSplitBtn" style="padding:6px 10px;background:rgba(255,23,68,.15);
        border:1px solid #ff5252;border-radius:6px;color:#ff5252;
        font-family:Orbitron,monospace;font-size:8px;cursor:pointer">
        💥 SEPARARSE
      </button>
    `;
    document.body.appendChild(el);

    document.getElementById("fusSplitBtn").onclick = splitFusion;
    const swapBtn = document.getElementById("fusSwapBtn");
    if (swapBtn) swapBtn.onclick = swapFusionControl;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LISTENERS GLOBALES
  // ═══════════════════════════════════════════════════════════════

  function _listenRequests() {
    if (!G.db) return;
    if (_reqListener) _reqListener.off();
    _reqListener = G.db.ref("fusionRequests");
    _reqListener.on("child_added",   _dispatchRequest);
    _reqListener.on("child_changed", _dispatchRequest);
  }

  function _dispatchRequest(snap) {
    const req  = snap.val();
    if (!req) return;
    const myId = G.myId;

    // Ignorar requests antiguos (más de 30s)
    if (Date.now() - (req.t || 0) > 30000) return;

    switch (req.status) {

      case "pending":
        // Solo el partner recibe la invitación
        if (req.partnerId === myId && !_pendingRequest) {
          _pendingRequest = { ...req, firebaseKey: snap.key };
          _showFusionInviteModal(req);
        }
        break;

      case "choosing":
        // El partner aceptó → SOLO el iniciador abre el picker de SUS transformaciones
        if (req.initiatorId === myId && !document.getElementById("fusionPickerModal")) {
          _showTransformPickerForInitiator(req);
          _startChooseTimer(req);
        }
        // El partner: ya está mostrando el modal de espera
        break;

      case "animating":
        // Ambos jugadores arrancan la secuencia de animación
        if ((req.initiatorId === myId || req.partnerId === myId) && !_activeFusion) {
          _startFusionSequence(req);
        }
        break;

      case "cancelled":
        if (req.initiatorId === myId || req.partnerId === myId) {
          _onFusionCancelled(req);
        }
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS UI
  // ═══════════════════════════════════════════════════════════════

  function _removeFusionModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.__ticker) clearInterval(el.__ticker);
    el.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  //  BOTÓN EN LA PARTY PANEL — inyección de UI
  // ═══════════════════════════════════════════════════════════════

  function _injectFusionButtons() {
    const partyPanel = document.getElementById("partyPanel");
    if (!partyPanel) {
      setTimeout(_injectFusionButtons, 500);
      return;
    }
    if (document.getElementById("fusMetamoruBtn")) return;

    const container = partyPanel.querySelector(".pvp-body")
      || partyPanel.querySelector("#partyMemberList")?.parentElement
      || partyPanel;

    const wrap = document.createElement("div");
    wrap.id    = "fusionBtnsWrap";
    wrap.style.cssText = "padding:0 10px 8px;display:flex;flex-direction:column;gap:5px;";
    wrap.innerHTML = `
      <div style="font-size:8px;letter-spacing:1px;color:#ce93d8;padding:4px 0 2px;font-family:Orbitron,monospace">
        — FUSIÓN —
      </div>
      <button id="fusMetamoruBtn" class="pvp-btn"
        style="border-color:rgba(206,147,216,.4);background:rgba(206,147,216,.1)">
        ⚡ FUSIÓN METAMORU
      </button>
      <button id="fusPotaraBtn" class="pvp-btn"
        style="border-color:rgba(206,147,216,.4);background:rgba(206,147,216,.1)">
        💍 FUSIÓN POTARA
      </button>
    `;

    const leaveBtn = document.getElementById("partyLeaveBtn");
    if (leaveBtn) {
      leaveBtn.parentElement.insertBefore(wrap, leaveBtn.parentElement.lastElementChild);
    } else {
      container.appendChild(wrap);
    }

    document.getElementById("fusMetamoruBtn").onclick = () => {
      const selId = _getSelectedPartyMember();
      if (!selId) return toast("Seleccioná un miembro de la party primero", "dmg");
      proposeFusion("metamoru", selId);
    };

    document.getElementById("fusPotaraBtn").onclick = () => {
      const selId = _getSelectedPartyMember();
      if (!selId) return toast("Seleccioná un miembro de la party primero", "dmg");
      proposeFusion("potara", selId);
    };
  }

  function _getSelectedPartyMember() {
    const active = document.querySelector("#partyMemberList .pvp-member.sel[data-id]");
    if (active) return active.dataset.id || null;
    return window._pvpSelectedMemberId || null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOK EN PVP-SYSTEM PARA EXPONER selectedMemberId
  // ═══════════════════════════════════════════════════════════════

  function _hookPvpSelectedMember() {
    document.addEventListener("click", e => {
      const member = e.target.closest?.("[data-id]");
      if (member && document.getElementById("partyMemberList")?.contains(member)) {
        window._pvpSelectedMemberId = member.dataset.id;
      }
    }, true);
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPDATE LOOP
  // ═══════════════════════════════════════════════════════════════

  function updateFusion() {
    if (!_activeFusion) return;
    // Lógica reactiva vía Firebase listener
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOK EN sendPlayerUpdate
  // ═══════════════════════════════════════════════════════════════

  function _hookSendPlayerUpdate() {
    const orig = window.sendPlayerUpdate;
    if (!orig || orig.__fusionHooked) return;
    // Guardar referencia al original para uso interno (posicionamiento)
    orig.__fusionOrig = orig;
    window.sendPlayerUpdate = function () {
      if (window._fusionInputBlocked) return;
      return orig.apply(this, arguments);
    };
    window.sendPlayerUpdate.__fusionHooked = true;
    window.sendPlayerUpdate.__fusionOrig   = orig;
  }

  // ═══════════════════════════════════════════════════════════════
  //  API PÚBLICA
  // ═══════════════════════════════════════════════════════════════

  function exportApi() {
    window.FusionSystem = {
      proposeFusion,
      swapFusionControl,
      splitFusion,
      isInFusion:      () => !!_activeFusion,
      hasControl:      () => _activeFusion?.controlId === G.myId,
      getActiveFusion: () => _activeFusion ? { ..._activeFusion } : null,
      update:          updateFusion,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════

  function main() {
    _listenRequests();
    _hookPvpSelectedMember();
    _hookSendPlayerUpdate();
    _patchRenderLoop();
    exportApi();
    setTimeout(_injectFusionButtons, 1000);
    console.log("[fusion-system] v2.0.0 — Sistema de fusión listo (Metamoru + Potara)");
  }

  waitForGame(main);

})();