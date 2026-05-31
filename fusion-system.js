// @ts-nocheck
/**
 * DRAGON WORLD Z — Fusion System v1.0.0
 *
 * ══════════════════════════════════════════════════════════════════
 *  SISTEMA DE FUSIÓN — Metamoru y Potara
 *
 *  Firebase paths:
 *    fusionRequests/{requestId}   → propuesta de fusión entre dos jugadores
 *    fusionState/{partyId}        → estado activo de fusión (quién controla, swap)
 *
 *  FLUJO:
 *    1. Jugador A propone fusión (Metamoru o Potara) al jugador B de la party
 *    2. B acepta → ambos abren modal para elegir transformación de fusión
 *    3. Si alguno no elige en 7s → cancelación automática
 *    4. Ambos eligen la misma transf. → se reproduce la animación sincronizada
 *       - A queda a la izquierda mirando → (facing = 1)
 *       - B queda a la derecha mirando ← (facing = -1)
 *    5. Animación termina → B desaparece (hidden), A recibe la skin de fusión
 *    6. A puede presionar SWAP para ceder el control a B (B reaparece, A desaparece)
 *    7. Cualquiera puede DESHACER la fusión (revert)
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
      transformId:   string,          // id de la transformación elegida
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
  //  ANIMACIÓN DE FUSIÓN — reproducción local + broadcast
  // ═══════════════════════════════════════════════════════════════

  /**
   * Posiciona a los dos jugadores para la animación:
   *   - Iniciador a la izquierda, mirando derecha  (facing = 1)
   *   - Partner  a la derecha,  mirando izquierda  (facing = -1)
   * Ambos se pegan (x cercano) y quedan el uno frente al otro.
   */
  function _positionForFusion(initiatorId, partnerId) {
    const p = G.player;
    const other = G.others[partnerId] || G.others[initiatorId];
    const isInit = G.myId === initiatorId;

    // Centro entre los dos jugadores
    const midX = p.x; // nos movemos ambos al centro

    if (isInit) {
      // Iniciador: izquierda, facing →
      p.x = midX - 28;
      p.facing = 1;
    } else {
      // Partner: derecha, facing ←
      p.x = midX + 28;
      p.facing = -1;
    }
  }

  /**
   * Reproduce la animación de fusión en el animator local.
   * Usa setSpecialMode para acceder al SPECIAL_ACTIONS_META (row 27/28).
   */
  function _playFusionAnim(type, onComplete) {
    const anim = G.myAnim;
    if (!anim) { onComplete && onComplete(); return; }
    const animKey = FUSION_ANIM_TYPES[type] || "fusion_metamoru";
    anim.setBattleMode && anim.setBattleMode(false);
    anim.setSpecialMode && anim.setSpecialMode(true);
    anim.play(animKey, () => {
      // Al terminar, volver al modo normal
      anim.setSpecialMode && anim.setSpecialMode(false);
      anim.play("idle");
      onComplete && onComplete();
    });
  }

  /**
   * Reproduce la animación de fusión en el animator remoto de un jugador.
   */
  function _playRemoteFusionAnim(playerId, type) {
    const anim = G.animators[playerId];
    if (!anim) return;
    const animKey = FUSION_ANIM_TYPES[type] || "fusion_metamoru";
    anim.setBattleMode && anim.setBattleMode(false);
    anim.setSpecialMode && anim.setSpecialMode(true);
    anim.play(animKey, () => {
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
    const TS = G.TS;
    if (!TS) return;
    // Buscar skin en el catálogo
    const catalog = TS.SPECIAL_SKIN_CATALOG || [];
    const entry = catalog.find(e => e.skinKey === transformId) || null;
    if (!entry) return;

    // Usar transformPlayer para aplicar la transformación (maneja stats + skin)
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

  /**
   * "Oculta" al partner marcándolo en Firebase con hidden:true.
   * El loop de renderizado en game.html respeta `p.hidden`.
   * Si el juego no tiene esa bandera, la agregamos como hook aquí.
   */
  function _hideRemotePlayer(playerId) {
    if (!G.db) return;
    G.db.ref("players/" + playerId).update({ fusionHidden: true, t: Date.now() });
  }

  function _showRemotePlayer(playerId) {
    if (!G.db) return;
    G.db.ref("players/" + playerId).update({ fusionHidden: false, t: Date.now() });
  }

  /**
   * Hook en el render loop para saltear jugadores con fusionHidden = true.
   * Se llama una sola vez desde main().
   */
  function _patchRenderLoop() {
    // Parchamos la función _drawRemotePlayers si existe, o bien
    // ponemos una propiedad en otherPlayers que el loop puede leer.
    // La solución más limpia es extender otherPlayers con fusionHidden.
    // game.html ya itera `for (const [id, p] of Object.entries(otherPlayers))`
    // Si p.fusionHidden está en Firebase, llega al objeto otherPlayers en el próximo tick.
    // No necesitamos parchear nada más — el campo viene directo de Firebase.
    // Sí necesitamos que el render loop lo respete:
    const origDraw = window._fusionHookApplied;
    if (origDraw) return;
    window._fusionHookApplied = true;

    // Monkey-patch de Object.entries solo en el canvas loop es invasivo.
    // Usamos un enfoque más limpio: exponer una función de filtro que game.html
    // puede llamar. Y como fallback, inyectamos CSS que oculta el sprite via
    // una marca en el DOM de la etiqueta del jugador. Para el caso de renderizado
    // canvas puro, la mejor solución sin tocar game.html es marcar
    // otherPlayers[id].fusionHidden y que este sistema lo respete en update().
    // La implementación definitiva se explica en los comentarios de updateFusion().
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
    if (!isPartyMember(targetId)) return toast("El jugador no está en tu party", "dmg");
    if (_activeFusion) return toast("Ya estás en una fusión activa", "dmg");
    if (!FUSION_ANIM_TYPES[type]) return toast("Tipo de fusión inválido", "dmg");

    const id = "fus_" + G.myId + "_" + targetId + "_" + Date.now();
    _reqRef(id).set({
      id,
      type,
      initiatorId: G.myId,
      initiatorName: G.player?.name || "?",
      partnerId: targetId,
      partnerName: G.others[targetId]?.name || "?",
      status: "pending",
      initiatorTransform: null,
      partnerTransform: null,
      t: Date.now(),
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
    // Actualizar estado → choosing, para que ambos elijan transformación
    _reqRef(req.id).update({ status: "choosing", t: Date.now() });
    // Mostrar selector de transformación al partner
    _showTransformPicker(req, "partner");
    // Iniciar timeout: si no elige en 7s, cancelar
    _startChooseTimer(req);
  }

  function _declineFusionRequest(req) {
    _removeFusionModal("fusionInviteModal");
    _reqRef(req.id).update({ status: "cancelled", cancelReason: "declined", t: Date.now() });
    _pendingRequest = null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MODAL — ELEGIR TRANSFORMACIÓN
  // ═══════════════════════════════════════════════════════════════

  /**
   * Muestra el selector de transformaciones de fusión.
   * Filtra solo transformaciones con "fusion" en el skinKey o en el label.
   */
  function _showTransformPicker(req, role) {
    _removeFusionModal("fusionPickerModal");
    const TS = G.TS;
    const catalog = TS?.SPECIAL_SKIN_CATALOG || [];

    // Todas las transformaciones disponibles para elegir como forma fusionada
    // (no filtramos por raza aquí — la fusión puede tomar cualquier forma)
    const options = catalog;

    const typeName = req.type === "metamoru" ? "⚡ METAMORU" : "💍 POTARA";
    let optHtml = "";
    options.forEach(e => {
      optHtml += `
        <button class="fus-tf-opt" data-id="${e.skinKey}"
          style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;
                 background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);
                 border-radius:6px;color:#e8eaf6;font-family:Rajdhani,sans-serif;
                 font-size:11px;cursor:pointer;text-align:left;margin-bottom:4px;">
          <span style="font-size:16px">${e.icon}</span>
          <span style="color:${e.color};font-weight:bold">${e.label}</span>
          <span style="margin-left:auto;font-size:9px;color:#8892b0">${e.group}</span>
        </button>`;
    });

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
      <div style="font-size:10px;color:#c8cfe8;margin-bottom:10px">Elegí la forma fusionada</div>
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
      btn.onclick = () => {
        const tfId = btn.dataset.id;
        _chooseFusionTransform(req, role, tfId);
      };
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

  /**
   * El iniciador también debe elegir su transformación cuando el partner acepta.
   * Escuchamos el cambio a "choosing" y mostramos el picker al iniciador.
   */
  function _onPartnerAccepted(req) {
    _showTransformPicker(req, "initiator");
    _startChooseTimer(req);
  }

  // ═══════════════════════════════════════════════════════════════
  //  LÓGICA DE ELECCIÓN Y VERIFICACIÓN
  // ═══════════════════════════════════════════════════════════════

  function _chooseFusionTransform(req, role, transformId) {
    _removeFusionModal("fusionPickerModal");
    _clearChooseTimer();

    const field = role === "initiator" ? "initiatorTransform" : "partnerTransform";
    _reqRef(req.id).update({ [field]: transformId, t: Date.now() });
    toast("Esperando al otro jugador...", "info");

    // Re-leer para ver si el otro ya eligió
    _reqRef(req.id).once("value", snap => {
      const updated = snap.val();
      if (updated) _checkBothChose(updated);
    });
  }

  function _checkBothChose(req) {
    if (!req.initiatorTransform || !req.partnerTransform) return;

    // Verificar que ambos eligieron la misma transformación
    if (req.initiatorTransform !== req.partnerTransform) {
      // Si no coinciden, cancelar con mensaje explicativo
      // Solo el iniciador ejecuta esto para evitar doble escritura
      if (G.myId === req.initiatorId) {
        _reqRef(req.id).update({
          status: "cancelled",
          cancelReason: "transform_mismatch",
          t: Date.now(),
        });
      }
      return;
    }

    // Ambos eligieron la misma → lanzar animación
    if (G.myId === req.initiatorId) {
      _reqRef(req.id).update({ status: "animating", t: Date.now() });
    }
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

  function _startFusionSequence(req) {
    const myId = G.myId;
    const isInit = myId === req.initiatorId;
    const role = isInit ? "initiator" : "partner";

    // Posicionar jugadores
    _positionForFusion(req.initiatorId, req.partnerId);

    // Reproducir animación local
    _playFusionAnim(req.type, () => {
      _onFusionAnimComplete(req, role);
    });

    // Reproducir animación en el animator remoto del otro jugador
    const otherId = isInit ? req.partnerId : req.initiatorId;
    _playRemoteFusionAnim(otherId, req.type);

    // Publicar posición/facing sincronizado
    if (typeof window.publishMyAppearance === "function") {
      setTimeout(() => window.publishMyAppearance(true), 100);
    }
  }

  function _onFusionAnimComplete(req, role) {
    const transformId = req.initiatorTransform; // ambos eligieron la misma

    if (role === "initiator") {
      // El iniciador toma el control con la skin de fusión
      _saveMySkin();
      _applyFusionSkin(transformId);
      _hideRemotePlayer(req.partnerId);

      // Crear estado de fusión en Firebase
      const stateId = "fusst_" + req.id;
      _stateRef(stateId).set({
        id: stateId,
        requestId: req.id,
        type: req.type,
        initiatorId: req.initiatorId,
        partnerId: req.partnerId,
        transformId,
        controlId: req.initiatorId,   // iniciador controla primero
        active: true,
        t: Date.now(),
      });

      _activeFusion = {
        id: stateId,
        type: req.type,
        initiatorId: req.initiatorId,
        partnerId: req.partnerId,
        transformId,
        controlId: req.initiatorId,
        myRole: "initiator",
      };

      _listenFusionState(stateId);
      _showFusionHud();
      toast("¡FUSIÓN COMPLETA! Sos el piloto", "lvl");

    } else {
      // El partner: espera a que Firebase confirme estado, se oculta
      _applyFusionSkin(transformId);
      toast("Fusionado — esperá el control", "info");

      // Buscar el stateId escuchando Firebase
      G.db.ref("fusionState").orderByChild("requestId").equalTo(req.id).once("value", snap => {
        const states = snap.val();
        if (!states) return;
        const stateId = Object.keys(states)[0];
        const stateData = states[stateId];
        _activeFusion = {
          id: stateId,
          type: stateData.type,
          initiatorId: stateData.initiatorId,
          partnerId: stateData.partnerId,
          transformId: stateData.transformId,
          controlId: stateData.controlId,
          myRole: "partner",
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

  /**
   * Actualiza quién controla: si soy yo, habilito controles normales;
   * si no, deshabilito movimiento y oculto mi sprite vía fusionHidden.
   *
   * No existe "locked" en setControlMode — usamos una bandera propia
   * que el hook de sendPlayerUpdate respeta.
   */
  function _updateFusionControl(controlId) {
    const myId = G.myId;
    const iControl = controlId === myId;

    if (iControl) {
      // Tengo el control → habilitar movimiento normal
      window._fusionInputBlocked = false;
      // Asegurar que mi sprite es visible para los demás
      if (G.online) _showRemotePlayer(myId);
      _showFusionHud();
    } else {
      // No tengo el control → bloquear inputs, ocultar mi sprite
      window._fusionInputBlocked = true;
      if (G.online) _hideRemotePlayer(myId);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  SWAP DE CONTROL
  // ═══════════════════════════════════════════════════════════════

  function swapFusionControl() {
    if (!_activeFusion) return toast("No estás en una fusión", "dmg");
    if (_activeFusion.controlId !== G.myId) return toast("No tenés el control ahora mismo", "dmg");

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

    // Restaurar skins y controles
    _revertFusionSkin();
    _showRemotePlayer(state.initiatorId);
    _showRemotePlayer(state.partnerId);

    if (typeof window.setControlMode === "function") {
      window.setControlMode("rp");
    }

    _removeFusionModal("fusionHud");
    _activeFusion = null;
    toast("La fusión se deshizo", "info");
  }

  function _onFusionCancelled(req) {
    _clearChooseTimer();
    _removeFusionModal("fusionPickerModal");
    _removeFusionModal("fusionInviteModal");
    _pendingRequest = null;

    const reasons = {
      declined:           "El otro jugador rechazó la fusión",
      timeout:            "Tiempo agotado — fusión cancelada",
      transform_mismatch: "Deben elegir la misma transformación para fusionarse",
      user_cancel:        "Fusión cancelada",
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

    const iControl = _activeFusion.controlId === G.myId;
    const TS = G.TS;
    const catalog = TS?.SPECIAL_SKIN_CATALOG || [];
    const tf = catalog.find(e => e.skinKey === _activeFusion.transformId);
    const tfLabel = tf?.label || _activeFusion.transformId;
    const typeName = _activeFusion.type === "metamoru" ? "METAMORU" : "POTARA";

    const el = document.createElement("div");
    el.id = "fusionHud";
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
      <div style="font-size:9px;color:${iControl ? '#69f0ae' : '#ff7043'}">
        ${iControl ? "🟢 CONTROLANDO" : "⏸ EN ESPERA"}
      </div>
      ${iControl ? `
        <button id="fusSwapBtn" style="padding:6px 10px;background:rgba(206,147,216,.2);
          border:1px solid #ce93d8;border-radius:6px;color:#ce93d8;
          font-family:Orbitron,monospace;font-size:8px;cursor:pointer">
          🔄 SWAP
        </button>` : ""}
      <button id="fusSplitBtn" style="padding:6px 10px;background:rgba(255,23,68,.15);
        border:1px solid #ff5252;border-radius:6px;color:#ff5252;
        font-family:Orbitron,monospace;font-size:8px;cursor:pointer">
        ✕ ROMPER
      </button>
    `;
    document.body.appendChild(el);

    document.getElementById("fusSplitBtn").onclick = splitFusion;
    const swapBtn = document.getElementById("fusSwapBtn");
    if (swapBtn) swapBtn.onclick = swapFusionControl;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LISTENERS GLOBALES — manejar cambio a "choosing" para el iniciador
  // ═══════════════════════════════════════════════════════════════

  function _listenRequests() {
    if (!G.db) return;
    if (_reqListener) _reqListener.off();
    _reqListener = G.db.ref("fusionRequests");
    _reqListener.on("child_added",   _dispatchRequest);
    _reqListener.on("child_changed", _dispatchRequest);
  }

  function _dispatchRequest(snap) {
    const req = snap.val();
    if (!req) return;
    const myId = G.myId;

    // Stale (más de 30s)
    if (Date.now() - (req.t || 0) > 30000) return;

    switch (req.status) {
      case "pending":
        // Solo el partner recibe la invitación
        if (req.partnerId === myId && !_pendingRequest) {
          _pendingRequest = { ...req, firebaseKey: snap.key };
          _showFusionInviteModal(req);
        }
        // El iniciador también debe abrir el picker cuando el partner acepta
        // (eso ocurre en "choosing")
        break;

      case "choosing":
        // Iniciador: el partner aceptó → mostrar picker
        if (req.initiatorId === myId && !document.getElementById("fusionPickerModal")) {
          _onPartnerAccepted(req);
        }
        // Partner: ya está mostrando el picker (lo abrió en _acceptFusionRequest)
        // Verificar si ambos eligieron
        _checkBothChose(req);
        break;

      case "animating":
        if ((req.initiatorId === myId || req.partnerId === myId)
            && !_activeFusion) {
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

  /**
   * Inyecta botones "Fusión Metamoru" y "Fusión Potara" en el panel de party
   * del pvp-system, visibles cuando hay un miembro seleccionado.
   */
  function _injectFusionButtons() {
    // Esperamos a que exista el panel de party
    const partyPanel = document.getElementById("partyPanel");
    if (!partyPanel) {
      setTimeout(_injectFusionButtons, 500);
      return;
    }
    if (document.getElementById("fusMetamoruBtn")) return; // ya inyectado

    const container = partyPanel.querySelector(".pvp-body")
      || partyPanel.querySelector("#partyMemberList")?.parentElement
      || partyPanel;

    const wrap = document.createElement("div");
    wrap.id = "fusionBtnsWrap";
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
    // Insertar antes del botón de salir de party
    const leaveBtn = document.getElementById("partyLeaveBtn");
    if (leaveBtn) {
      leaveBtn.parentElement.insertBefore(wrap, leaveBtn.parentElement.lastElementChild);
    } else {
      container.appendChild(wrap);
    }

    document.getElementById("fusMetamoruBtn").onclick = () => {
      const sel = window.PvpSystem?._selectedMemberId
        || window._fusionSelectedMember
        || null;
      // Intentar obtener el miembro seleccionado desde el pvp-system
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

  /**
   * Obtiene el miembro de party actualmente seleccionado en el panel pvp.
   * pvp-system marca la fila activa con la clase "sel" y data-id.
   */
  function _getSelectedPartyMember() {
    // pvp-system marca el elemento seleccionado con clase "sel"
    const active = document.querySelector("#partyMemberList .pvp-member.sel[data-id]");
    if (active) return active.dataset.id || null;
    // Fallback via exposición del pvp-system
    return window._pvpSelectedMemberId || null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HOOK EN PVP-SYSTEM PARA EXPONER selectedMemberId
  // ═══════════════════════════════════════════════════════════════

  function _hookPvpSelectedMember() {
    // pvp-system usa `selectedMemberId` internamente pero no lo expone.
    // Observamos los clicks en la lista de party para capturarlo.
    document.addEventListener("click", e => {
      const member = e.target.closest?.("[data-id]");
      if (member && document.getElementById("partyMemberList")?.contains(member)) {
        window._pvpSelectedMemberId = member.dataset.id;
      }
    }, true);
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPDATE LOOP — llamado desde el game loop principal
  // ═══════════════════════════════════════════════════════════════

  /**
   * Debe llamarse en el game loop (requestAnimationFrame) para mantener
   * la lógica de ocultado de jugadores sincronizada con el render.
   *
   * game.html verifica `p.fusionHidden` si este sistema lo escribe en Firebase
   * y llega vía el listener de players. No necesitamos parchear el render loop
   * directamente — el campo fusionHidden en el objeto `p` de otherPlayers
   * hace que este sistema sea no-invasivo.
   *
   * Para el jugador local: si no tengo el control, bloqueamos el movimiento
   * via window._fusionInputBlocked, que el hook de sendPlayerUpdate respeta.
   */
  function updateFusion() {
    if (!_activeFusion) return;
    // La lógica de control ya es reactiva vía Firebase listener
  }

  /**
   * Hook en sendPlayerUpdate para que cuando el jugador no tiene el control
   * de la fusión, no pueda mover su personaje ni publicar posición.
   */
  function _hookSendPlayerUpdate() {
    const orig = window.sendPlayerUpdate;
    if (!orig || orig.__fusionHooked) return;
    window.sendPlayerUpdate = function () {
      if (window._fusionInputBlocked) return; // no somos el piloto ahora
      return orig.apply(this, arguments);
    };
    window.sendPlayerUpdate.__fusionHooked = true;

    // También bloquear el movimiento en el keydown del game loop
    // Exponemos la bandera para que game.html la pueda leer
    // (game.html lee player.x/y — si no enviamos, simplemente no se mueve en red)
  }

  // ═══════════════════════════════════════════════════════════════
  //  API PÚBLICA
  // ═══════════════════════════════════════════════════════════════

  function exportApi() {
    window.FusionSystem = {
      proposeFusion,
      swapFusionControl,
      splitFusion,
      isInFusion: () => !!_activeFusion,
      hasControl: () => _activeFusion?.controlId === G.myId,
      getActiveFusion: () => _activeFusion ? { ..._activeFusion } : null,
      update: updateFusion,
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
    // Inyectar botones cuando el party panel esté listo
    setTimeout(_injectFusionButtons, 1000);
    console.log("[fusion-system] Sistema de fusión listo (Metamoru + Potara)");
  }

  waitForGame(main);

})();