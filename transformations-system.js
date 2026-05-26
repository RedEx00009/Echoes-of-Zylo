// @ts-nocheck
/**
 * DRAGON CREATOR Z — Transformations System v1.0.0
 *
 * ══════════════════════════════════════════════════════════════════
 *  MÓDULO MODULAR DE TRANSFORMACIONES
 *
 *  Expone window.TransformationsSystem con:
 *    - TRANSFORMATIONS          → catálogo global de transformaciones
 *    - Transformation           → clase constructora de transformaciones
 *    - playerTransState         → estado del jugador (baseStats, currentStats, activeTransformation)
 *    - transformPlayer(id)      → activa una transformación por ID
 *    - revertTransformation()   → vuelve a la forma base
 *    - applyTransformationStats(tr, baseStats) → calcula stats modificados
 *
 *  REGLAS DE MULTIPLICADORES:
 *    · Rango: x0.3 hasta x10
 *    · Afectan: daño (str), velocidad (spd), defensa (def), ki
 *    · NUNCA modifican HP actual ni HP máximo
 *
 *  COMPATIBILIDAD DE RAZAS:
 *    · Cada transformación puede declarar `races: ["all"]` para ser universal
 *      o un array de razas específicas: ["saiyan", "human", ...]
 *    · El helper isTransformationAvailable(trId, raceId) verifica compatibilidad
 * ══════════════════════════════════════════════════════════════════
 */

"use strict";

