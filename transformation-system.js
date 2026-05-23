/**
 * DRAGON WORLD Z — Transformation & Fusion System v1.0.0
 * ════════════════════════════════════════════════════════════════════
 *
 * CÓMO INCLUIRLO:
 *   <script src="character-system.js"></script>
 *   <script src="transformation-system.js"></script>   ← después del CS
 *   (En game.html también va antes de pvp-system.js)
 *
 * ════════════════════════════════════════════════════════════════════
 *
 *  TRANSFORMACIONES  (por slot de personaje)
 *  ─────────────────────────────────────────
 *  Cada transformación tiene:
 *    · name          – nombre visible
 *    · multiplier    – x0.5 a x10 (HP, Ki, ATK, DEF)
 *    · auraColor     – color del aura en esta forma
 *    · auraId        – id del aura (del catálogo)
 *    · spriteDataURL – spritesheet PNG opcional (mismo layout que el base)
 *    · hairColor     – color de pelo opcional
 *    · skinColor     – color de piel opcional
 *    · eyeColor, browColor, pupilColor – colores opcionales
 *    · hairId, faceId, topId, bottomId, shoesId, glovesId, accessoryId – overrides de piezas
 *    · kiCost        – ki necesario para activar (0 = gratis)
 *    · kiDrainRate   – ki por segundo que drena (0 = sin drenaje)
 *    · animSheet     – 'base' | 'combat' | 'special' (qué sheet usar)
 *
 *  FUSIONES  (entre dos jugadores en party)
 *  ─────────────────────────────────────────
 *  Cada fusión tiene:
 *    · id              – generado automático
 *    · name            – nombre de la fusión
 *    · type            – 'metamoru' | 'potara' | 'custom'
 *    · memberA         – playerId del primer miembro
 *    · memberB         – playerId del segundo miembro
 *    · multiplier      – x0.5 a x10
 *    · auraColor, auraId
 *    · spriteDataURL   – sheet del personaje fusionado (opcional)
 *    · duration        – duración en segundos (0 = permanente)
 *    · kiCost, kiDrainRate
 *
 * ════════════════════════════════════════════════════════════════════
 */

