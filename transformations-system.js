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

})();