(function () {

  // ═══════════════════════════════════════════════════════════════
  //  CONSTANTES DEL SISTEMA
  // ═══════════════════════════════════════════════════════════════

  /** Multiplicador mínimo permitido para cualquier stat (excepto HP) */
  const MULT_MIN = 0.3;

  /** Multiplicador máximo permitido para cualquier stat (excepto HP) */
  const MULT_MAX = 10;

  /** Stats que los multiplicadores PUEDEN modificar */
  const MODIFIABLE_STATS = ["str", "spd", "def", "ki"];

  /** Stats que los multiplicadores NUNCA pueden modificar */
  const PROTECTED_STATS = ["hp", "hpMax", "currentHp"];

  // ═══════════════════════════════════════════════════════════════
  //  CLASE Transformation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Representa una transformación de personaje.
   *
   * @param {Object} config - Configuración de la transformación
   * @param {string}   config.id         - Identificador único
   * @param {string}   config.name       - Nombre visible (ej: "Super Saiyan")
   * @param {number}   config.level      - Nivel de la transformación (1–99)
   * @param {string[]} config.races      - Razas compatibles: ["all"] o ["saiyan", "human", ...]
   * @param {string}   config.auraColor  - Color HEX del aura
   * @param {string}   [config.icon]     - Emoji o carácter visual
   * @param {string}   [config.description] - Descripción breve
   * @param {Object}   config.multipliers - Multiplicadores de stats
   * @param {number}   config.multipliers.str - Multiplicador de daño/fuerza (0.3–10)
   * @param {number}   config.multipliers.spd - Multiplicador de velocidad   (0.3–10)
   * @param {number}   config.multipliers.def - Multiplicador de defensa      (0.3–10)
   * @param {number}   config.multipliers.ki  - Multiplicador de ki           (0.3–10)
   * @param {string}   [config.skinDataURL]   - DataURL del spritesheet custom (opcional)
   */
  class Transformation {
    constructor(config = {}) {
      this.id          = config.id          || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      this.name        = config.name        || "Transformación";
      this.level       = Math.max(1, Math.min(99, parseInt(config.level) || 1));
      this.races       = Array.isArray(config.races) ? config.races : ["all"];
      this.auraColor   = config.auraColor   || "#fdd835";
      this.icon        = config.icon        || "⚡";
      this.description = config.description || "";
      this.skinDataURL = config.skinDataURL || null;
      this.skinPath    = config.skinPath    || null;  // ruta local (ej: "skins/ozaru_saiyajin.png")
      this.appearance  = { ...(config.appearance || {}) };
      // Tamaño de display propio de esta transformación (0 = heredar base)
      this.displayW    = config.displayW ? Math.max(40, Math.min(400, parseInt(config.displayW) || 0)) : 0;
      this.displayH    = config.displayH ? Math.max(40, Math.min(500, parseInt(config.displayH) || 0)) : 0;

      // Runtime (no se persiste en JSON crudo)
      this.skinImage   = null;

      // Validar y clampar multiplicadores
      const rawMult    = config.multipliers || {};
      this.multipliers = {
        str: _clampMult(rawMult.str !== undefined ? rawMult.str : 1),
        spd: _clampMult(rawMult.spd !== undefined ? rawMult.spd : 1),
        def: _clampMult(rawMult.def !== undefined ? rawMult.def : 1),
        ki:  _clampMult(rawMult.ki  !== undefined ? rawMult.ki  : 1),
        // HP está aquí SOLO como no-op para claridad — NUNCA se aplica
        hp:  1,
      };
    }

    /** Devuelve true si esta transformación es compatible con la raza dada */
    isAvailableFor(raceId) {
      return this.races.includes("all") || this.races.includes(raceId);
    }

    /**
     * Devuelve un resumen de multiplicadores legible.
     * @returns {string}
     */
    getMultSummary() {
      const m = this.multipliers;
      return [
        `STR ×${m.str}`,
        `SPD ×${m.spd}`,
        `DEF ×${m.def}`,
        `KI ×${m.ki}`,
      ].join("  ·  ");
    }

    /**
     * Serializa la transformación a un objeto JSON seguro (sin imágenes runtime).
     * @returns {Object}
     */
    toJSON() {
      return {
        id:          this.id,
        name:        this.name,
        level:       this.level,
        races:       this.races,
        auraColor:   this.auraColor,
        icon:        this.icon,
        description: this.description,
        multipliers: { ...this.multipliers },
        skinDataURL: this.skinDataURL,
        skinPath:    this.skinPath    || null,
        appearance:  { ...this.appearance },
        displayW:    this.displayW || 0,
        displayH:    this.displayH || 0,
      };
    }

    /**
     * Reconstruye una instancia de Transformation desde un JSON guardado.
     * @param {Object} json
     * @returns {Transformation}
     */
    static fromJSON(json) {
      return new Transformation(json);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGO GLOBAL — TRANSFORMATIONS
  //  (Array vacío, listo para ser poblado por el juego o el creator)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Catálogo principal de transformaciones.
   * Cada entrada es una instancia de Transformation.
   *
   * Para añadir transformaciones desde el exterior:
   *   window.TransformationsSystem.TRANSFORMATIONS.push(
   *     new window.TransformationsSystem.Transformation({ ... })
   *   );
   *
   * Transformaciones universales (races: ["all"]) funcionan con cualquier raza.
   * Transformaciones específicas (races: ["saiyan"]) solo aplican a esa raza.
   */
  const TRANSFORMATIONS = [];

  // ─── Ejemplos comentados — descomentar para precargar transformaciones ───
  /*
  TRANSFORMATIONS.push(new Transformation({
    id:          "kaioken",
    name:        "Kaioken",
    level:       1,
    races:       ["all"],          // Universal
    auraColor:   "#ff1744",
    icon:        "🔴",
    description: "Multiplica el ki y la fuerza a costa de la defensa.",
    multipliers: { str: 2, spd: 1.5, def: 0.7, ki: 2 },
  }));

  TRANSFORMATIONS.push(new Transformation({
    id:          "super_saiyan",
    name:        "Super Saiyan",
    level:       1,
    races:       ["saiyan"],       // Solo Saiyans
    auraColor:   "#fdd835",
    icon:        "💛",
    description: "La primera transformación legendaria de los Saiyans.",
    multipliers: { str: 5, spd: 3, def: 2.5, ki: 5 },
  }));

  TRANSFORMATIONS.push(new Transformation({
    id:          "super_saiyan_2",
    name:        "Super Saiyan 2",
    level:       2,
    races:       ["saiyan"],
    auraColor:   "#fdd835",
    icon:        "⚡",
    description: "El poder que superó a Cell.",
    multipliers: { str: 7.5, spd: 5, def: 3.5, ki: 7.5 },
  }));

  TRANSFORMATIONS.push(new Transformation({
    id:          "namekian_giant",
    name:        "Forma Gigante",
    level:       1,
    races:       ["namekian"],
    auraColor:   "#00e676",
    icon:        "🟢",
    description: "Expansión corporal característica de los Namekianos.",
    multipliers: { str: 4, spd: 0.5, def: 6, ki: 2 },
  }));
  */

  // ═══════════════════════════════════════════════════════════════
  //  ESTADO DEL JUGADOR — playerTransState
  // ═══════════════════════════════════════════════════════════════

  /**
   * Estado de transformación del jugador.
   *
   * IMPORTANTE: baseStats y currentStats NO incluyen hp/hpMax.
   *   - El HP actual y el HP máximo son manejados por el sistema de combate,
   *     no por este módulo. Los multiplicadores de transformación NUNCA los tocan.
   *
   * baseStats:   stats base sin ningún modificador
   * currentStats: stats actuales (con multiplicadores aplicados si hay transformación activa)
   * activeTransformation: instancia de Transformation activa, o null si está en forma base
   */
  const playerTransState = {
    /** Stats base del personaje (sin transformación). Solo str/spd/def/ki. */
    baseStats: {
      str: 80,
      spd: 80,
      def: 80,
      ki:  80,
      // hp y hpMax NO están aquí — los maneja el sistema de combate
    },

    /** Stats actuales (post-multiplicadores). Se recalculan al transformar/revertir. */
    currentStats: {
      str: 80,
      spd: 80,
      def: 80,
      ki:  80,
    },

    /** Referencia a la Transformation activa, o null si está en forma base */
    activeTransformation: null,

    /** Historial de activaciones (para debugging / UI) */
    _history: [],
  };

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS INTERNOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Clampea un multiplicador al rango [MULT_MIN, MULT_MAX].
   * @param {number} val
   * @returns {number}
   */
  function _clampMult(val) {
    const n = parseFloat(val);
    if (!isFinite(n)) return 1;
    return Math.max(MULT_MIN, Math.min(MULT_MAX, n));
  }

  /**
   * Busca una transformación en el catálogo por ID.
   * @param {string} id
   * @returns {Transformation|null}
   */
  function _findById(id) {
    return TRANSFORMATIONS.find(t => t.id === id) || null;
  }

  /**
   * Redondea un número al entero más cercano, clampeado a [0, 9999].
   * @param {number} val
   * @returns {number}
   */
  function _capStat(val) {
    return Math.max(0, Math.min(9999, Math.round(val)));
  }

  // ═══════════════════════════════════════════════════════════════
  //  FUNCIÓN PRINCIPAL — applyTransformationStats
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calcula los stats modificados por una transformación.
   * NUNCA modifica hp actual ni hp máximo.
   *
   * @param {Transformation} tr      - Transformación a aplicar
   * @param {Object}         baseStats - Stats base del personaje
   * @returns {Object} - Nuevo objeto con stats calculados
   *
   * @example
   *   const newStats = applyTransformationStats(superSaiyan, player.baseStats);
   *   // newStats.str === Math.round(player.baseStats.str * 5)
   *   // newStats.hp  === NO EXISTE (nunca se toca)
   */
  function applyTransformationStats(tr, baseStats) {
    if (!tr || !baseStats) {
      console.warn("[TransSys] applyTransformationStats: argumentos inválidos.");
      return { ...baseStats };
    }

    const result = {};

    // Solo aplicar multiplicadores a los stats permitidos
    MODIFIABLE_STATS.forEach(stat => {
      if (baseStats[stat] !== undefined) {
        const mult = _clampMult(tr.multipliers[stat] || 1);
        result[stat] = _capStat(baseStats[stat] * mult);
      }
    });

    // PROTECCIÓN EXPLÍCITA: copiar HP sin modificar si existe en baseStats
    // (normalmente no debería existir aquí, pero por seguridad lo pasamos intacto)
    PROTECTED_STATS.forEach(stat => {
      if (baseStats[stat] !== undefined) {
        result[stat] = baseStats[stat]; // copia directa, sin multiplicador
      }
    });

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  //  transformPlayer(id)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Activa una transformación en el jugador por su ID.
   * Modifica playerTransState.currentStats y playerTransState.activeTransformation.
   * NUNCA toca hp actual ni hp máximo.
   *
   * @param {string} id - ID de la transformación a activar
   * @param {Object} [options]
   * @param {string} [options.raceId] - Raza del jugador (para validar compatibilidad)
   * @returns {{ success: boolean, transformation: Transformation|null, currentStats: Object }}
   */
  function transformPlayer(id, options = {}) {
    const tr = _findById(id);

    if (!tr) {
      console.warn(`[TransSys] transformPlayer: transformación "${id}" no encontrada.`);
      return { success: false, transformation: null, currentStats: { ...playerTransState.currentStats } };
    }

    // Validar compatibilidad de raza (opcional)
    if (options.raceId && !tr.isAvailableFor(options.raceId)) {
      console.warn(`[TransSys] transformPlayer: "${id}" no disponible para raza "${options.raceId}".`);
      return { success: false, transformation: null, currentStats: { ...playerTransState.currentStats } };
    }

    // Calcular nuevos stats
    const newStats = applyTransformationStats(tr, playerTransState.baseStats);

    // Aplicar al estado del jugador
    playerTransState.activeTransformation = tr;
    playerTransState.currentStats = newStats;

    // Registrar en historial
    playerTransState._history.push({
      action:    "transform",
      id:        tr.id,
      name:      tr.name,
      timestamp: Date.now(),
    });

    console.info(`[TransSys] Transformación activada: ${tr.name} (${tr.getMultSummary()})`);

    return {
      success:        true,
      transformation: tr,
      currentStats:   { ...newStats },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  revertTransformation()
  // ═══════════════════════════════════════════════════════════════

  /**
   * Revierte al jugador a su forma base.
   * Restaura currentStats desde baseStats.
   * NUNCA modifica hp actual ni hp máximo.
   *
   * @returns {{ success: boolean, currentStats: Object }}
   */
  function revertTransformation() {
    const was = playerTransState.activeTransformation;

    // Restaurar currentStats desde baseStats (sin tocar HP)
    const restored = {};
    MODIFIABLE_STATS.forEach(stat => {
      if (playerTransState.baseStats[stat] !== undefined) {
        restored[stat] = playerTransState.baseStats[stat];
      }
    });
    // HP protegido — copiar sin modificar si existe
    PROTECTED_STATS.forEach(stat => {
      if (playerTransState.baseStats[stat] !== undefined) {
        restored[stat] = playerTransState.baseStats[stat];
      }
    });

    playerTransState.currentStats         = restored;
    playerTransState.activeTransformation = null;

    // Registrar en historial
    playerTransState._history.push({
      action:    "revert",
      from:      was ? was.id : null,
      timestamp: Date.now(),
    });

    if (was) {
      console.info(`[TransSys] Transformación revertida: ${was.name} → Forma Base`);
    }

    return {
      success:      true,
      currentStats: { ...restored },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS PÚBLICOS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Verifica si una transformación está disponible para una raza dada.
   * @param {string} trId
   * @param {string} raceId
   * @returns {boolean}
   */
  function isTransformationAvailable(trId, raceId) {
    const tr = _findById(trId);
    return tr ? tr.isAvailableFor(raceId) : false;
  }

  /**
   * Devuelve todas las transformaciones disponibles para una raza.
   * @param {string} raceId
   * @returns {Transformation[]}
   */
  function getTransformationsForRace(raceId) {
    return TRANSFORMATIONS.filter(tr => tr.isAvailableFor(raceId));
  }

  /**
   * Sincroniza los baseStats del estado de transformación con los stats de raza
   * del creator. Llamar cada vez que cambia la raza.
   * NUNCA sincroniza HP.
   * @param {Object} raceStats - { str, spd, def, ki, ... }
   */
  function syncBaseStats(raceStats) {
    MODIFIABLE_STATS.forEach(stat => {
      if (raceStats[stat] !== undefined) {
        playerTransState.baseStats[stat] = raceStats[stat];
      }
    });
    // Si hay transformación activa, recalcular
    if (playerTransState.activeTransformation) {
      playerTransState.currentStats = applyTransformationStats(
        playerTransState.activeTransformation,
        playerTransState.baseStats
      );
    } else {
      MODIFIABLE_STATS.forEach(stat => {
        if (playerTransState.baseStats[stat] !== undefined) {
          playerTransState.currentStats[stat] = playerTransState.baseStats[stat];
        }
      });
    }
  }

  /**
   * Registra una nueva transformación en el catálogo global.
   * Si ya existe una con el mismo ID, la reemplaza.
   * @param {Transformation|Object} data - Instancia de Transformation o config raw
   * @returns {Transformation}
   */
  function registerTransformation(data) {
    const tr = data instanceof Transformation ? data : new Transformation(data);
    const existingIdx = TRANSFORMATIONS.findIndex(t => t.id === tr.id);
    if (existingIdx >= 0) {
      TRANSFORMATIONS[existingIdx] = tr;
    } else {
      TRANSFORMATIONS.push(tr);
    }
    return tr;
  }

  /**
   * Elimina una transformación del catálogo global por ID.
   * Si estaba activa, revierte al jugador.
   * @param {string} id
   * @returns {boolean} - true si se eliminó
   */
  function unregisterTransformation(id) {
    const idx = TRANSFORMATIONS.findIndex(t => t.id === id);
    if (idx < 0) return false;
    if (playerTransState.activeTransformation?.id === id) {
      revertTransformation();
    }
    TRANSFORMATIONS.splice(idx, 1);
    return true;
  }

  /**
   * Serializa todas las transformaciones del catálogo a JSON.
   * @returns {string}
   */
  function exportTransformations() {
    return JSON.stringify(TRANSFORMATIONS.map(tr => tr.toJSON()), null, 2);
  }

  /**
   * Carga transformaciones desde un JSON exportado.
   * Reemplaza el catálogo actual.
   * @param {string|Object[]} json - String JSON o array de objetos
   */
  function importTransformations(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    TRANSFORMATIONS.length = 0;
    data.forEach(item => TRANSFORMATIONS.push(new Transformation(item)));
    console.info(`[TransSys] ${TRANSFORMATIONS.length} transformaciones importadas.`);
  }

  // ═══════════════════════════════════════════════════════════════
  //  VALIDACIÓN — Asegurar que ningún multiplicador de HP se cuele
  // ═══════════════════════════════════════════════════════════════

  /**
   * Valida una config de multiplicadores y devuelve una versión segura.
   * Elimina cualquier intento de modificar hp/hpMax/currentHp.
   * @param {Object} multipliers
   * @returns {Object}
   */
  function sanitizeMultipliers(multipliers) {
    const safe = {};
    MODIFIABLE_STATS.forEach(stat => {
      safe[stat] = _clampMult(multipliers[stat] !== undefined ? multipliers[stat] : 1);
    });
    // Sobrescribir explícitamente cualquier intento de tocar HP
    PROTECTED_STATS.forEach(stat => {
      delete safe[stat]; // Eliminamos, jamás los incluimos
    });
    return safe;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXPOSICIÓN PÚBLICA — window.TransformationsSystem
  // ═══════════════════════════════════════════════════════════════

  window.TransformationsSystem = Object.freeze({
    // Clase
    Transformation,

    // Catálogo (mutable via push/splice, pero la referencia es de solo lectura)
    TRANSFORMATIONS,

    // Constantes
    MULT_MIN,
    MULT_MAX,
    MODIFIABLE_STATS: Object.freeze([...MODIFIABLE_STATS]),
    PROTECTED_STATS:  Object.freeze([...PROTECTED_STATS]),

    // Estado del jugador
    playerTransState,

    // Funciones principales
    transformPlayer,
    revertTransformation,
    applyTransformationStats,

    // Helpers
    isTransformationAvailable,
    getTransformationsForRace,
    syncBaseStats,
    sanitizeMultipliers,

    // CRUD del catálogo
    registerTransformation,
    unregisterTransformation,

    // Import / Export
    exportTransformations,
    importTransformations,
  });

  console.info("[TransformationsSystem] v1.0.0 cargado. Catálogo vacío, listo para transformaciones.");

  // ═══════════════════════════════════════════════════════════════
  //  MÓDULO DE TRANSFORMACIONES ESPECIALES (UI)
  //
  //  Inyecta botones de preset de skin en el panel GENERAL del modal.
  //  Al cargar un skin, asigna TANTO el dataURL COMO la imagen runtime
  //  (_tmEditSkinImage) para que la preview del modal la muestre.
  //
  //  REQUISITO en index.html — agregar junto a _transEditSkinDataURL:
  //    window.__setTransSkin = function(v) { _transEditSkinDataURL = v; };
  //    window.__setTransSkinImg = function(v) { _tmEditSkinImage = v; };
  // ═══════════════════════════════════════════════════════════════

  (function _initSpecialSkinsUI() {

    // Evitar doble inicialización
    if (window.__specialSkinsInited) return;
    window.__specialSkinsInited = true;

    const SPECIAL_SKINS = [
      {
        group: "🦍 OZARU",
        color: "var(--accent2, #ff6a00)",
        cols: 1,
        entries: [
          { skin: "skins/ozaru_saiyajin.png", label: "Ozaru (Saiyajin)", icon: "🦍" },
        ],
      },
      {
        group: "💜 LEGENDARIO SUPER SAIYAJIN",
        color: "#b39ddb",
        cols: 2,
        entries: [
          { skin: "skins/lss_saiyajin_m.png", label: "LSS ♂ Saiyajin", icon: "♂", sub: "Hombre" },
          { skin: "skins/lss_saiyajin_f.png", label: "LSS ♀ Saiyajin", icon: "♀", sub: "Mujer"  },
        ],
      },
      {
        group: "🤖 MAQUINACIÓN",
        color: "var(--cyan, #00e5ff)",
        cols: 2,
        entries: [
          { skin: "skins/maquinacion_androide_m.png", label: "Maquinación ♂", icon: "♂", sub: "Hombre" },
          { skin: "skins/maquinacion_androide_f.png", label: "Maquinación ♀", icon: "♀", sub: "Mujer"  },
        ],
      },
      {
        group: "💚 BERSERKER",
        color: "var(--green, #00ff9d)",
        cols: 1,
        entries: [
          { skin: "skins/berserker_namekiano.png", label: "Berserker (Namekiano)", icon: "💚" },
        ],
      },
      {
        group: "👾 5TA FORMA",
        color: "var(--magenta, #e040fb)",
        cols: 1,
        entries: [
          { skin: "skins/5ta_forma_frieza.png", label: "5ta Forma (Frieza)", icon: "👾" },
        ],
      },
    ];

    function _injectCSS() {
      if (document.getElementById("ss-style")) return;
      const s = document.createElement("style");
      s.id = "ss-style";
      s.textContent = `
        #specialSkinsSection{margin-top:16px;border-top:1px solid var(--border,#2a3560);padding-top:12px}
        #specialSkinsSection .ss-title{font-family:var(--fh,"Orbitron",monospace);font-size:7px;letter-spacing:2px;color:var(--td,#8892b0);margin:0 0 5px;text-transform:uppercase}
        #specialSkinsSection .ss-note{font-size:9px;color:var(--td,#8892b0);font-family:var(--fb,"Rajdhani",sans-serif);line-height:1.4;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15);border-radius:4px;padding:5px 8px;margin-bottom:10px}
        #specialSkinsSection .ss-note code{color:var(--cyan,#00e5ff);font-size:8px}
        #specialSkinsSection .ss-group{font-family:var(--fh,"Orbitron",monospace);font-size:7px;letter-spacing:2px;text-transform:uppercase;margin:10px 0 4px}
        #specialSkinsSection .ss-grid-1{display:grid;grid-template-columns:1fr;gap:5px;margin-bottom:4px}
        #specialSkinsSection .ss-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:4px}
        .special-skin-btn{width:100%;padding:8px 10px;background:color-mix(in srgb,var(--sc,#e040fb) 8%,transparent);border:1px solid color-mix(in srgb,var(--sc,#e040fb) 40%,transparent);border-radius:var(--r,6px);color:var(--sc,#e040fb);font-family:var(--fh,"Orbitron",monospace);font-size:8px;letter-spacing:1px;cursor:pointer;transition:all var(--tr,.15s ease);text-align:center;line-height:1.5}
        .special-skin-btn:hover{background:color-mix(in srgb,var(--sc,#e040fb) 18%,transparent);border-color:var(--sc,#e040fb);box-shadow:0 0 8px color-mix(in srgb,var(--sc,#e040fb) 30%,transparent)}
        .special-skin-btn.ss-active{background:color-mix(in srgb,var(--sc,#e040fb) 22%,transparent);border-color:var(--sc,#e040fb);box-shadow:0 0 12px color-mix(in srgb,var(--sc,#e040fb) 40%,transparent);font-weight:700}
        .special-skin-btn .ss-sub{display:block;font-size:7px;opacity:.7;margin-top:1px}
        #specialSkinStatus{display:none;margin-top:6px;padding:5px 8px;border-radius:4px;font-family:var(--fh,"Orbitron",monospace);font-size:8px;letter-spacing:.5px}
        #specialSkinStatus.ok{background:rgba(0,255,157,.07);border:1px solid rgba(0,255,157,.25);color:var(--green,#00ff9d)}
        #specialSkinStatus.err{background:rgba(255,23,68,.07);border:1px solid rgba(255,23,68,.25);color:var(--red,#ff1744)}
      `;
      document.head.appendChild(s);
    }

    function _buildSection() {
      const section = document.createElement("div");
      section.id = "specialSkinsSection";
      section.innerHTML = `
        <div class="ss-title">🌟 TRANSFORMACIONES ESPECIALES</div>
        <div class="ss-note">Carga un skin predefinido desde la carpeta <code>skins/</code>. Reemplaza cualquier PNG custom cargado.</div>
      `;
      SPECIAL_SKINS.forEach(group => {
        const title = document.createElement("div");
        title.className = "ss-group";
        title.style.color = group.color;
        title.textContent = group.group;
        section.appendChild(title);

        const grid = document.createElement("div");
        grid.className = group.cols === 2 ? "ss-grid-2" : "ss-grid-1";
        group.entries.forEach(entry => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "special-skin-btn";
          btn.style.setProperty("--sc", group.color);
          btn.dataset.skin  = entry.skin;
          btn.dataset.label = entry.label;
          btn.innerHTML = entry.sub
            ? `${entry.icon} ${entry.sub}<span class="ss-sub">${entry.label}</span>`
            : `${entry.icon} ${entry.label}`;
          grid.appendChild(btn);
        });
        section.appendChild(grid);
      });

      const status = document.createElement("div");
      status.id = "specialSkinStatus";
      section.appendChild(status);
      return section;
    }

    function _injectHTML() {
      // La sección ya está definida estáticamente en index.html — no duplicar.
      if (document.getElementById("specialSkinsSection")) return;
      if (document.querySelector("#tm-general .tm-sec")) return;
      const panel    = document.getElementById("tm-general");
      const clearBtn = document.getElementById("transClearSkin");
      if (!panel) return;
      clearBtn
        ? clearBtn.insertAdjacentElement("afterend", _buildSection())
        : panel.appendChild(_buildSection());
    }

    function _setStatus(msg, type) {
      const el = document.getElementById("specialSkinStatus");
      if (!el) return;
      el.textContent = msg; el.className = type; el.style.display = "block";
    }
    function _clearStatus() {
      const el = document.getElementById("specialSkinStatus");
      if (el) { el.style.display = "none"; el.textContent = ""; el.className = ""; }
    }
    function _clearActive() {
      document.querySelectorAll(".special-skin-btn").forEach(b => b.classList.remove("ss-active"));
    }
    function _reset() { _clearActive(); _clearStatus(); }

    /**
     * Aplica un skin de ruta local al modal.
     * Funciona como las razas: guarda la RUTA (skinPath) en vez de base64.
     * - skinPath  → ruta relativa (ej: "skins/ozaru_saiyajin.png") — se serializa en JSON
     * - skinImage → objeto Image cargado desde la ruta — solo runtime (para la preview)
     * NO genera dataURL ni usa localStorage. El game.html carga el PNG directo desde la ruta.
     */
    function _applyToModal(skinPath, img, label) {
      // Notificar a index.html que asigne la ruta (NO el dataURL) a la transformación
      if (typeof window.__setTransSkinPath === "function") {
        window.__setTransSkinPath(skinPath);
      }

      // Asignar imagen runtime para la preview del canvas en el modal
      if (typeof window.__setTransSkinImg === "function") {
        window.__setTransSkinImg(img);
      } else if (Object.getOwnPropertyDescriptor(window, "_tmEditSkinImage")) {
        window._tmEditSkinImage = img;
      }

      // Persistencia directa en el objeto runtime de la transformación que se está editando
      try {
        const _editIdx = typeof window.__getEditingTransIndex === "function"
          ? window.__getEditingTransIndex()
          : (typeof window.editingTransIndex !== "undefined" ? window.editingTransIndex : null);

        const tArr = window.transformations || (typeof window._getTransformations === "function" ? window._getTransformations() : null);

        if (_editIdx !== null && _editIdx !== undefined && Array.isArray(tArr) && tArr[_editIdx]) {
          // Guardar la RUTA — no el dataURL
          tArr[_editIdx].skinPath    = skinPath;
          tArr[_editIdx].skinDataURL = null;   // limpiar cualquier dataURL previo
          tArr[_editIdx].skinImage   = img;    // runtime only
        }
      } catch(e) {
        console.warn("[SpecialSkins] No se pudo persistir skinPath en runtime:", e);
      }

      // Actualizar UI del uploader
      const lbl   = document.getElementById("transImportLabel");
      const fname = document.getElementById("transImportFname");
      const text  = document.getElementById("transImportText");
      if (lbl)   lbl.classList.add("loaded");
      if (fname) fname.textContent = label + " ✓";
      if (text)  text.textContent  = "CAMBIAR PNG";
    }

    async function _loadSkin(btn) {
      const path  = btn.dataset.skin;
      const label = btn.dataset.label || path;
      _clearActive();
      btn.classList.add("ss-active");
      btn.style.opacity = "0.6";
      _clearStatus();
      try {
        // Cargar la imagen directo desde la ruta — igual que hacen las razas.
        // Sin fetch, sin FileReader, sin base64. Solo new Image() con src = path.
        const img = await new Promise((ok, fail) => {
          const i = new Image();
          i.onload  = () => ok(i);
          i.onerror = () => fail(new Error("No se encontró: " + path));
          i.src = path;
        });

        _applyToModal(path, img, label);
        _setStatus("✓ " + label + " cargado", "ok");
        if (typeof window.showToast === "function") window.showToast("Skin cargado: " + label, "success");

      } catch (err) {
        console.error("[SpecialSkins]", err);
        btn.classList.remove("ss-active");
        _setStatus("✗ No se encontró: " + path, "err");
        if (typeof window.showToast === "function") window.showToast("No se encontró: " + path, "error");
      } finally {
        btn.style.opacity = "1";
      }
    }

    function _bindEvents() {
      // Delegación única en el panel — no se registra dos veces gracias al flag de arriba
      const panel = document.getElementById("tm-general");
      if (panel) {
        panel.addEventListener("click", e => {
          const btn = e.target.closest(".special-skin-btn");
          if (btn) _loadSkin(btn);
        });
      }

      // Al quitar skin custom, limpiar también los botones especiales y la imagen runtime
      const clearBtn = document.getElementById("transClearSkin");
      if (clearBtn) {
        clearBtn.addEventListener("click", () => {
          _reset();
          if (typeof window.__setTransSkinImg === "function") window.__setTransSkinImg(null);
        });
      }

      // Resetear al cerrar el modal
      ["transModalClose", "transModalCancel"].forEach(id => {
        document.getElementById(id)?.addEventListener("click", _reset);
      });
      document.getElementById("transModalOverlay")?.addEventListener("click", e => {
        if (e.target.id === "transModalOverlay") _reset();
      });

      // Hookear openTransModal para resetear al abrir
      if (typeof window.openTransModal === "function" && !window.openTransModal.__ssHooked) {
        const _orig = window.openTransModal;
        window.openTransModal = function(...a) { _reset(); return _orig.apply(this, a); };
        window.openTransModal.__ssHooked = true;
      }
      if (typeof window.closeTransModal === "function" && !window.closeTransModal.__ssHooked) {
        const _orig = window.closeTransModal;
        window.closeTransModal = function(...a) { _reset(); return _orig.apply(this, a); };
        window.closeTransModal.__ssHooked = true;
      }
    }

    function _boot() {
      _injectCSS();
      _injectHTML();
      _bindEvents();
      console.info("[SpecialSkins] Sección de transformaciones especiales lista.");
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", _boot);
    } else {
      setTimeout(_boot, 0);
    }

  })();

})();