(function () {
  "use strict";

  // ═══════════════════════════════════════════════════════════════════
  //  CONSTANTES
  // ═══════════════════════════════════════════════════════════════════

  const MULTIPLIER_MIN = 0.1;
  const MULTIPLIER_MAX = 10;
  const MULTIPLIER_STEP = 0.1;
  const MULTIPLIER_PRESETS = [0.3, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const STORAGE_KEY_TRANSFORMS = "dragonz_transformations_v1";
  const STORAGE_KEY_FUSIONS    = "dragonz_fusions_v1";

  const FUSION_TYPES = [
    { id: "metamoru", label: "Fusión Metamoru", anim: "fusion_metamoru", icon: "🔀", color: "#00e5ff" },
    { id: "potara",   label: "Fusión Potara",   anim: "fusion_potara",   icon: "💍", color: "#ffd700" },
    { id: "custom",   label: "Custom",          anim: "fusion_metamoru", icon: "✨", color: "#e040fb" },
  ];

  // ═══════════════════════════════════════════════════════════════════
  //  CATÁLOGO DE TRANSFORMACIONES POR RAZA
  //  Usado por getDefaultTransformationsForRace() para pre-poblar slots
  //  y por el creator de index.html como fuente de verdad.
  // ═══════════════════════════════════════════════════════════════════

  const RACE_TRANSFORMATIONS = {};

  /**
   * Retorna las transformaciones predeterminadas para una raza dada.
   * Útil para pre-poblar el slot de un personaje nuevo.
   * @param {string} raceId
   * @returns {TransformDef[]}
   */
  function getDefaultTransformationsForRace(raceId) {
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ESTADO INTERNO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Mapa: slotIndex → [ ...transformaciones ]
   * @type {Object.<number, TransformDef[]>}
   */
  let _transformsBySlot = {};

  /**
   * Lista global de fusiones guardadas
   * @type {FusionDef[]}
   */
  let _fusionDefs = [];

  /**
   * Estado activo por jugador (incluyendo yo)
   * @type {Object.<string, ActiveState>}
   */
  let _activeStates = {};  // playerId → { type:'transform'|'fusion', def, startedAt, drainInterval }

  /**
   * Imagen cacheada de spritesheets de transformaciones
   * @type {Map.<string, HTMLImageElement>}
   */
  const _imgCache = new Map();

  // ═══════════════════════════════════════════════════════════════════
  //  UTILIDADES
  // ═══════════════════════════════════════════════════════════════════

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function _clampMult(v) {
    return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, parseFloat(v) || 1));
  }

  function _loadImage(dataURL) {
    if (!dataURL) return null;
    if (_imgCache.has(dataURL)) return _imgCache.get(dataURL);
    const img = new Image();
    img.src = dataURL;
    _imgCache.set(dataURL, img);
    return img;
  }

  function _deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function _toast(msg, type) {
    if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
    else if (typeof window.showToast === "function") window.showToast(msg, type || "success");
  }

  function _myPlayerId() {
    return window.myPlayerId || null;
  }

  function _myPlayer() {
    return window.player || null;
  }

  function _getCS() {
    return window.CharacterSystem || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PERSISTENCIA (localStorage)
  // ═══════════════════════════════════════════════════════════════════

  function _saveToStorage() {
    try {
      // Guardamos sin imágenes (sólo dataURL strings)
      const t = _deepClone(_transformsBySlot);
      const f = _deepClone(_fusionDefs);
      localStorage.setItem(STORAGE_KEY_TRANSFORMS, JSON.stringify(t));
      localStorage.setItem(STORAGE_KEY_FUSIONS,    JSON.stringify(f));
    } catch (e) {
      console.warn("[TransformSys] Error guardando en localStorage:", e);
    }
  }

  function _loadFromStorage() {
    try {
      const t = localStorage.getItem(STORAGE_KEY_TRANSFORMS);
      const f = localStorage.getItem(STORAGE_KEY_FUSIONS);
      if (t) {
        const parsed = JSON.parse(t);
        // Reconstruir keys como números
        Object.keys(parsed).forEach(k => {
          _transformsBySlot[parseInt(k, 10)] = parsed[k];
        });
      }
      if (f) {
        _fusionDefs = JSON.parse(f);
      }
    } catch (e) {
      console.warn("[TransformSys] Error cargando desde localStorage:", e);
      _transformsBySlot = {};
      _fusionDefs = [];
    }
  }

  function _importCreatorCustomTransforms() {
    try {
      const slot = Math.max(0, Math.min(10, parseInt(new URLSearchParams(location.search).get("slot") || localStorage.getItem("dragonCreatorZ_activeSlot") || "0", 10)));
      const rawSlots = localStorage.getItem("dragonCreatorZ_slots");
      if (!rawSlots) return;
      const slots = JSON.parse(rawSlots);
      const saved = Array.isArray(slots) ? slots[slot] : null;
      const customTfs = saved?.transformations?.customTfs;
      if (!Array.isArray(customTfs)) return;
      _transformsBySlot[slot] = customTfs.map((tf, index) => ({
        id: tf.id || ("ctf_" + index),
        name: tf.name || "Transformacion custom",
        multiplier: _clampMult(tf.mult ?? tf.multiplier ?? 2),
        auraColor: tf.auraColor || "#e040fb",
        auraId: tf.auraId || "a1",
        spriteDataURL: tf.spriteDataURL || null,
        kiCost: tf.kiCost ?? 0,
        kiDrainRate: tf.kiDrainRate ?? 0,
        tag: "CUST",
        order: index,
      }));
      _saveToStorage();
    } catch (e) {
      console.warn("[TransformSys] No se pudieron importar las custom del creator:", e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  API DE TRANSFORMACIONES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Retorna la lista de transformaciones para un slot dado.
   * @param {number} slotIndex
   * @returns {TransformDef[]}
   */
  function getTransformations(slotIndex) {
    return _transformsBySlot[slotIndex] || [];
  }

  /**
   * Agrega o reemplaza una transformación en un slot.
   * Si `def.id` ya existe en ese slot, lo reemplaza; si no, lo agrega.
   * @param {number} slotIndex
   * @param {Partial<TransformDef>} def
   * @returns {TransformDef}
   */
  function addTransformation(slotIndex, def) {
    if (!_transformsBySlot[slotIndex]) _transformsBySlot[slotIndex] = [];
    const list = _transformsBySlot[slotIndex];

    const entry = {
      id:           def.id || ("tf_" + _uid()),
      name:         def.name || "Transformación",
      multiplier:   _clampMult(def.multiplier ?? 2),
      auraColor:    def.auraColor || "#fdd835",
      auraId:       def.auraId   || "a1",
      spriteDataURL:def.spriteDataURL || null,
      hairColor:    def.hairColor    || null,
      skinColor:    def.skinColor    || null,
      eyeColor:     def.eyeColor     || null,
      browColor:    def.browColor    || null,
      pupilColor:   def.pupilColor   || null,
      hairId:       def.hairId       || null,
      faceId:       def.faceId       || null,
      topId:        def.topId        || null,
      bottomId:     def.bottomId     || null,
      shoesId:      def.shoesId      || null,
      glovesId:     def.glovesId     || null,
      accessoryId:  def.accessoryId  || null,
      kiCost:       def.kiCost       ?? 20,
      kiDrainRate:  def.kiDrainRate  ?? 0,
      animSheet:    def.animSheet    || "base",
      skinSlot:     def.skinSlot     || false,
      tag:          def.tag          || null,
      hint:         def.hint         || null,
      order:        def.order        ?? list.length,
    };

    const existing = list.findIndex(t => t.id === entry.id);
    if (existing !== -1) list[existing] = entry;
    else list.push(entry);

    _saveToStorage();
    return entry;
  }

  /**
   * Elimina una transformación de un slot por id.
   */
  function removeTransformation(slotIndex, transformId) {
    if (!_transformsBySlot[slotIndex]) return false;
    const before = _transformsBySlot[slotIndex].length;
    _transformsBySlot[slotIndex] = _transformsBySlot[slotIndex].filter(t => t.id !== transformId);
    _saveToStorage();
    return _transformsBySlot[slotIndex].length < before;
  }

  /**
   * Reordena las transformaciones de un slot según array de ids.
   */
  function reorderTransformations(slotIndex, orderedIds) {
    if (!_transformsBySlot[slotIndex]) return;
    const map = Object.fromEntries(_transformsBySlot[slotIndex].map(t => [t.id, t]));
    _transformsBySlot[slotIndex] = orderedIds.map(id => map[id]).filter(Boolean);
    _saveToStorage();
  }

  /**
   * Exporta las transformaciones de un slot como JSON descargable.
   */
  function exportTransformations(slotIndex) {
    const list = getTransformations(slotIndex);
    const blob = new Blob([JSON.stringify({ version: 1, slotIndex, transformations: list }, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `slot${slotIndex}_transforms.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /**
   * Importa transformaciones desde un JSON (puede ser el exportado o hecho a mano).
   * Si `merge` es true, agrega a las existentes; si es false, reemplaza.
   */
  function importTransformations(slotIndex, jsonOrObj, merge = true) {
    const data = typeof jsonOrObj === "string" ? JSON.parse(jsonOrObj) : jsonOrObj;
    const incoming = data.transformations || data;
    if (!Array.isArray(incoming)) throw new Error("Formato inválido");
    if (!merge) _transformsBySlot[slotIndex] = [];
    incoming.forEach(def => addTransformation(slotIndex, def));
    _saveToStorage();
    return getTransformations(slotIndex);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  API DE FUSIONES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Retorna todas las fusiones guardadas.
   */
  function getFusions() {
    return _fusionDefs;
  }

  /**
   * Retorna las fusiones donde el jugador local (o el id dado) participa.
   */
  function getMyFusions(playerId) {
    const pid = playerId || _myPlayerId();
    if (!pid) return [];
    return _fusionDefs.filter(f => f.memberA === pid || f.memberB === pid);
  }

  /**
   * Crea o actualiza una definición de fusión.
   */
  function addFusion(def) {
    const entry = {
      id:           def.id || ("fu_" + _uid()),
      name:         def.name        || "Fusión",
      type:         def.type        || "metamoru",
      memberA:      def.memberA     || null,
      memberB:      def.memberB     || null,
      multiplier:   _clampMult(def.multiplier ?? 2),
      auraColor:    def.auraColor   || "#00e5ff",
      auraId:       def.auraId      || "a1",
      spriteDataURL:def.spriteDataURL || null,
      duration:     def.duration    ?? 180,
      kiCost:       def.kiCost      ?? 30,
      kiDrainRate:  def.kiDrainRate ?? 2,
      hairColor:    def.hairColor   || null,
      skinColor:    def.skinColor   || null,
      eyeColor:     def.eyeColor    || null,
      topId:        def.topId       || null,
      bottomId:     def.bottomId    || null,
      shoesId:      def.shoesId     || null,
      hairId:       def.hairId      || null,
    };

    const existing = _fusionDefs.findIndex(f => f.id === entry.id);
    if (existing !== -1) _fusionDefs[existing] = entry;
    else _fusionDefs.push(entry);

    _saveToStorage();
    return entry;
  }

  /**
   * Elimina una fusión por id.
   */
  function removeFusion(fusionId) {
    const before = _fusionDefs.length;
    _fusionDefs = _fusionDefs.filter(f => f.id !== fusionId);
    _saveToStorage();
    return _fusionDefs.length < before;
  }

  /**
   * Exporta fusiones como JSON descargable.
   */
  function exportFusions() {
    const blob = new Blob([JSON.stringify({ version: 1, fusions: _fusionDefs }, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "fusions.json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  /**
   * Importa fusiones desde JSON.
   */
  function importFusions(jsonOrObj, merge = true) {
    const data = typeof jsonOrObj === "string" ? JSON.parse(jsonOrObj) : jsonOrObj;
    const incoming = data.fusions || data;
    if (!Array.isArray(incoming)) throw new Error("Formato inválido");
    if (!merge) _fusionDefs = [];
    incoming.forEach(def => addFusion(def));
    _saveToStorage();
    return _fusionDefs;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ACTIVACIÓN / DESACTIVACIÓN  (en juego)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Aplica los overrides de apariencia de una transformación o fusión
   * al player local (window.player y window.CharacterSystem.player).
   * Guarda el estado original para poder revertir.
   */
  function _applyAppearanceOverride(def) {
    const CS     = _getCS();
    const player = _myPlayer();
    if (!CS || !player) return;

    const app = player.appearance || {};

    // Guardar snapshot del estado BASE (solo si no hay uno ya)
    if (!player._baseAppearance) {
      player._baseAppearance = _deepClone(app);
      player._baseMaxHp      = player.maxHp;
      player._baseMaxKi      = player.maxKi;
      player._baseAtk        = player.atk;
      player._baseDef        = player.def;
    }

    // Overrides de colores y piezas
    const fields = ["hairColor","skinColor","eyeColor","browColor","pupilColor",
                    "hairId","faceId","topId","bottomId","shoesId","glovesId","accessoryId",
                    "auraColor","auraId"];
    fields.forEach(f => {
      if (def[f] !== null && def[f] !== undefined) app[f] = def[f];
    });

    // Spritesheet personalizado → inyectarlo como free customization
    // Prioridad: spriteDataURL propio de la TF, luego skinDataURL del TFSkinSystem
    const sheetURL = def.spriteDataURL || def.skinDataURL || null;
    if (sheetURL) {
      const existingFcId = player._transformFcId;
      if (existingFcId) CS.removeUserAccessory(existingFcId);
      const variantId = "tf_" + String(def.id || "custom").replace(/[^a-zA-Z0-9_-]/g, "_");
      app.variantCustomizations ||= {};
      app.variantCustomizations[variantId] = {
        id: variantId,
        label: def.name || "Transformacion",
        spriteDataURL: sheetURL,
        spriteImage: _loadImage(sheetURL),
        animFrames: 6,
        rowCount: 37,
        scale: 1,
      };
      app.variantId = variantId;
      player._transformVariantId = variantId;
    }

    // Stats multiplicados
    const mult = def.multiplier || 1;
    const base = player._baseMaxHp || player.maxHp || 100;
    player.maxHp = Math.round(base  * mult);
    player.maxKi = Math.round((player._baseMaxKi || player.maxKi || 100) * mult);
    if (player.atk !== undefined) player.atk = Math.round((player._baseAtk || player.atk || 10) * mult);
    if (player.def !== undefined) player.def = Math.round((player._baseDef || player.def || 5)  * mult);

    // Heal parcial al transformarse (20 % del nuevo max)
    player.hp = Math.min(player.maxHp, (player.hp || 1) + Math.round(player.maxHp * 0.2));
    player.ki = Math.min(player.maxKi, player.ki || 0);

    // Sync con CharacterSystem.player si existe
    if (CS.player && CS.player !== player) {
      Object.assign(CS.player.appearance, app);
    }

    if (CS.invalidateHairCache) CS.invalidateHairCache();
    if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
  }

  /**
   * Revierte la apariencia al estado base guardado.
   */
  function _revertAppearance() {
    const CS     = _getCS();
    const player = _myPlayer();
    if (!player || !player._baseAppearance) return;

    // Remover spritesheet de transformación si existe
    if (player._transformFcId && CS) {
      CS.removeUserAccessory(player._transformFcId);
      delete player._transformFcId;
    }
    delete player._transformVariantId;

    Object.assign(player.appearance, player._baseAppearance);
    player.maxHp = player._baseMaxHp || player.maxHp;
    player.maxKi = player._baseMaxKi || player.maxKi;
    if (player.atk !== undefined) player.atk = player._baseAtk || player.atk;
    if (player.def !== undefined) player.def = player._baseDef || player.def;

    // Clampar HP/Ki al nuevo max
    player.hp = Math.min(player.maxHp, player.hp || 1);
    player.ki = Math.min(player.maxKi, player.ki || 0);

    delete player._baseAppearance;
    delete player._baseMaxHp;
    delete player._baseMaxKi;
    delete player._baseAtk;
    delete player._baseDef;

    if (CS) {
      if (CS.player && CS.player !== player) Object.assign(CS.player.appearance, player.appearance);
      if (CS.invalidateHairCache) CS.invalidateHairCache();
    }
    if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
  }

  /**
   * Para el drenaje de ki activo.
   */
  function _clearDrain(playerId) {
    const state = _activeStates[playerId];
    if (state && state.drainInterval) {
      clearInterval(state.drainInterval);
      state.drainInterval = null;
    }
  }

  /**
   * Activa una transformación para el jugador local.
   * @param {TransformDef} transformDef
   */
  function activateTransformation(transformDef) {
    const player = _myPlayer();
    if (!player) return false;

    // Verificar ki
    if ((transformDef.kiCost || 0) > 0 && (player.ki || 0) < transformDef.kiCost) {
      _toast("Ki insuficiente", "error");
      return false;
    }

    // Desactivar estado previo si hay
    deactivateCurrent();

    player.ki = Math.max(0, (player.ki || 0) - (transformDef.kiCost || 0));

    const pid = _myPlayerId() || "local";
    _activeStates[pid] = {
      type:      "transform",
      def:       transformDef,
      startedAt: Date.now(),
    };

    _applyAppearanceOverride(transformDef);

    // Drenaje de ki
    if ((transformDef.kiDrainRate || 0) > 0) {
      _activeStates[pid].drainInterval = setInterval(() => {
        const p = _myPlayer();
        if (!p) { deactivateCurrent(); return; }
        p.ki = Math.max(0, (p.ki || 0) - transformDef.kiDrainRate);
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (p.ki <= 0) {
          _toast("Sin ki — forma revertida", "warning");
          deactivateCurrent();
        }
      }, 1000);
    }

    // Publicar apariencia actualizada si hay multiplayer
    if (typeof window.publishMyAppearance === "function") {
      setTimeout(() => window.publishMyAppearance(true), 100);
    }

    _toast("⚡ " + transformDef.name + " ×" + transformDef.multiplier, "success");
    _dispatchEvent("transformationActivated", { def: transformDef });
    return true;
  }

  /**
   * Activa una fusión para el jugador local.
   * Requiere que el otro miembro también la tenga registrada y esté en party.
   * @param {FusionDef} fusionDef
   */
  function activateFusion(fusionDef) {
    const player = _myPlayer();
    if (!player) return false;

    if ((fusionDef.kiCost || 0) > 0 && (player.ki || 0) < fusionDef.kiCost) {
      _toast("Ki insuficiente para la fusión", "error");
      return false;
    }

    deactivateCurrent();

    player.ki = Math.max(0, (player.ki || 0) - (fusionDef.kiCost || 0));

    const pid = _myPlayerId() || "local";
    _activeStates[pid] = {
      type:      "fusion",
      def:       fusionDef,
      startedAt: Date.now(),
    };

    _applyAppearanceOverride(fusionDef);

    // Drenaje
    if ((fusionDef.kiDrainRate || 0) > 0) {
      _activeStates[pid].drainInterval = setInterval(() => {
        const p = _myPlayer();
        if (!p) { deactivateCurrent(); return; }
        p.ki = Math.max(0, (p.ki || 0) - fusionDef.kiDrainRate);
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (p.ki <= 0) {
          _toast("Fusión terminada — sin ki", "warning");
          deactivateCurrent();
        }
      }, 1000);
    }

    // Duración fija
    if ((fusionDef.duration || 0) > 0) {
      setTimeout(() => {
        const state = _activeStates[pid];
        if (state && state.type === "fusion" && state.def.id === fusionDef.id) {
          _toast("Fusión terminada", "warning");
          deactivateCurrent();
        }
      }, fusionDef.duration * 1000);
    }

    if (typeof window.publishMyAppearance === "function") {
      setTimeout(() => window.publishMyAppearance(true), 100);
    }

    // Notificar vía Firebase si está disponible
    _broadcastFusionEvent(fusionDef, "start");

    _toast("💫 " + fusionDef.name + " ×" + fusionDef.multiplier, "success");
    _dispatchEvent("fusionActivated", { def: fusionDef });
    return true;
  }

  /**
   * Desactiva la transformación/fusión actual del jugador local.
   */
  function deactivateCurrent() {
    const pid = _myPlayerId() || "local";
    _clearDrain(pid);
    const state = _activeStates[pid];
    if (state) {
      if (state.type === "fusion") _broadcastFusionEvent(state.def, "end");
      delete _activeStates[pid];
    }
    _revertAppearance();
    if (typeof window.publishMyAppearance === "function") {
      setTimeout(() => window.publishMyAppearance(true), 100);
    }
    _dispatchEvent("transformationDeactivated", {});
  }

  /**
   * Retorna el estado activo del jugador local o null.
   */
  function getActiveState(playerId) {
    const pid = playerId || _myPlayerId() || "local";
    return _activeStates[pid] || null;
  }

  /**
   * True si el jugador local está transformado/fusionado.
   */
  function isTransformed() {
    return !!getActiveState();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EVENTOS CUSTOMIZADOS
  // ═══════════════════════════════════════════════════════════════════

  function _dispatchEvent(name, detail) {
    try {
      document.dispatchEvent(new CustomEvent("dragonz:" + name, { detail }));
    } catch (e) { /* silencioso */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BROADCAST DE FUSIÓN VÍA FIREBASE (para otros jugadores en party)
  // ═══════════════════════════════════════════════════════════════════

  function _broadcastFusionEvent(fusionDef, action) {
    const db = window.db;
    const pid = _myPlayerId();
    if (!db || !pid) return;
    try {
      db.ref("fusions/" + pid).set({
        action,
        fusionId:    fusionDef.id,
        fusionName:  fusionDef.name,
        partnerA:    fusionDef.memberA,
        partnerB:    fusionDef.memberB,
        multiplier:  fusionDef.multiplier,
        t:           Date.now(),
      });
    } catch (e) {
      console.warn("[TransformSys] No se pudo broadcastear fusión:", e);
    }
  }

  /**
   * Escucha fusiones activas de jugadores en party para mostrar el banner.
   */
  function _listenFusionBroadcasts() {
    const db = window.db;
    if (!db) return;
    try {
      db.ref("fusions").on("child_changed", snap => {
        const data = snap.val();
        if (!data) return;
        const pid = _myPlayerId();
        if (snap.key === pid) return; // no reaccionar a los propios

        // ¿Es alguien en mi party?
        const party = window.PvpSystem;
        const isMember = party ? party.isPartyMember(snap.key) : false;
        if (!isMember) return;

        if (data.action === "start") {
          _toast("💫 " + data.fusionName + " activada por otro miembro", "info");
          _showFusionBanner(data);
        }
      });
    } catch (e) { /* silencioso */ }
  }

  function _showFusionBanner(data) {
    const banner = document.getElementById("pvpArenaBanner") || document.getElementById("transformBanner");
    if (!banner) return;
    const prev = banner.textContent;
    banner.textContent = "💫 " + (data.fusionName || "FUSIÓN");
    banner.classList.add("show");
    setTimeout(() => { banner.classList.remove("show"); banner.textContent = prev; }, 3500);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PANEL DE TRANSFORMACIONES (UI en index.html)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Inyecta el panel completo de gestión de transformaciones en index.html.
   * Llámalo después de que el DOM esté listo y los slots cargados.
   *
   * @param {object} opts
   * @param {number} opts.slotIndex       – slot activo actual
   * @param {function} opts.getSlotIndex  – función que retorna el slot activo
   * @param {string}  [opts.containerId]  – id del contenedor donde insertar el panel
   */
  function injectCreatorPanel(opts = {}) {
    if (document.getElementById("tsCreatorPanel")) return;

    const getSlot = opts.getSlotIndex || (() => opts.slotIndex || 0);

    // ── Estilos ──────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.id = "tsCreatorCSS";
    style.textContent = `
      #tsCreatorPanel { display:flex; flex-direction:column; gap:0; }

      /* Botón de acceso rápido que se puede agregar en el header */
      #tsBtnOpenPanel {
        padding:6px 14px; background:rgba(224,64,251,.12); border:1px solid rgba(224,64,251,.4);
        border-radius:6px; color:#e040fb; font-family:Orbitron,monospace; font-size:9px;
        letter-spacing:1px; cursor:pointer; transition:all .15s;
      }
      #tsBtnOpenPanel:hover { background:rgba(224,64,251,.25); box-shadow:0 0 10px rgba(224,64,251,.3); }

      /* Modal overlay */
      #tsModal {
        display:none; position:fixed; inset:0; z-index:300;
        background:rgba(0,0,0,.75); backdrop-filter:blur(4px);
        align-items:center; justify-content:center;
      }
      #tsModal.open { display:flex; }

      #tsModalBox {
        background:#0d1020; border:1px solid #2a3560; border-radius:12px;
        width:min(680px,96vw); max-height:90vh; display:flex; flex-direction:column;
        box-shadow:0 8px 40px rgba(0,0,0,.7); overflow:hidden;
      }

      .ts-hdr {
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 18px; border-bottom:1px solid #2a3560; flex-shrink:0;
        background:linear-gradient(90deg,#0d1020,#111830,#0d1020);
      }
      .ts-hdr-title { font-family:Orbitron,monospace; font-size:13px; letter-spacing:3px; color:#e040fb; }
      .ts-hdr-close { background:none; border:none; color:#8892b0; font-size:20px; cursor:pointer; }

      /* Tabs */
      .ts-tabs {
        display:grid; grid-template-columns:1fr 1fr; flex-shrink:0;
        border-bottom:1px solid #2a3560;
      }
      .ts-tab {
        padding:9px; background:transparent; border:none; border-bottom:2px solid transparent;
        color:#8892b0; font-family:Orbitron,monospace; font-size:9px; letter-spacing:1px;
        cursor:pointer; text-align:center; transition:all .15s;
      }
      .ts-tab.active { color:#e040fb; border-bottom-color:#e040fb; background:rgba(224,64,251,.06); }
      .ts-tab:hover { color:#c8cfe8; background:rgba(255,255,255,.04); }

      /* Body con scroll */
      .ts-body { flex:1; overflow-y:auto; padding:14px 16px; scrollbar-width:thin; scrollbar-color:#2a3560 transparent; }
      .ts-body::-webkit-scrollbar { width:3px; }
      .ts-body::-webkit-scrollbar-thumb { background:#2a3560; border-radius:3px; }

      /* Panels dentro del body */
      .ts-panel { display:none; }
      .ts-panel.visible { display:block; }

      /* Lista de transformaciones/fusiones */
      .ts-item-list { display:flex; flex-direction:column; gap:6px; margin-bottom:12px; }
      .ts-item {
        display:flex; align-items:center; gap:10px; padding:10px 12px;
        background:#12172e; border:1px solid #2a3560; border-radius:8px;
        cursor:pointer; transition:all .15s;
      }
      .ts-item:hover { border-color:#e040fb; background:rgba(224,64,251,.07); }
      .ts-item.active-item { border-color:#00e676; background:rgba(0,255,157,.06); }
      .ts-item-name { flex:1; font-family:Orbitron,monospace; font-size:10px; color:#e8eaf6; letter-spacing:.5px; }
      .ts-item-mult { font-family:Orbitron,monospace; font-size:10px; color:#e040fb; margin-right:6px; }
      .ts-item-edit { background:none; border:1px solid #2a3560; border-radius:4px; padding:3px 7px; color:#8892b0; font-size:10px; cursor:pointer; }
      .ts-item-edit:hover { border-color:#e040fb; color:#e040fb; }
      .ts-item-del { background:none; border:1px solid rgba(255,23,68,.3); border-radius:4px; padding:3px 7px; color:#ff1744; font-size:10px; cursor:pointer; }
      .ts-item-del:hover { background:rgba(255,23,68,.15); }

      /* Botón agregar */
      .ts-add-btn {
        width:100%; padding:9px; background:rgba(224,64,251,.08); border:1px dashed rgba(224,64,251,.4);
        border-radius:6px; color:#e040fb; font-family:Orbitron,monospace; font-size:9px; letter-spacing:1px;
        cursor:pointer; transition:all .15s; margin-bottom:12px;
      }
      .ts-add-btn:hover { background:rgba(224,64,251,.18); border-color:#e040fb; }

      /* Formulario de edición */
      .ts-form { display:none; background:#0a0e1a; border:1px solid #2a3560; border-radius:8px; padding:14px; margin-bottom:12px; }
      .ts-form.visible { display:block; }
      .ts-form-title { font-family:Orbitron,monospace; font-size:10px; letter-spacing:2px; color:#e040fb; margin-bottom:12px; }

      .ts-field { margin-bottom:10px; }
      .ts-label { font-family:Orbitron,monospace; font-size:8px; letter-spacing:1px; color:#8892b0; display:block; margin-bottom:4px; }
      .ts-input {
        width:100%; padding:7px 10px; background:#12172e; border:1px solid #2a3560;
        border-radius:5px; color:#e8eaf6; font-family:Rajdhani,sans-serif; font-size:13px; outline:none;
        transition:border-color .15s;
      }
      .ts-input:focus { border-color:#e040fb; }
      .ts-input[type="color"] { padding:2px 4px; height:32px; cursor:pointer; }
      .ts-input[type="range"] { padding:0; accent-color:#e040fb; cursor:pointer; }
      .ts-select {
        width:100%; padding:7px 10px; background:#12172e; border:1px solid #2a3560;
        border-radius:5px; color:#e8eaf6; font-family:Rajdhani,sans-serif; font-size:13px; outline:none; cursor:pointer;
      }
      .ts-select:focus { border-color:#e040fb; }

      .ts-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .ts-row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }

      /* Multiplicador con slider + valor */
      .ts-mult-row { display:flex; align-items:center; gap:8px; }
      .ts-mult-val { font-family:Orbitron,monospace; font-size:14px; font-weight:700; color:#e040fb; min-width:38px; text-align:right; }

      /* Import de spritesheet */
      .ts-import-btn {
        display:flex; align-items:center; gap:8px; padding:7px 10px; cursor:pointer;
        background:rgba(0,229,255,.05); border:1px dashed rgba(0,229,255,.3);
        border-radius:5px; color:#00e5ff; font-family:Orbitron,monospace; font-size:8px; letter-spacing:1px;
        transition:all .15s;
      }
      .ts-import-btn:hover { background:rgba(0,229,255,.12); border-color:#00e5ff; }
      .ts-import-btn.loaded { border-color:#00ff9d; color:#00ff9d; background:rgba(0,255,157,.05); }
      .ts-import-btn input[type=file] { display:none; }
      .ts-import-fname { font-size:8px; color:#8892b0; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* Preview de sprite */
      .ts-preview-wrap { display:flex; justify-content:center; margin:6px 0; }
      .ts-preview { image-rendering:pixelated; border:1px solid #2a3560; border-radius:4px; background:#08090f; }

      /* Botones de acción del form */
      .ts-form-btns { display:flex; gap:8px; margin-top:12px; }
      .ts-btn-save {
        flex:1; padding:8px; background:rgba(224,64,251,.15); border:1px solid rgba(224,64,251,.5);
        border-radius:6px; color:#e040fb; font-family:Orbitron,monospace; font-size:9px; letter-spacing:1px; cursor:pointer;
      }
      .ts-btn-save:hover { background:rgba(224,64,251,.3); }
      .ts-btn-cancel {
        padding:8px 16px; background:transparent; border:1px solid #2a3560;
        border-radius:6px; color:#8892b0; font-family:Orbitron,monospace; font-size:9px; cursor:pointer;
      }
      .ts-btn-cancel:hover { border-color:#e8eaf6; color:#e8eaf6; }

      /* Import/Export JSON */
      .ts-io-row { display:flex; gap:8px; margin-top:8px; }
      .ts-io-btn {
        flex:1; padding:7px; background:#12172e; border:1px solid #2a3560;
        border-radius:5px; color:#8892b0; font-family:Orbitron,monospace; font-size:8px; letter-spacing:1px; cursor:pointer;
      }
      .ts-io-btn:hover { border-color:#e040fb; color:#e040fb; }

      /* Color swatches */
      .ts-swatch-row { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
      .ts-swatch { width:20px; height:20px; border-radius:3px; cursor:pointer; border:2px solid transparent; transition:all .1s; flex-shrink:0; }
      .ts-swatch:hover { transform:scale(1.2); }
      .ts-swatch.active { border-color:white; box-shadow:0 0 6px rgba(255,255,255,.4); }

      /* Info tooltip */
      .ts-hint { font-size:11px; color:#4a5880; margin-top:3px; line-height:1.4; }

      /* Aura preview dot */
      .ts-aura-dot { width:14px; height:14px; border-radius:50%; display:inline-block; vertical-align:middle; margin-left:6px; border:1px solid rgba(255,255,255,.2); }

      /* Fusion partner label */
      .ts-partner-info { font-size:11px; color:#00e5ff; background:rgba(0,229,255,.08); border:1px solid rgba(0,229,255,.2); border-radius:4px; padding:5px 8px; margin-top:4px; }
    `;
    document.head.appendChild(style);

    // ── HTML del modal ───────────────────────────────────────────────
    const modal = document.createElement("div");
    modal.id = "tsModal";
    modal.innerHTML = `
      <div id="tsModalBox">
        <div class="ts-hdr">
          <span class="ts-hdr-title">⚡ TRANSFORMACIONES Y FUSIONES</span>
          <button class="ts-hdr-close" id="tsModalClose">✕</button>
        </div>
        <div class="ts-tabs">
          <button class="ts-tab active" data-ts-tab="transforms">⚡ TRANSFORMACIONES</button>
          <button class="ts-tab"        data-ts-tab="fusions">💫 FUSIONES</button>
        </div>
        <div class="ts-body">

          <!-- ── PANEL: TRANSFORMACIONES ── -->
          <div class="ts-panel visible" id="tsPanelTransforms">
            <div class="ts-item-list" id="tsTransformList"></div>
            <button class="ts-add-btn" id="tsAddTransformBtn">+ AGREGAR TRANSFORMACIÓN</button>
            <div class="ts-form" id="tsTransformForm">
              <div class="ts-form-title" id="tsTransformFormTitle">NUEVA TRANSFORMACIÓN</div>

              <div class="ts-field">
                <label class="ts-label">NOMBRE</label>
                <input class="ts-input" id="tfName" type="text" maxlength="32" placeholder="Super Saiyan, UI, etc."/>
              </div>

              <div class="ts-field">
                <label class="ts-label">MULTIPLICADOR  <span id="tfMultDisplay" class="ts-mult-val">×2.0</span></label>
                <div class="ts-mult-row">
                  <input class="ts-input" id="tfMult" type="range" min="0.1" max="10" step="0.1" value="2" style="flex:1"/>
                </div>
                <div class="ts-swatch-row" id="tfMultPresets"></div>
                <p class="ts-hint">Multiplica HP, Ki, ATK y DEF. ×0.5 = forma debilitada, ×10 = ultra-instinto.</p>
              </div>

              <div class="ts-row">
                <div class="ts-field">
                  <label class="ts-label">KI NECESARIO PARA ACTIVAR</label>
                  <input class="ts-input" id="tfKiCost" type="number" min="0" max="9999" value="20"/>
                </div>
                <div class="ts-field">
                  <label class="ts-label">DRENAJE DE KI (por seg)</label>
                  <input class="ts-input" id="tfKiDrain" type="number" min="0" max="999" value="0"/>
                </div>
              </div>

              <div class="ts-row">
                <div class="ts-field">
                  <label class="ts-label">COLOR DE AURA <span class="ts-aura-dot" id="tfAuraDot"></span></label>
                  <input class="ts-input" id="tfAuraColor" type="color" value="#fdd835"/>
                </div>
                <div class="ts-field">
                  <label class="ts-label">TIPO DE AURA</label>
                  <select class="ts-select" id="tfAuraId"></select>
                </div>
              </div>

              <div class="ts-field">
                <label class="ts-label">COLOR DE PELO (opcional)</label>
                <input class="ts-input" id="tfHairColor" type="color" value="#f5c400"/>
                <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:#8892b0;cursor:pointer">
                  <input type="checkbox" id="tfHairColorEnable"/> Aplicar color de pelo
                </label>
              </div>

              <div class="ts-row">
                <div class="ts-field">
                  <label class="ts-label">COLOR DE PIEL (opcional)</label>
                  <input class="ts-input" id="tfSkinColor" type="color" value="#e8c898"/>
                  <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:#8892b0;cursor:pointer">
                    <input type="checkbox" id="tfSkinColorEnable"/> Aplicar
                  </label>
                </div>
                <div class="ts-field">
                  <label class="ts-label">COLOR DE OJOS (opcional)</label>
                  <input class="ts-input" id="tfEyeColor" type="color" value="#2979ff"/>
                  <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:#8892b0;cursor:pointer">
                    <input type="checkbox" id="tfEyeColorEnable"/> Aplicar
                  </label>
                </div>
              </div>

              <div class="ts-field">
                <label class="ts-label">SPRITESHEET PERSONALIZADO (PNG — mismo layout que el base)</label>
                <label class="ts-import-btn" id="tfSheetLabel">
                  <span>📁 IMPORTAR PNG</span>
                  <span class="ts-import-fname" id="tfSheetFname">sin archivo</span>
                  <input type="file" id="tfSheetFile" accept="image/png,image/webp,image/jpeg"/>
                </label>
                <div class="ts-preview-wrap" id="tfPreviewWrap" style="display:none">
                  <canvas class="ts-preview" id="tfPreviewCanvas" width="180" height="60"></canvas>
                </div>
              </div>

              <div class="ts-form-btns">
                <button class="ts-btn-save" id="tfSaveBtn">💾 GUARDAR</button>
                <button class="ts-btn-cancel" id="tfCancelBtn">CANCELAR</button>
              </div>
            </div>

            <div class="ts-io-row">
              <button class="ts-io-btn" id="tfExportBtn">⬇ EXPORTAR JSON</button>
              <label class="ts-io-btn" style="text-align:center;cursor:pointer">
                ⬆ IMPORTAR JSON
                <input type="file" id="tfImportFile" accept="application/json,.json" style="display:none"/>
              </label>
            </div>
          </div>

          <!-- ── PANEL: FUSIONES ── -->
          <div class="ts-panel" id="tsPanelFusions">
            <div class="ts-item-list" id="tsFusionList"></div>
            <button class="ts-add-btn" id="tsAddFusionBtn">+ AGREGAR FUSIÓN</button>
            <div class="ts-form" id="tsFusionForm">
              <div class="ts-form-title" id="tsFusionFormTitle">NUEVA FUSIÓN</div>

              <div class="ts-field">
                <label class="ts-label">NOMBRE DE LA FUSIÓN</label>
                <input class="ts-input" id="fuName" type="text" maxlength="32" placeholder="Gogeta, Vegito, etc."/>
              </div>

              <div class="ts-field">
                <label class="ts-label">TIPO DE FUSIÓN</label>
                <select class="ts-select" id="fuType">
                  ${FUSION_TYPES.map(f => `<option value="${f.id}">${f.icon} ${f.label}</option>`).join("")}
                </select>
              </div>

              <div class="ts-field">
                <label class="ts-label">MULTIPLICADOR  <span id="fuMultDisplay" class="ts-mult-val">×2.0</span></label>
                <div class="ts-mult-row">
                  <input class="ts-input" id="fuMult" type="range" min="0.1" max="10" step="0.1" value="2" style="flex:1"/>
                </div>
                <div class="ts-swatch-row" id="fuMultPresets"></div>
              </div>

              <div class="ts-row">
                <div class="ts-field">
                  <label class="ts-label">DURACIÓN (seg, 0=permanente)</label>
                  <input class="ts-input" id="fuDuration" type="number" min="0" value="180"/>
                </div>
                <div class="ts-field">
                  <label class="ts-label">KI NECESARIO</label>
                  <input class="ts-input" id="fuKiCost" type="number" min="0" value="30"/>
                </div>
              </div>

              <div class="ts-row">
                <div class="ts-field">
                  <label class="ts-label">DRENAJE KI (por seg)</label>
                  <input class="ts-input" id="fuKiDrain" type="number" min="0" value="2"/>
                </div>
                <div class="ts-field">
                  <label class="ts-label">COLOR DE AURA <span class="ts-aura-dot" id="fuAuraDot"></span></label>
                  <input class="ts-input" id="fuAuraColor" type="color" value="#00e5ff"/>
                </div>
              </div>

              <div class="ts-field">
                <label class="ts-label">MIEMBRO B (Player ID del compañero de fusión)</label>
                <input class="ts-input" id="fuMemberB" type="text" placeholder="ID del otro jugador (opcional)"/>
                <p class="ts-hint">Si dejás vacío, cualquier miembro de party puede activar esta fusión con vos.</p>
              </div>

              <div class="ts-field">
                <label class="ts-label">SPRITESHEET DE LA FUSIÓN (PNG — opcional)</label>
                <label class="ts-import-btn" id="fuSheetLabel">
                  <span>📁 IMPORTAR PNG</span>
                  <span class="ts-import-fname" id="fuSheetFname">sin archivo</span>
                  <input type="file" id="fuSheetFile" accept="image/png,image/webp,image/jpeg"/>
                </label>
              </div>

              <div class="ts-form-btns">
                <button class="ts-btn-save" id="fuSaveBtn">💾 GUARDAR FUSIÓN</button>
                <button class="ts-btn-cancel" id="fuCancelBtn">CANCELAR</button>
              </div>
            </div>

            <div class="ts-io-row">
              <button class="ts-io-btn" id="fuExportBtn">⬇ EXPORTAR JSON</button>
              <label class="ts-io-btn" style="text-align:center;cursor:pointer">
                ⬆ IMPORTAR JSON
                <input type="file" id="fuImportFile" accept="application/json,.json" style="display:none"/>
              </label>
            </div>
          </div>

        </div><!-- /.ts-body -->
      </div><!-- /#tsModalBox -->
    `;
    document.body.appendChild(modal);

    // ── Inicializar lógica del panel ─────────────────────────────────
    _initCreatorPanelLogic(getSlot);
  }

  // ─── Lógica interna del panel ────────────────────────────────────────

  function _initCreatorPanelLogic(getSlot) {
    const CS = _getCS() || {};

    // Rellenar select de auras
    const auras = CS.AURAS_CATALOG || [];
    ["tfAuraId"].forEach(selId => {
      const sel = document.getElementById(selId);
      if (!sel) return;
      auras.forEach(a => {
        const opt = document.createElement("option");
        opt.value = a.id; opt.textContent = a.name || a.id;
        sel.appendChild(opt);
      });
    });

    // Rellenar presets de multiplicador
    [["tfMultPresets","tfMult","tfMultDisplay"], ["fuMultPresets","fuMult","fuMultDisplay"]].forEach(([presetsId, sliderId, displayId]) => {
      const wrap = document.getElementById(presetsId);
      const slider = document.getElementById(sliderId);
      const display = document.getElementById(displayId);
      if (!wrap || !slider) return;
      MULTIPLIER_PRESETS.forEach(v => {
        const s = document.createElement("span");
        s.className = "ts-swatch"; s.title = "×" + v;
        s.style.cssText = `background:${_multToColor(v)};width:auto;height:auto;padding:2px 7px;font-family:Orbitron,monospace;font-size:8px;color:#fff;border-radius:4px;cursor:pointer`;
        s.textContent = "×" + v;
        s.onclick = () => {
          slider.value = v;
          if (display) display.textContent = "×" + v;
          _updateMultPresetHighlight(presetsId, v);
        };
        wrap.appendChild(s);
      });
      slider.addEventListener("input", () => {
        if (display) display.textContent = "×" + parseFloat(slider.value).toFixed(1);
        _updateMultPresetHighlight(presetsId, parseFloat(slider.value));
      });
    });

    // Aura dot live update
    const tfAuraColor = document.getElementById("tfAuraColor");
    const tfAuraDot   = document.getElementById("tfAuraDot");
    if (tfAuraColor && tfAuraDot) {
      tfAuraColor.addEventListener("input", () => { tfAuraDot.style.background = tfAuraColor.value; });
      tfAuraDot.style.background = tfAuraColor.value;
    }
    const fuAuraColor = document.getElementById("fuAuraColor");
    const fuAuraDot   = document.getElementById("fuAuraDot");
    if (fuAuraColor && fuAuraDot) {
      fuAuraColor.addEventListener("input", () => { fuAuraDot.style.background = fuAuraColor.value; });
      fuAuraDot.style.background = fuAuraColor.value;
    }

    // Tabs
    document.querySelectorAll("[data-ts-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-ts-tab]").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".ts-panel").forEach(p => p.classList.remove("visible"));
        btn.classList.add("active");
        const panelId = { transforms: "tsPanelTransforms", fusions: "tsPanelFusions" }[btn.dataset.tsTab];
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add("visible");
        renderTransformList(getSlot());
        renderFusionList();
      });
    });

    // Cerrar modal
    document.getElementById("tsModalClose")?.addEventListener("click", () => {
      document.getElementById("tsModal")?.classList.remove("open");
    });
    document.getElementById("tsModal")?.addEventListener("click", e => {
      if (e.target.id === "tsModal") document.getElementById("tsModal").classList.remove("open");
    });

    // ── TRANSFORMACIONES ──

    let _editingTransformId = null;
    let _tfSheetDataURL = null;

    document.getElementById("tsAddTransformBtn")?.addEventListener("click", () => {
      _editingTransformId = null; _tfSheetDataURL = null;
      _resetTransformForm();
      document.getElementById("tsTransformForm")?.classList.add("visible");
    });

    document.getElementById("tfCancelBtn")?.addEventListener("click", () => {
      document.getElementById("tsTransformForm")?.classList.remove("visible");
    });

    document.getElementById("tfSheetFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      _tfSheetDataURL = await _fileToDataURL(file);
      document.getElementById("tfSheetFname").textContent = file.name;
      document.getElementById("tfSheetLabel")?.classList.add("loaded");
      _renderTransformSheetPreview(_tfSheetDataURL);
      e.target.value = "";
    });

    document.getElementById("tfSaveBtn")?.addEventListener("click", () => {
      const name = document.getElementById("tfName")?.value?.trim();
      if (!name) { _toast("Escribí un nombre", "error"); return; }
      const mult = parseFloat(document.getElementById("tfMult")?.value || "2");
      const def = {
        id:          _editingTransformId || undefined,
        name,
        multiplier:  mult,
        auraColor:   document.getElementById("tfAuraColor")?.value || "#fdd835",
        auraId:      document.getElementById("tfAuraId")?.value    || "a1",
        kiCost:      parseInt(document.getElementById("tfKiCost")?.value  || "20", 10),
        kiDrainRate: parseInt(document.getElementById("tfKiDrain")?.value || "0",  10),
        hairColor:   document.getElementById("tfHairColorEnable")?.checked ? document.getElementById("tfHairColor")?.value : null,
        skinColor:   document.getElementById("tfSkinColorEnable")?.checked ? document.getElementById("tfSkinColor")?.value : null,
        eyeColor:    document.getElementById("tfEyeColorEnable")?.checked  ? document.getElementById("tfEyeColor")?.value  : null,
        spriteDataURL: _tfSheetDataURL || (_editingTransformId ? (getTransformations(getSlot()).find(t=>t.id===_editingTransformId)?.spriteDataURL || null) : null),
      };
      addTransformation(getSlot(), def);
      document.getElementById("tsTransformForm")?.classList.remove("visible");
      renderTransformList(getSlot());
      _toast("✅ Transformación guardada", "success");
    });

    // Export/Import JSON transformaciones
    document.getElementById("tfExportBtn")?.addEventListener("click", () => exportTransformations(getSlot()));
    document.getElementById("tfImportFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const txt = await file.text();
      try {
        importTransformations(getSlot(), txt, true);
        renderTransformList(getSlot());
        _toast("Transformaciones importadas", "success");
      } catch (err) { _toast("JSON inválido", "error"); }
      e.target.value = "";
    });

    // ── FUSIONES ──

    let _editingFusionId = null;
    let _fuSheetDataURL = null;

    document.getElementById("tsAddFusionBtn")?.addEventListener("click", () => {
      _editingFusionId = null; _fuSheetDataURL = null;
      _resetFusionForm();
      document.getElementById("tsFusionForm")?.classList.add("visible");
    });

    document.getElementById("fuCancelBtn")?.addEventListener("click", () => {
      document.getElementById("tsFusionForm")?.classList.remove("visible");
    });

    document.getElementById("fuSheetFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      _fuSheetDataURL = await _fileToDataURL(file);
      document.getElementById("fuSheetFname").textContent = file.name;
      document.getElementById("fuSheetLabel")?.classList.add("loaded");
      e.target.value = "";
    });

    document.getElementById("fuSaveBtn")?.addEventListener("click", () => {
      const name = document.getElementById("fuName")?.value?.trim();
      if (!name) { _toast("Escribí un nombre", "error"); return; }
      const myId = _myPlayerId() || "local_" + Date.now();
      const def = {
        id:           _editingFusionId || undefined,
        name,
        type:         document.getElementById("fuType")?.value        || "metamoru",
        multiplier:   parseFloat(document.getElementById("fuMult")?.value || "2"),
        duration:     parseInt(document.getElementById("fuDuration")?.value || "180", 10),
        kiCost:       parseInt(document.getElementById("fuKiCost")?.value   || "30",  10),
        kiDrainRate:  parseInt(document.getElementById("fuKiDrain")?.value  || "2",   10),
        auraColor:    document.getElementById("fuAuraColor")?.value || "#00e5ff",
        auraId:       "a1",
        memberA:      myId,
        memberB:      document.getElementById("fuMemberB")?.value?.trim() || null,
        spriteDataURL:_fuSheetDataURL || (_editingFusionId ? (_fusionDefs.find(f=>f.id===_editingFusionId)?.spriteDataURL || null) : null),
      };
      addFusion(def);
      document.getElementById("tsFusionForm")?.classList.remove("visible");
      renderFusionList();
      _toast("✅ Fusión guardada", "success");
    });

    document.getElementById("fuExportBtn")?.addEventListener("click", () => exportFusions());
    document.getElementById("fuImportFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const txt = await file.text();
      try {
        importFusions(txt, true);
        renderFusionList();
        _toast("Fusiones importadas", "success");
      } catch (err) { _toast("JSON inválido", "error"); }
      e.target.value = "";
    });

    // Render inicial
    renderTransformList(getSlot());
    renderFusionList();

    // Exponer para poder llamar desde afuera
    window.TransformationSystem._renderTransformList = renderTransformList;
    window.TransformationSystem._renderFusionList    = renderFusionList;
    window.TransformationSystem._editTransform       = (slotIndex, id) => {
      _editingTransformId = id;
      const t = getTransformations(slotIndex).find(x => x.id === id);
      if (!t) return;
      document.getElementById("tfName").value         = t.name;
      document.getElementById("tfMult").value         = t.multiplier;
      document.getElementById("tfMultDisplay").textContent = "×" + t.multiplier;
      document.getElementById("tfAuraColor").value    = t.auraColor   || "#fdd835";
      document.getElementById("tfAuraId").value       = t.auraId      || "a1";
      document.getElementById("tfKiCost").value       = t.kiCost      ?? 20;
      document.getElementById("tfKiDrain").value      = t.kiDrainRate ?? 0;
      document.getElementById("tfHairColorEnable").checked = !!t.hairColor;
      if (t.hairColor) document.getElementById("tfHairColor").value = t.hairColor;
      document.getElementById("tfSkinColorEnable").checked = !!t.skinColor;
      if (t.skinColor) document.getElementById("tfSkinColor").value = t.skinColor;
      document.getElementById("tfEyeColorEnable").checked  = !!t.eyeColor;
      if (t.eyeColor)  document.getElementById("tfEyeColor").value  = t.eyeColor;
      _tfSheetDataURL = t.spriteDataURL || null;
      if (_tfSheetDataURL) {
        document.getElementById("tfSheetFname").textContent = "sheet cargado";
        document.getElementById("tfSheetLabel")?.classList.add("loaded");
        _renderTransformSheetPreview(_tfSheetDataURL);
      }
      document.getElementById("tsTransformFormTitle").textContent = "EDITAR: " + t.name.toUpperCase();
      document.getElementById("tsTransformForm")?.classList.add("visible");
      document.getElementById("tfAuraDot").style.background = t.auraColor || "#fdd835";
    };
  }

  function _resetTransformForm() {
    ["tfName"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const mult = document.getElementById("tfMult"); if (mult) mult.value = "2";
    const disp = document.getElementById("tfMultDisplay"); if (disp) disp.textContent = "×2.0";
    document.getElementById("tfKiCost") && (document.getElementById("tfKiCost").value = "20");
    document.getElementById("tfKiDrain") && (document.getElementById("tfKiDrain").value = "0");
    document.getElementById("tfHairColorEnable") && (document.getElementById("tfHairColorEnable").checked = false);
    document.getElementById("tfSkinColorEnable") && (document.getElementById("tfSkinColorEnable").checked = false);
    document.getElementById("tfEyeColorEnable")  && (document.getElementById("tfEyeColorEnable").checked  = false);
    const fnameEl = document.getElementById("tfSheetFname"); if (fnameEl) fnameEl.textContent = "sin archivo";
    document.getElementById("tfSheetLabel")?.classList.remove("loaded");
    const pw = document.getElementById("tfPreviewWrap"); if (pw) pw.style.display = "none";
    const tt = document.getElementById("tsTransformFormTitle"); if (tt) tt.textContent = "NUEVA TRANSFORMACIÓN";
    const dot = document.getElementById("tfAuraDot"); if (dot) dot.style.background = "#fdd835";
  }

  function _resetFusionForm() {
    ["fuName","fuMemberB"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const mult = document.getElementById("fuMult"); if (mult) mult.value = "2";
    const disp = document.getElementById("fuMultDisplay"); if (disp) disp.textContent = "×2.0";
    document.getElementById("fuDuration") && (document.getElementById("fuDuration").value = "180");
    document.getElementById("fuKiCost")   && (document.getElementById("fuKiCost").value   = "30");
    document.getElementById("fuKiDrain")  && (document.getElementById("fuKiDrain").value  = "2");
    const fnameEl = document.getElementById("fuSheetFname"); if (fnameEl) fnameEl.textContent = "sin archivo";
    document.getElementById("fuSheetLabel")?.classList.remove("loaded");
    const tt = document.getElementById("tsFusionFormTitle"); if (tt) tt.textContent = "NUEVA FUSIÓN";
    const dot = document.getElementById("fuAuraDot"); if (dot) dot.style.background = "#00e5ff";
  }

  function renderTransformList(slotIndex) {
    const list = document.getElementById("tsTransformList");
    if (!list) return;
    const transforms = getTransformations(slotIndex);
    const activeState = getActiveState();
    list.innerHTML = "";
    if (transforms.length === 0) {
      list.innerHTML = `<p style="font-size:12px;color:#4a5880;text-align:center;padding:10px 0">Sin transformaciones para este slot. ¡Agregá una!</p>`;
      return;
    }
    transforms.forEach(t => {
      const isActive = activeState?.def?.id === t.id;
      const row = document.createElement("div");
      row.className = "ts-item" + (isActive ? " active-item" : "");
      row.innerHTML = `
        <span style="width:12px;height:12px;border-radius:50%;background:${t.auraColor||'#fdd835'};flex-shrink:0;border:1px solid rgba(255,255,255,.2)"></span>
        <span class="ts-item-name">${t.name}</span>
        <span class="ts-item-mult">×${t.multiplier}</span>
        <button class="ts-item-edit" data-id="${t.id}">✏️</button>
        <button class="ts-item-del" data-id="${t.id}">🗑</button>
      `;
      row.querySelector(".ts-item-edit").addEventListener("click", e => {
        e.stopPropagation();
        window.TransformationSystem._editTransform?.(slotIndex, t.id);
      });
      row.querySelector(".ts-item-del").addEventListener("click", e => {
        e.stopPropagation();
        if (confirm("¿Borrar la transformación \"" + t.name + "\"?")) {
          removeTransformation(slotIndex, t.id);
          renderTransformList(slotIndex);
        }
      });
      list.appendChild(row);
    });
  }

  function renderFusionList() {
    const list = document.getElementById("tsFusionList");
    if (!list) return;
    const fusions = getFusions();
    const activeState = getActiveState();
    list.innerHTML = "";
    if (fusions.length === 0) {
      list.innerHTML = `<p style="font-size:12px;color:#4a5880;text-align:center;padding:10px 0">Sin fusiones guardadas. ¡Creá una!</p>`;
      return;
    }
    fusions.forEach(f => {
      const isActive = activeState?.def?.id === f.id;
      const typeDef = FUSION_TYPES.find(t => t.id === f.type) || FUSION_TYPES[0];
      const row = document.createElement("div");
      row.className = "ts-item" + (isActive ? " active-item" : "");
      row.innerHTML = `
        <span>${typeDef.icon}</span>
        <span class="ts-item-name">${f.name}</span>
        <span class="ts-item-mult">×${f.multiplier}</span>
        <span style="font-size:9px;color:#4a5880;margin-right:4px">${f.duration > 0 ? f.duration + "s" : "∞"}</span>
        <button class="ts-item-del" data-id="${f.id}">🗑</button>
      `;
      row.querySelector(".ts-item-del").addEventListener("click", e => {
        e.stopPropagation();
        if (confirm("¿Borrar la fusión \"" + f.name + "\"?")) {
          removeFusion(f.id);
          renderFusionList();
        }
      });
      list.appendChild(row);
    });
  }

  // ── helpers UI ────────────────────────────────────────────────────

  function _multToColor(v) {
    if (v <= 1)   return "#4a5880";
    if (v <= 2)   return "#2979ff";
    if (v <= 3)   return "#00e676";
    if (v <= 5)   return "#f5c400";
    if (v <= 7)   return "#ff6a00";
    return "#ff1744";
  }

  function _updateMultPresetHighlight(presetsId, val) {
    const wrap = document.getElementById(presetsId);
    if (!wrap) return;
    wrap.querySelectorAll("span").forEach(s => {
      s.style.borderColor = parseFloat(s.textContent.replace("×","")) === val ? "white" : "transparent";
    });
  }

  function _renderTransformSheetPreview(dataURL) {
    if (!dataURL) return;
    const wrap = document.getElementById("tfPreviewWrap");
    const canvas = document.getElementById("tfPreviewCanvas");
    if (!wrap || !canvas) return;
    wrap.style.display = "flex";
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      const fw = Math.floor(img.naturalWidth / 6);
      const fh = Math.floor(img.naturalHeight / 37);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Dibuja los primeros 3 frames del idle (fila 1)
      for (let i = 0; i < 3; i++) {
        ctx.drawImage(img, fw * i, fh, fw, fh, 60 * i, 0, 60, 60);
      }
    };
    img.src = dataURL;
  }

  function _fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  PANEL DE SELECCIÓN EN JUEGO (game.html)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Inyecta el panel de activación en game.html.
   * Aparece como botón flotante ⚡ que abre un selector de transformaciones/fusiones.
   *
   * @param {object} opts
   * @param {function} opts.getSlotIndex – función que retorna el slot activo
   */
  function injectGamePanel(opts = {}) {
    if (document.getElementById("tsGamePanel")) return;

    const getSlot = opts.getSlotIndex || (() => {
      const p = new URLSearchParams(window.location.search);
      return parseInt(p.get("slot") || "0", 10);
    });

    // Estilos específicos del juego
    const style = document.createElement("style");
    style.id = "tsGameCSS";
    style.textContent = `
      #tsGameBtn {
        position:fixed; bottom:92px; right:14px; z-index:120;
        width:48px; height:48px; background:rgba(224,64,251,.18);
        border:2px solid rgba(224,64,251,.5); border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; pointer-events:auto; touch-action:manipulation;
        font-size:20px; backdrop-filter:blur(8px);
        box-shadow:0 0 14px rgba(224,64,251,.3);
        transition:all .2s;
      }
      #tsGameBtn:hover { background:rgba(224,64,251,.35); box-shadow:0 0 22px rgba(224,64,251,.5); }
      #tsGameBtn.transformed { background:rgba(0,255,157,.2); border-color:rgba(0,255,157,.7); box-shadow:0 0 16px rgba(0,255,157,.5); }

      #tsGamePanel {
        position:fixed; bottom:150px; right:14px; z-index:120;
        width:min(280px,88vw); background:rgba(8,9,15,.96);
        border:1px solid #2a3560; border-radius:10px;
        backdrop-filter:blur(12px); pointer-events:auto;
        display:none; flex-direction:column;
        box-shadow:0 8px 30px rgba(0,0,0,.6);
        font-family:Rajdhani,sans-serif;
      }
      #tsGamePanel.open { display:flex; }

      .tsgp-hdr {
        padding:10px 12px; border-bottom:1px solid #2a3560;
        font-family:Orbitron,monospace; font-size:10px;
        letter-spacing:2px; color:#e040fb; display:flex;
        align-items:center; justify-content:space-between;
      }
      .tsgp-close { background:none; border:none; color:#8892b0; font-size:16px; cursor:pointer; }

      .tsgp-tabs { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #2a3560; }
      .tsgp-tab { padding:7px; background:transparent; border:none; border-bottom:2px solid transparent;
        color:#8892b0; font-family:Orbitron,monospace; font-size:8px; letter-spacing:1px;
        cursor:pointer; text-align:center; transition:all .15s; }
      .tsgp-tab.active { color:#e040fb; border-bottom-color:#e040fb; background:rgba(224,64,251,.06); }

      .tsgp-body { max-height:280px; overflow-y:auto; padding:8px; scrollbar-width:thin; scrollbar-color:#2a3560 transparent; }
      .tsgp-panel { display:none; }
      .tsgp-panel.visible { display:block; }

      .tsgp-item {
        display:flex; align-items:center; gap:8px; padding:9px 10px; margin-bottom:5px;
        background:#12172e; border:1px solid #2a3560; border-radius:7px;
        cursor:pointer; transition:all .15s;
      }
      .tsgp-item:hover { border-color:#e040fb; background:rgba(224,64,251,.08); }
      .tsgp-item.active-item { border-color:#00e676; background:rgba(0,255,157,.07); }
      .tsgp-item-name { flex:1; font-family:Orbitron,monospace; font-size:9px; color:#e8eaf6; letter-spacing:.5px; }
      .tsgp-item-mult { font-family:Orbitron,monospace; font-size:9px; color:#e040fb; }
      .tsgp-item-meta { font-size:10px; color:#4a5880; }

      .tsgp-revert {
        margin:8px; padding:8px; background:rgba(255,23,68,.12);
        border:1px solid rgba(255,23,68,.35); border-radius:6px;
        color:#ff5252; font-family:Orbitron,monospace; font-size:8px;
        letter-spacing:1px; cursor:pointer; text-align:center;
        display:none; transition:all .15s;
      }
      .tsgp-revert.visible { display:block; }
      .tsgp-revert:hover { background:rgba(255,23,68,.25); }

      .tsgp-empty { font-size:11px; color:#4a5880; text-align:center; padding:14px 0; }

      /* Indicador de forma activa en HUD */
      #tsActiveFormBadge {
        display:none; position:fixed; top:65px; left:64px; z-index:15;
        background:rgba(224,64,251,.18); border:1px solid rgba(224,64,251,.5);
        border-radius:6px; padding:3px 8px; pointer-events:none;
        font-family:Orbitron,monospace; font-size:8px; letter-spacing:1px; color:#e040fb;
        backdrop-filter:blur(6px);
      }
      #tsActiveFormBadge.visible { display:block; }
    `;
    document.head.appendChild(style);

    // Badge en HUD
    const badge = document.createElement("div");
    badge.id = "tsActiveFormBadge";
    document.getElementById("hud")?.appendChild(badge);

    // Botón flotante
    const btn = document.createElement("button");
    btn.id = "tsGameBtn"; btn.type = "button"; btn.textContent = "⚡";
    btn.title = "Transformaciones";
    document.body.appendChild(btn);

    // Panel
    const panel = document.createElement("div");
    panel.id = "tsGamePanel";
    panel.innerHTML = `
      <div class="tsgp-hdr">
        <span>⚡ FORMAS</span>
        <button class="tsgp-close" id="tsgpClose">✕</button>
      </div>
      <div class="tsgp-tabs">
        <button class="tsgp-tab active" data-tsgp-tab="transforms">⚡ TRANSF.</button>
        <button class="tsgp-tab"        data-tsgp-tab="fusions">💫 FUSIONES</button>
      </div>
      <div class="tsgp-body">
        <div class="tsgp-panel visible" id="tsgpPanelTransforms"></div>
        <div class="tsgp-panel"         id="tsgpPanelFusions"></div>
      </div>
      <button class="tsgp-revert" id="tsgpRevertBtn">↩ VOLVER A FORMA BASE</button>
    `;
    document.body.appendChild(panel);

    // Lógica del panel de juego
    btn.addEventListener("click", () => {
      const isOpen = panel.classList.toggle("open");
      if (isOpen) { renderGameTransforms(getSlot()); renderGameFusions(); }
    });
    document.getElementById("tsgpClose")?.addEventListener("click", () => panel.classList.remove("open"));

    document.querySelectorAll("[data-tsgp-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-tsgp-tab]").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tsgp-panel").forEach(p => p.classList.remove("visible"));
        tab.classList.add("active");
        const panels = { transforms: "tsgpPanelTransforms", fusions: "tsgpPanelFusions" };
        document.getElementById(panels[tab.dataset.tsgpTab])?.classList.add("visible");
      });
    });

    document.getElementById("tsgpRevertBtn")?.addEventListener("click", () => {
      deactivateCurrent();
      panel.classList.remove("open");
      _updateGameBadge();
    });

    // Escuchar eventos para actualizar badge
    document.addEventListener("dragonz:transformationActivated", () => { _updateGameBadge(); renderGameTransforms(getSlot()); });
    document.addEventListener("dragonz:transformationDeactivated", () => { _updateGameBadge(); renderGameTransforms(getSlot()); renderGameFusions(); });
    document.addEventListener("dragonz:fusionActivated", () => { _updateGameBadge(); renderGameFusions(); });

    _updateGameBadge();
    _listenFusionBroadcasts();
  }

  function renderGameTransforms(slotIndex) {
    const wrap = document.getElementById("tsgpPanelTransforms");
    if (!wrap) return;
    const list = getTransformations(slotIndex);
    const activeState = getActiveState();
    wrap.innerHTML = "";

    if (list.length === 0) {
      wrap.innerHTML = `<p class="tsgp-empty">Sin transformaciones.<br>Creá una en el Creator.</p>`;
      return;
    }

    list.forEach(t => {
      const isActive = activeState?.def?.id === t.id;
      const item = document.createElement("div");
      item.className = "tsgp-item" + (isActive ? " active-item" : "");
      const kiInfo = (t.kiCost > 0 ? " · " + t.kiCost + " Ki" : "") + (t.kiDrainRate > 0 ? " · −" + t.kiDrainRate + "/s" : "");
      item.innerHTML = `
        <span style="width:10px;height:10px;border-radius:50%;background:${t.auraColor||'#fdd835'};flex-shrink:0"></span>
        <span class="tsgp-item-name">${t.name}</span>
        <span class="tsgp-item-mult">×${t.multiplier}</span>
        <span class="tsgp-item-meta">${kiInfo}</span>
      `;
      item.addEventListener("click", () => {
        if (isActive) { deactivateCurrent(); }
        else { activateTransformation(t); }
        document.getElementById("tsGamePanel")?.classList.remove("open");
        _updateGameBadge();
      });
      wrap.appendChild(item);
    });
  }

  function renderGameFusions() {
    const wrap = document.getElementById("tsgpPanelFusions");
    if (!wrap) return;
    const myId = _myPlayerId() || "local";
    const list = getMyFusions(myId);
    const activeState = getActiveState();
    wrap.innerHTML = "";

    if (list.length === 0) {
      wrap.innerHTML = `<p class="tsgp-empty">Sin fusiones disponibles.<br>Creá una en el Creator.</p>`;
      return;
    }

    list.forEach(f => {
      const isActive = activeState?.def?.id === f.id;
      const typeDef = FUSION_TYPES.find(t => t.id === f.type) || FUSION_TYPES[0];
      const item = document.createElement("div");
      item.className = "tsgp-item" + (isActive ? " active-item" : "");
      const durInfo = f.duration > 0 ? f.duration + "s" : "∞";
      item.innerHTML = `
        <span>${typeDef.icon}</span>
        <span class="tsgp-item-name">${f.name}</span>
        <span class="tsgp-item-mult">×${f.multiplier}</span>
        <span class="tsgp-item-meta">${durInfo}</span>
      `;
      item.addEventListener("click", () => {
        if (isActive) { deactivateCurrent(); }
        else { activateFusion(f); }
        document.getElementById("tsGamePanel")?.classList.remove("open");
        _updateGameBadge();
      });
      wrap.appendChild(item);
    });
  }

  function _updateGameBadge() {
    const state = getActiveState();
    const btn   = document.getElementById("tsGameBtn");
    const badge = document.getElementById("tsActiveFormBadge");
    const revert = document.getElementById("tsgpRevertBtn");

    if (state) {
      if (btn)   { btn.textContent = "✨"; btn.classList.add("transformed"); }
      if (badge) { badge.textContent = (state.type === "fusion" ? "💫 " : "⚡ ") + state.def.name + " ×" + state.def.multiplier; badge.classList.add("visible"); }
      if (revert) revert.classList.add("visible");
    } else {
      if (btn)   { btn.textContent = "⚡"; btn.classList.remove("transformed"); }
      if (badge) badge.classList.remove("visible");
      if (revert) revert.classList.remove("visible");
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  HOOK AL SISTEMA DE PVP (multiplicar daño)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Llama a esto después de que pvp-system.js cargue para que
   * el multiplicador de transformación afecte el daño en PvP.
   * El hook modifica `window.performPvpAction` si existe.
   */
  function hookPvpDamage() {
    const orig = window.performPvpAction;
    if (!orig || orig.__tsSysHooked) return;

    window.performPvpAction = function (atkType, ...args) {
      const state = getActiveState();
      if (state && window.player) {
        const mult = state.def.multiplier || 1;
        // Guardamos y sobreescribimos atk temporalmente
        const origAtk = window.player.atk;
        window.player.atk = Math.round((window.player._baseAtk || origAtk || 10) * mult);
        const result = orig.call(this, atkType, ...args);
        // No necesitamos restaurar porque _applyAppearanceOverride ya actualizó player.atk
        return result;
      }
      return orig.call(this, atkType, ...args);
    };
    window.performPvpAction.__tsSysHooked = true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  INIT AUTOMÁTICO
  // ═══════════════════════════════════════════════════════════════════

  function _autoInit() {
    _loadFromStorage();
    _importCreatorCustomTransforms();
    console.log("[TransformationSystem] Listo. Slots cargados:", Object.keys(_transformsBySlot).length, "| Fusiones:", _fusionDefs.length);

    // Si estamos en game.html, inyectar panel de juego cuando el juego cargue
    if (document.getElementById("gameCanvas") || document.getElementById("loadBar")) {
      const tryInject = () => {
        if (window.player && window.myPlayerId) {
          injectGamePanel();
          setTimeout(hookPvpDamage, 2000); // esperar a que pvp-system.js termine
        } else {
          setTimeout(tryInject, 500);
        }
      };
      tryInject();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  EXPORT
  // ═══════════════════════════════════════════════════════════════════

  const TransformationSystem = {
    // Transformaciones
    getTransformations,
    addTransformation,
    removeTransformation,
    reorderTransformations,
    exportTransformations,
    importTransformations,

    // Fusiones
    getFusions,
    getMyFusions,
    addFusion,
    removeFusion,
    exportFusions,
    importFusions,

    // Activación en juego
    activateTransformation,
    activateFusion,
    deactivateCurrent,
    getActiveState,
    isTransformed,

    // UI
    injectCreatorPanel,
    injectGamePanel,
    hookPvpDamage,

    // Constantes expuestas
    MULTIPLIER_MIN, MULTIPLIER_MAX, MULTIPLIER_STEP, MULTIPLIER_PRESETS,
    FUSION_TYPES,

    // Catálogo de TFs por raza
    RACE_TRANSFORMATIONS,
    getDefaultTransformationsForRace,
  };

  window.TransformationSystem = TransformationSystem;

  // Auto-init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _autoInit);
  } else {
    _autoInit();
  }

})();
