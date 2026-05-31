// @ts-nocheck
/**
 * DRAGON CREATOR Z — Transformations System v2.0.0
 *
 * ══════════════════════════════════════════════════════════════════
 *  MÓDULO MODULAR DE TRANSFORMACIONES
 *
 *  Expone window.TransformationsSystem con:
 *    - TRANSFORMATIONS          → catálogo global de transformaciones
 *    - Transformation           → clase constructora de transformaciones
 *    - SPECIAL_SKIN_CATALOG     → catálogo de skins predefinidas por raza
 *    - playerTransState         → estado del jugador (baseStats, currentStats, activeTransformation)
 *    - transformPlayer(id)      → activa una transformación por ID
 *    - revertTransformation()   → vuelve a la forma base
 *    - applyTransformationStats(tr, baseStats) → calcula stats modificados
 *    - renderSpecialSkinsPanel(containerId, options) → renderiza el panel de skins especiales
 *
 *  REGLAS DE MULTIPLICADORES:
 *    · Rango: x0.3 hasta x500
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
  const MULT_MAX = 500;

  /** Stats que los multiplicadores PUEDEN modificar */
  const MODIFIABLE_STATS = ["str", "spd", "def", "ki"];

  /** Stats que los multiplicadores NUNCA pueden modificar */
  const PROTECTED_STATS = ["hp", "hpMax", "currentHp"];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGO DE SKINS ESPECIALES
  //  Organizado por raza y grupo. skinKey → SPRITE_IMAGES[skinKey].
  //  NUNCA se transportan imágenes — cada cliente las resuelve localmente.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Cada entrada del catálogo:
   *   skinKey   → clave en CharacterSystem.SPRITE_IMAGES
   *   label     → nombre visible
   *   icon      → emoji decorativo
   *   races     → array de raceId compatibles, o ["all"]
   *   group     → nombre del grupo visual (con emoji)
   *   groupKey  → identificador limpio del grupo (sin emoji)
   *   color     → color del grupo para la UI
   *   desc      → descripción corta (opcional)
   */
  const SPECIAL_SKIN_CATALOG = [

    // ── SAIYAJIN ─────────────────────────────────────────────────
    {
      skinKey: "tf_ssj",    label: "Super Saiyan",      icon: "💛",
      races: ["saiyan"],    group: "💛 SUPER SAIYAJIN",  groupKey: "ssj",
      color: "#fdd835",     desc: "La primera transformación legendaria"
    },
    {
      skinKey: "tf_ssj2",   label: "Super Saiyan 2",    icon: "⚡",
      races: ["saiyan"],    group: "💛 SUPER SAIYAJIN",  groupKey: "ssj",
      color: "#fdd835",     desc: "El poder que superó a Cell"
    },
    {
      skinKey: "tf_ssj3",   label: "Super Saiyan 3",    icon: "🌀",
      races: ["saiyan"],    group: "💛 SUPER SAIYAJIN",  groupKey: "ssj",
      color: "#fdd835",     desc: "Cabello hasta la cintura, poder inmenso"
    },
    {
      skinKey: "tf_ssjblue",label: "SSJ Blue",           icon: "🔵",
      races: ["saiyan"],    group: "🔵 DIOS SAIYAJIN",   groupKey: "ssjgod",
      color: "#00b0ff",     desc: "Ki divino del Saiyajin"
    },
    {
      skinKey: "tf_ssjgod", label: "SSJ God",            icon: "🔴",
      races: ["saiyan"],    group: "🔵 DIOS SAIYAJIN",   groupKey: "ssjgod",
      color: "#00b0ff",     desc: "El ki rojo del Dios Saiyajin"
    },
    {
      skinKey: "tf_ssj4",   label: "Super Saiyan 4 ♂",  icon: "🦁",
      races: ["saiyan"],    group: "🔴 SUPER SAIYAN 4",  groupKey: "ssj4",
      color: "#e53935",     desc: "Ozaru dorado + Super Saiyan"
    },
    {
      skinKey: "tf_ssj4f",  label: "Super Saiyan 4 ♀",  icon: "🦁",
      races: ["saiyan"],    group: "🔴 SUPER SAIYAN 4",  groupKey: "ssj4",
      color: "#e53935",     desc: "Versión femenina de SSJ4"
    },
    {
      skinKey: "tf_lssj",   label: "LSS ♂",              icon: "💜",
      races: ["saiyan"],    group: "💜 LEGENDARIO",       groupKey: "lssj",
      color: "#b39ddb",     desc: "El Saiyajin Legendario"
    },
    {
      skinKey: "tf_lssjf",  label: "LSS ♀",              icon: "💜",
      races: ["saiyan"],    group: "💜 LEGENDARIO",       groupKey: "lssj",
      color: "#b39ddb",     desc: "El Saiyajin Legendario femenino"
    },
    {
      skinKey: "tf_ozaru",  label: "Ozaru",               icon: "🦍",
      races: ["saiyan"],    group: "🦍 OZARU",            groupKey: "ozaru",
      color: "#ff6a00",     desc: "La Gran Bestia del Mono"
    },

    // ── HUMANO ───────────────────────────────────────────────────
    {
      skinKey: "tf_kk",     label: "Kaioken ♂",          icon: "🔴",
      races: ["human","saiyan"], group: "🔴 KAIOKEN",     groupKey: "kaioken",
      color: "#ff1744",     desc: "Técnica del Rey Kai — multiplica el ki"
    },
    {
      skinKey: "tf_kkf",    label: "Kaioken ♀",          icon: "🔴",
      races: ["human","saiyan"], group: "🔴 KAIOKEN",     groupKey: "kaioken",
      color: "#ff1744",     desc: "Kaioken versión femenina"
    },
    {
      skinKey: "tf_ult_m",  label: "Definitivo ♂",       icon: "⚪",
      races: ["human"],     group: "⚪ DEFINITIVO",       groupKey: "ultimate",
      color: "#e8eaf6",     desc: "El poder máximo de un humano"
    },
    {
      skinKey: "tf_ult_f",  label: "Definitivo ♀",       icon: "⚪",
      races: ["human"],     group: "⚪ DEFINITIVO",       groupKey: "ultimate",
      color: "#e8eaf6",     desc: "Potencial despertado al máximo"
    },

    // ── NAMEKIANO ────────────────────────────────────────────────
    {
      skinKey: "tf_gigante",label: "Forma Gigante",       icon: "🟢",
      races: ["namekian"],  group: "🟢 FORMAS NAMEKIANAS",groupKey: "namek_forms",
      color: "#69f0ae",     desc: "Expansión corporal característica"
    },
    {
      skinKey: "tf_bersk",  label: "Berserker",           icon: "💚",
      races: ["namekian"],  group: "🟢 FORMAS NAMEKIANAS",groupKey: "namek_forms",
      color: "#69f0ae",     desc: "Namekiano en estado de furia"
    },
    {
      skinKey: "tf_supernamek", label: "Super Namek",     icon: "✨",
      races: ["namekian"],  group: "🟢 FORMAS NAMEKIANAS",groupKey: "namek_forms",
      color: "#69f0ae",     desc: "Fusión y poder supremo Namekiano"
    },

    // ── ANDROIDE ─────────────────────────────────────────────────
    {
      skinKey: "tf_maq_m",  label: "Maquinación ♂",      icon: "🤖",
      races: ["android"],   group: "🤖 MAQUINACIÓN",      groupKey: "maq",
      color: "#00e5ff",     desc: "Transformación cibernética total"
    },
    {
      skinKey: "tf_maq_f",  label: "Maquinación ♀",      icon: "🤖",
      races: ["android"],   group: "🤖 MAQUINACIÓN",      groupKey: "maq",
      color: "#00e5ff",     desc: "Maquinación versión femenina"
    },
    {
      skinKey: "tf_core_m", label: "Núcleo ♂",            icon: "💠",
      races: ["android"],   group: "💠 NÚCLEO ANDROID",   groupKey: "core",
      color: "#80deea",     desc: "Liberación del núcleo de energía"
    },
    {
      skinKey: "tf_core_f", label: "Núcleo ♀",            icon: "💠",
      races: ["android"],   group: "💠 NÚCLEO ANDROID",   groupKey: "core",
      color: "#80deea",     desc: "Núcleo liberado versión femenina"
    },

    // ── RAZA DE FRIEZA ───────────────────────────────────────────
    {
      skinKey: "tf_5forma", label: "5ta Forma",           icon: "👾",
      races: ["frieza"],    group: "👾 FORMAS ARCOSAS",   groupKey: "arcosa_forms",
      color: "#e040fb",     desc: "La forma oculta de la Raza Arcosa"
    },
    {
      skinKey: "tf_goldform",label: "Forma Dorada",       icon: "🟡",
      races: ["frieza"],    group: "👾 FORMAS ARCOSAS",   groupKey: "arcosa_forms",
      color: "#e040fb",     desc: "El pináculo del entrenamiento Arcosa"
    },
    {
      skinKey: "tf_blackform",label: "Forma Negra",       icon: "🖤",
      races: ["frieza"],    group: "👾 FORMAS ARCOSAS",   groupKey: "arcosa_forms",
      color: "#e040fb",     desc: "Poder más allá de la forma dorada"
    },

    // ── KAIOSHIN ─────────────────────────────────────────────────
    {
      skinKey: "tf_kai_ult",label: "Poder Kaioshin",      icon: "⚗️",
      races: ["kaioshin"],  group: "⚗️ KAIOSHIN",         groupKey: "kaioshin",
      color: "#ce93d8",     desc: "Poder divino del Dios Supremo"
    },
    {
      skinKey: "tf_kai_fus",label: "Potara Fusión",       icon: "💍",
      races: ["kaioshin"],  group: "⚗️ KAIOSHIN",         groupKey: "kaioshin",
      color: "#ce93d8",     desc: "Fusión mediante los aretes Potara"
    },

    // ── UNIVERSAL ────────────────────────────────────────────────
    {
      skinKey: "tf_ultra",  label: "Ultra Instinto",      icon: "🌸",
      races: ["all"],       group: "🌸 ULTRA INSTINTO",   groupKey: "ultra",
      color: "#90caf9",     desc: "El movimiento sin pensar"
    },
    {
      skinKey: "tf_ultra_mastered", label: "UI Dominado", icon: "⚪",
      races: ["all"],       group: "🌸 ULTRA INSTINTO",   groupKey: "ultra",
      color: "#90caf9",     desc: "Ultra Instinto perfectamente dominado"
    },
    {
      skinKey: "tf_ego",    label: "Ultra Ego",           icon: "🟣",
      races: ["all"],       group: "🟣 ULTRA EGO",        groupKey: "ego",
      color: "#ce93d8",     desc: "El camino del Destructor"
    },
  ];


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
  //  CLASE Transformation
  // ═══════════════════════════════════════════════════════════════

  class Transformation {
    constructor(config = {}) {
      this.id          = config.id          || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      this.name        = config.name        || "Transformación";
      this.level       = Math.max(1, Math.min(100, parseInt(config.level) || 1));
      this.races       = Array.isArray(config.races) ? config.races : ["all"];
      this.auraColor   = config.auraColor   || "#fdd835";
      this.icon        = config.icon        || "⚡";
      this.description = config.description || "";

      // skinKey: clave de SPRITE_IMAGES (ej: "tf_lssj", "tf_ozaru").
      // Se serializa en Firebase. Cada cliente resuelve el PNG localmente.
      this.skinKey     = config.skinKey     || null;

      this.appearance  = { ...(config.appearance || {}) };
      this.displayW    = config.displayW ? Math.max(40, Math.min(400, parseInt(config.displayW) || 0)) : 0;
      this.displayH    = config.displayH ? Math.max(40, Math.min(500, parseInt(config.displayH) || 0)) : 0;

      // Runtime (no se persiste — imageMap del juego lo resuelve en cada frame)
      this.skinImage   = null;

      const rawMult    = config.multipliers || {};
      this.multipliers = {
        str: _clampMult(rawMult.str !== undefined ? rawMult.str : 1),
        spd: _clampMult(rawMult.spd !== undefined ? rawMult.spd : 1),
        def: _clampMult(rawMult.def !== undefined ? rawMult.def : 1),
        ki:  _clampMult(rawMult.ki  !== undefined ? rawMult.ki  : 1),
        hp:  1, // HP aquí solo como no-op — NUNCA se aplica
      };
    }

    isAvailableFor(raceId) {
      return this.races.includes("all") || this.races.includes(raceId);
    }

    getMultSummary() {
      const m = this.multipliers;
      return [`STR ×${m.str}`, `SPD ×${m.spd}`, `DEF ×${m.def}`, `KI ×${m.ki}`].join("  ·  ");
    }

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
        skinKey:     this.skinKey    || null,
        appearance:  { ...this.appearance },
        displayW:    this.displayW || 0,
        displayH:    this.displayH || 0,
      };
    }

    static fromJSON(json) {
      return new Transformation(json);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGO GLOBAL — TRANSFORMATIONS
  // ═══════════════════════════════════════════════════════════════

  const TRANSFORMATIONS = [];

  // ═══════════════════════════════════════════════════════════════
  //  ESTADO DEL JUGADOR — playerTransState
  // ═══════════════════════════════════════════════════════════════

  const playerTransState = {
    baseStats: { str: 80, spd: 80, def: 80, ki: 80 },
    currentStats: { str: 80, spd: 80, def: 80, ki: 80 },
    activeTransformation: null,
    _history: [],
  };

  // ═══════════════════════════════════════════════════════════════
  //  FUNCIÓN PRINCIPAL — applyTransformationStats
  // ═══════════════════════════════════════════════════════════════

  function applyTransformationStats(tr, baseStats) {
    if (!tr || !baseStats) {
      console.warn("[TransSys] applyTransformationStats: argumentos inválidos.");
      return { ...baseStats };
    }
    const result = {};
    MODIFIABLE_STATS.forEach(stat => {
      if (baseStats[stat] !== undefined) {
        const mult = _clampMult(tr.multipliers[stat] || 1);
        result[stat] = _capStat(baseStats[stat] * mult);
      }
    });
    PROTECTED_STATS.forEach(stat => {
      if (baseStats[stat] !== undefined) result[stat] = baseStats[stat];
    });
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  //  transformPlayer(id)
  // ═══════════════════════════════════════════════════════════════

  function transformPlayer(id, options = {}) {
    const tr = _findById(id);
    if (!tr) {
      console.warn(`[TransSys] transformPlayer: transformación "${id}" no encontrada.`);
      return { success: false, transformation: null, currentStats: { ...playerTransState.currentStats } };
    }
    if (options.raceId && !tr.isAvailableFor(options.raceId)) {
      console.warn(`[TransSys] transformPlayer: "${id}" no disponible para raza "${options.raceId}".`);
      return { success: false, transformation: null, currentStats: { ...playerTransState.currentStats } };
    }
    const newStats = applyTransformationStats(tr, playerTransState.baseStats);
    playerTransState.activeTransformation = tr;
    playerTransState.currentStats = newStats;
    playerTransState._history.push({ action: "transform", id: tr.id, name: tr.name, timestamp: Date.now() });
    console.info(`[TransSys] Transformación activada: ${tr.name} (${tr.getMultSummary()})`);
    return { success: true, transformation: tr, currentStats: { ...newStats } };
  }

  // ═══════════════════════════════════════════════════════════════
  //  revertTransformation()
  // ═══════════════════════════════════════════════════════════════

  function revertTransformation() {
    const was = playerTransState.activeTransformation;
    const restored = {};
    MODIFIABLE_STATS.forEach(stat => {
      if (playerTransState.baseStats[stat] !== undefined)
        restored[stat] = playerTransState.baseStats[stat];
    });
    PROTECTED_STATS.forEach(stat => {
      if (playerTransState.baseStats[stat] !== undefined)
        restored[stat] = playerTransState.baseStats[stat];
    });
    playerTransState.currentStats         = restored;
    playerTransState.activeTransformation = null;
    playerTransState._history.push({ action: "revert", from: was ? was.id : null, timestamp: Date.now() });
    if (was) console.info(`[TransSys] Transformación revertida: ${was.name} → Forma Base`);
    return { success: true, currentStats: { ...restored } };
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS PÚBLICOS
  // ═══════════════════════════════════════════════════════════════

  function isTransformationAvailable(trId, raceId) {
    const tr = _findById(trId);
    return tr ? tr.isAvailableFor(raceId) : false;
  }

  function getTransformationsForRace(raceId) {
    return TRANSFORMATIONS.filter(tr => tr.isAvailableFor(raceId));
  }

  function syncBaseStats(raceStats) {
    MODIFIABLE_STATS.forEach(stat => {
      if (raceStats[stat] !== undefined) playerTransState.baseStats[stat] = raceStats[stat];
    });
    if (playerTransState.activeTransformation) {
      playerTransState.currentStats = applyTransformationStats(
        playerTransState.activeTransformation, playerTransState.baseStats
      );
    } else {
      MODIFIABLE_STATS.forEach(stat => {
        if (playerTransState.baseStats[stat] !== undefined)
          playerTransState.currentStats[stat] = playerTransState.baseStats[stat];
      });
    }
  }

  function registerTransformation(data) {
    const tr = data instanceof Transformation ? data : new Transformation(data);
    const existingIdx = TRANSFORMATIONS.findIndex(t => t.id === tr.id);
    if (existingIdx >= 0) TRANSFORMATIONS[existingIdx] = tr;
    else TRANSFORMATIONS.push(tr);
    return tr;
  }

  function unregisterTransformation(id) {
    const idx = TRANSFORMATIONS.findIndex(t => t.id === id);
    if (idx < 0) return false;
    if (playerTransState.activeTransformation?.id === id) revertTransformation();
    TRANSFORMATIONS.splice(idx, 1);
    return true;
  }

  function sanitizeMultipliers(multipliers) {
    const safe = {};
    MODIFIABLE_STATS.forEach(stat => {
      safe[stat] = _clampMult(multipliers[stat] !== undefined ? multipliers[stat] : 1);
    });
    PROTECTED_STATS.forEach(stat => { delete safe[stat]; });
    return safe;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PANEL DE TRANSFORMACIONES ESPECIALES — renderSpecialSkinsPanel
  //
  //  Se llama desde index.html al abrir el tab "especial" del modal.
  //  NO inyecta HTML globalmente ni busca elementos en el body.
  //  Solo rellena el contenedor que se le pasa por ID.
  //
  //  Uso desde index.html:
  //    TransformationsSystem.renderSpecialSkinsPanel("tm-especial-container", {
  //      raceId:         "saiyan",     // filtra por raza (opcional, default: "all")
  //      activeSkinKey:  "tf_ssj",     // marca el botón activo (opcional)
  //      onSelect:       (skinKey, label, entry) => { ... },
  //      onClear:        () => { ... },
  //    });
  // ═══════════════════════════════════════════════════════════════

  /**
   * Agrupa el catálogo por `groupKey`, filtrando opcionalmente por raza.
   * @param {string|null} raceId
   * @returns {Map<string, { label: string, color: string, entries: Object[] }>}
   */
  function _groupCatalog(raceId) {
    const map = new Map();
    SPECIAL_SKIN_CATALOG.forEach(entry => {
      // Filtrar por raza si se especifica
      if (raceId && raceId !== "all") {
        if (!entry.races.includes("all") && !entry.races.includes(raceId)) return;
      }
      if (!map.has(entry.groupKey)) {
        map.set(entry.groupKey, { label: entry.group, color: entry.color, entries: [] });
      }
      map.get(entry.groupKey).entries.push(entry);
    });
    return map;
  }

  /**
   * Renderiza el panel completo de skins especiales dentro del contenedor dado.
   *
   * @param {string}  containerId       - ID del elemento HTML contenedor (tm-especial-container)
   * @param {Object}  [opts]
   * @param {string}  [opts.raceId]     - Filtra skins por raza. Ej: "saiyan". null = todas.
   * @param {string}  [opts.activeSkinKey] - skinKey del botón a marcar como activo
   * @param {Function}[opts.onSelect]   - callback(skinKey, label, entry) al seleccionar
   * @param {Function}[opts.onClear]    - callback() al limpiar selección
   */
  function renderSpecialSkinsPanel(containerId, opts = {}) {
    const container = typeof containerId === "string"
      ? document.getElementById(containerId)
      : containerId;
    if (!container) {
      console.warn("[TransSys] renderSpecialSkinsPanel: contenedor no encontrado:", containerId);
      return;
    }

    const { raceId = null, activeSkinKey = null, onSelect = null, onClear = null } = opts;
    const groups = _groupCatalog(raceId);

    // Limpiar contenido previo
    container.innerHTML = "";

    if (groups.size === 0) {
      container.innerHTML = `
        <div style="font-size:9px;color:var(--td);font-family:var(--fb);
          background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.12);
          border-radius:4px;padding:10px 12px;text-align:center;line-height:1.5">
          No hay skins predefinidas disponibles para esta raza.
        </div>`;
      return;
    }

    // Nota informativa
    const note = document.createElement("div");
    note.className = "tm-inherit-note";
    note.innerHTML = `Skins predefinidas para la raza seleccionada. Se guardan como clave interna — visibles para todos los jugadores online sin importar su dispositivo.`;
    container.appendChild(note);

    // Botón limpiar selección
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.id   = "especial-clear-skin-btn";
    clearBtn.style.cssText = `
      width:100%;margin-bottom:10px;padding:5px;
      background:rgba(255,23,68,.06);border:1px solid rgba(255,23,68,.25);
      border-radius:4px;color:rgba(255,23,68,.6);font-family:var(--fh);
      font-size:8px;letter-spacing:1px;cursor:pointer;transition:all .15s`;
    clearBtn.textContent = "✕ QUITAR SKIN ESPECIAL";
    clearBtn.addEventListener("click", () => {
      container.querySelectorAll(".special-skin-btn").forEach(b => b.classList.remove("active"));
      _updateStatus(container, null, null);
      if (typeof onClear === "function") onClear();
    });
    container.appendChild(clearBtn);

    // Renderizar grupos
    groups.forEach((groupData, _groupKey) => {
      const groupTitle = document.createElement("div");
      groupTitle.className = "tm-sec";
      groupTitle.style.cssText = `color:${groupData.color};margin-top:8px;margin-bottom:4px`;
      groupTitle.textContent = groupData.label;
      container.appendChild(groupTitle);

      const cols = groupData.entries.length > 1 ? 2 : 1;
      const grid = document.createElement("div");
      grid.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:5px;margin-bottom:4px`;

      groupData.entries.forEach(entry => {
        const CS = window.CharacterSystem;
        const available = CS && CS.SPRITE_IMAGES && !!CS.SPRITE_IMAGES[entry.skinKey];

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "special-skin-btn";
        btn.style.setProperty("--sc", groupData.color);
        btn.dataset.skinKey = entry.skinKey;
        btn.dataset.label   = entry.label;

        // Marcar activo si corresponde
        if (activeSkinKey && entry.skinKey === activeSkinKey) btn.classList.add("active");

        // Opacidad reducida si la skin no está disponible en SPRITE_IMAGES
        if (!available) btn.style.opacity = "0.45";

        btn.innerHTML = `${entry.icon} ${entry.label}${entry.desc ? `<span class="ss-sub" style="display:block;font-size:7px;opacity:.6;margin-top:2px">${entry.desc}</span>` : ""}`;

        btn.addEventListener("click", () => {
          if (!available) {
            _updateStatus(container, null, `✗ Skin no disponible: ${entry.skinKey}`, "err");
            if (typeof window.showToast === "function") window.showToast("Skin no disponible: " + entry.skinKey, "error");
            return;
          }
          container.querySelectorAll(".special-skin-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          _updateStatus(container, groupData.color, `✓ ${entry.label} seleccionado`, "ok");
          if (typeof window.showToast === "function") window.showToast("Skin seleccionado: " + entry.label, "success");
          if (typeof onSelect === "function") onSelect(entry.skinKey, entry.label, entry);
        });

        grid.appendChild(btn);
      });

      container.appendChild(grid);
    });

    // Elemento de status (al final)
    const statusEl = document.createElement("div");
    statusEl.id = "especial-skin-status";
    statusEl.style.display = "none";
    container.appendChild(statusEl);
  }

  /** Actualiza o oculta el elemento de status del panel */
  function _updateStatus(container, color, msg, type) {
    const el = container.querySelector("#especial-skin-status");
    if (!el) return;
    if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
    el.style.cssText = `
      display:block;margin-top:6px;padding:5px 8px;border-radius:4px;
      font-family:var(--fh);font-size:8px;letter-spacing:.5px;
      ${type === "ok"
        ? "background:rgba(0,255,157,.07);border:1px solid rgba(0,255,157,.25);color:var(--green)"
        : "background:rgba(255,23,68,.07);border:1px solid rgba(255,23,68,.25);color:var(--red)"}`;
    el.textContent = msg;
  }

  /**
   * Devuelve las entradas del catálogo filtradas por raza.
   * @param {string} raceId
   * @returns {Object[]}
   */
  function getSkinsForRace(raceId) {
    if (!raceId || raceId === "all") return [...SPECIAL_SKIN_CATALOG];
    return SPECIAL_SKIN_CATALOG.filter(e =>
      e.races.includes("all") || e.races.includes(raceId)
    );
  }

  /**
   * Resuelve la imagen de un skinKey desde el imageMap del juego.
   * @param {string} skinKey
   * @param {Object} imageMap
   * @returns {HTMLImageElement|null}
   */
  function getSkinImage(skinKey, imageMap) {
    if (!skinKey || !imageMap) return null;
    return imageMap[skinKey] || null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXPOSICIÓN PÚBLICA — window.TransformationsSystem
  // ═══════════════════════════════════════════════════════════════

  window.TransformationsSystem = Object.freeze({
    // Clase
    Transformation,

    // Catálogo (mutable via push/splice, pero la referencia es de solo lectura)
    TRANSFORMATIONS,

    // Catálogo de skins predefinidas
    SPECIAL_SKIN_CATALOG,

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

    // Panel de skins especiales (se llama desde el tab del modal)
    renderSpecialSkinsPanel,
    getSkinsForRace,
    getSkinImage,

    // Helpers
    isTransformationAvailable,
    getTransformationsForRace,
    syncBaseStats,
    sanitizeMultipliers,

    // CRUD del catálogo
    registerTransformation,
    unregisterTransformation,
  });

  console.info("[TransformationsSystem] v2.0.0 cargado — panel de skins especiales como categoría separada.");

})();