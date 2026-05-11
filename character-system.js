// @ts-nocheck
/**
 * DRAGON CREATOR Z — Character System v1.0.2
 * Spritesheet de 14 filas (igual para body, hair, face, tops, bottoms, shoes, gloves, auras):
 *   Row 0  → base_view   (vista base, 3 frames)
 *   Row 1  → idle        (3 frames)
 *   Row 2  → walk        (4 frames)
 *   Row 3  → run         (4 frames)
 *   Row 4  → attack_1    (6 frames)
 *   Row 5  → attack_2    (3 frames)
 *   Row 6  → jump        (3 frames)
 *   Row 7  → hurt        (1 frame)
 *   Row 8  → death       (3 frames)
 *   Row 9  → ki_charge   (3 frames)
 *   Row 10 → fly         (3 frames)
 *   Row 11 → fly_map     (3 frames)
 *   Row 12 → trans1_view (transformación 1, 3 frames)
 *   Row 13 → trans2_view (transformación 2, 3 frames)
 *
 *  HISTORIAL DE CAMBIOS:
 *
 *  v4.3 — ACCESSORIES + FACE_CATALOG
 *  - ACCESSORIES: eliminados los sprites fijos. El sistema ahora
 *    admite accesorios importados por el usuario (ObjectURL / base64).
 *    ACCESSORIES_CATALOG actúa como registro de slots; cada slot
 *    guarda { id, name, type, slot, color, userImage } donde
 *    userImage es un HTMLImageElement cargado en runtime.
 *  - FACE_CATALOG añadido: nueva capa de cara (ojos, marcas, cicatrices,
 *    expresiones) idéntica a las demás capas, con soporte de tinte.
 *  - drawPlayer dibuja la capa de cara entre el cuerpo y el cabello.
 *
 *  v4.3.1 — FIX tintLayer
 *  - Algoritmo completamente reescrito (pixel-by-pixel).
 *  - Píxeles muy oscuros (contornos) se preservan sin alteración.
 *  - Píxeles casi blancos/grises se tiñen sólo levemente (colorize suave).
 *  - Píxeles saturados reciben hue-replace completo conservando luminosidad.
 *  - Sin distorsión de blancos ni artefactos en cabello claro.
 *
 *  v4.3.2 — FIX cabello
 *  - tintHair ahora usa _tintSprite (multiply + destination-in)
 *    igual que el tinte de piel. Funciona correctamente con negro,
 *    rojo, azul y cualquier color saturado u oscuro.
 *  - tintLayer sigue usándose para marcas/tatuajes/pinturas de cara.
 *
 *  v4.3.3 — FIX ojos
 *  - tintFaceColor añadida: usa _tintSprite (multiply + destination-in)
 *    igual que cabello y piel. Se aplica cuando faceDef.eyeColor === true.
 *  - Negro, rojo, azul y cualquier color saturado en ojos funciona
 *    correctamente sin artefactos del algoritmo pixel-by-pixel.
 *  - tintLayer conservado para marcas/tatuajes/pinturas (degradados).
 *
 *  v1.0.2 — tintFaceDetailed: cejas y pupilas con colores independientes
 *  - Nueva función tintFaceDetailed(): tiñe cejas y pupilas con dos
 *    colores distintos en una sola pasada pixel-by-pixel.
 *  - REQUISITO DE SPRITESHEET para faces con eyeColor:true:
 *      · Cejas   → pintadas en ROJO PURO  (#ff0000, hue ~0°)
 *      · Pupilas → pintadas en AZUL PURO  (#0000ff, hue ~240°)
 *      · Contornos → negro  (#000000) → no se toca
 *      · Esclerótica → blanco (#ffffff) → no se toca
 *      · Sombras de piel → grises de baja saturación → no se tocan
 *  - appearance ahora soporta browColor y pupilColor además de eyeColor.
 *  - drawPlayer sección 9 prioriza tintFaceDetailed si browColor o
 *    pupilColor están definidos, cae a tintFaceColor si solo hay eyeColor,
 *    y a tintLayer para marcas/tatuajes/pinturas.
 *  - tintFaceDetailed exportada en CharacterSystem.
 */

"use strict";

(function () {

  const FRAME_W   = 96;
  const FRAME_H   = 96;
  const DISPLAY_W = 180;
  const DISPLAY_H = 220;

  // ═══════════════════════════════════════════════════════════════
  //  META COMPARTIDA
  // ═══════════════════════════════════════════════════════════════

  const VIEW_META = {
    base_view:   { row: 0,  frames: 3, fps: 2,  loop: true,  label: "Base"             },
    trans1_view: { row: 12, frames: 3, fps: 2,  loop: true,  label: "Transformación 1"  },
    trans2_view: { row: 13, frames: 3, fps: 2,  loop: true,  label: "Transformación 2"  },
  };

  const ACTIONS_META = {
    idle:      { row: 1,  frames: 3, fps: 2,  loop: true,  label: "Idle"      },
    walk:      { row: 2,  frames: 4, fps: 5,  loop: true,  label: "Walk"      },
    run:       { row: 3,  frames: 4, fps: 12, loop: true,  label: "Run"       },
    attack_1:  { row: 4,  frames: 6, fps: 8,  loop: false, label: "Attack 1"  },
    attack_2:  { row: 5,  frames: 3, fps: 8,  loop: false, label: "Attack 2"  },
    jump:      { row: 6,  frames: 3, fps: 8,  loop: false, label: "Jump"      },
    hurt:      { row: 7,  frames: 1, fps: 6,  loop: false, label: "Hurt"      },
    death:     { row: 8,  frames: 3, fps: 4,  loop: false, label: "Death"     },
    ki_charge: { row: 9,  frames: 3, fps: 6,  loop: true,  label: "Ki Charge" },
    fly:       { row: 10, frames: 3, fps: 2,  loop: true,  label: "Fly"       },
    fly_map:   { row: 11, frames: 3, fps: 1,  loop: true,  label: "Fly Map"   },
  };

  const ACTIONS_META_MALE   = ACTIONS_META;
  const ACTIONS_META_FEMALE = ACTIONS_META;

  const HAIR_VIEW_META       = VIEW_META;
  const HAIR_ACTIONS_META    = ACTIONS_META;
  const FACE_VIEW_META       = VIEW_META;
  const FACE_ACTIONS_META    = ACTIONS_META;
  const TOP_VIEW_META        = VIEW_META;
  const TOP_ACTIONS_META     = ACTIONS_META;
  const BOTTOM_VIEW_META     = VIEW_META;
  const BOTTOM_ACTIONS_META  = ACTIONS_META;
  const SHOES_VIEW_META      = VIEW_META;
  const SHOES_ACTIONS_META   = ACTIONS_META;
  const GLOVES_VIEW_META     = VIEW_META;
  const GLOVES_ACTIONS_META  = ACTIONS_META;
  const AURA_VIEW_META       = VIEW_META;
  const AURA_ACTIONS_META    = ACTIONS_META;

  function getActionsMeta()       { return ACTIONS_META; }
  function getViewMeta()          { return VIEW_META; }
  function getHairViewMeta()      { return HAIR_VIEW_META; }
  function getHairActionsMeta()   { return HAIR_ACTIONS_META; }
  function getFaceViewMeta()      { return FACE_VIEW_META; }
  function getFaceActionsMeta()   { return FACE_ACTIONS_META; }
  function getTopViewMeta()       { return TOP_VIEW_META; }
  function getTopActionsMeta()    { return TOP_ACTIONS_META; }
  function getBottomViewMeta()    { return BOTTOM_VIEW_META; }
  function getBottomActionsMeta() { return BOTTOM_ACTIONS_META; }
  function getShoesViewMeta()     { return SHOES_VIEW_META; }
  function getShoesActionsMeta()  { return SHOES_ACTIONS_META; }
  function getGlovesViewMeta()    { return GLOVES_VIEW_META; }
  function getGlovesActionsMeta() { return GLOVES_ACTIONS_META; }
  function getAuraViewMeta()      { return AURA_VIEW_META; }
  function getAuraActionsMeta()   { return AURA_ACTIONS_META; }

  // ═══════════════════════════════════════════════════════════════
  //  RAZAS
  // ═══════════════════════════════════════════════════════════════

  const RACE_CATALOG = [
    { id: "human",    name: "HUMANO",    spriteKey: "human_male",    skinColor: "#e8c898", eyeColor: "#3a2a1a" },
    { id: "saiyan",   name: "SAIYAN",    spriteKey: "saiyan_male",   skinColor: "#d4a574", eyeColor: "#1a1a1a" },
    { id: "namekian", name: "NAMEKIANO", spriteKey: "namekian_male", skinColor: "#4caf50", eyeColor: "#ff0000", genderless: true },
    { id: "android",  name: "ANDROIDE",  spriteKey: "android_male",  skinColor: "#c0c0c0", eyeColor: "#00e5ff" },
    { id: "kaioshin", name: "KAIOSHIN",  spriteKey: "kaioshin_male", skinColor: "#9c88ff", eyeColor: "#ffd700" },
    { id: "frieza",   name: "FRIEZA",    spriteKey: "frieza_male",   skinColor: "#f0e0f0", eyeColor: "#ff0000", genderless: true },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE CARA
  // ═══════════════════════════════════════════════════════════════

  const FACE_CATALOG_MALE = [
    { id: "fm0", name: "Sin cara",   spriteKey: null,          tintable: false },
    { id: "fm1", name: "Ojos Nor",   spriteKey: "face_fm1",    tintable: true,  eyeColor: true  },
    { id: "fm2", name: "Ojos Fri",   spriteKey: "face_fm2",    tintable: true,  eyeColor: true  },
    { id: "fm3", name: "Cicatriz 1", spriteKey: "face_fm3",    tintable: false },
    { id: "fm4", name: "Cicatriz 2", spriteKey: "face_fm4",    tintable: false },
    { id: "fm5", name: "Marcas War", spriteKey: "face_fm5",    tintable: true  },
    { id: "fm6", name: "Pinturas",   spriteKey: "face_fm6",    tintable: true  },
    { id: "fm7", name: "Tatuaje",    spriteKey: "face_fm7",    tintable: true  },
    { id: "fm8", name: "Barba",      spriteKey: "face_fm8",    tintable: true  },
  ];

  const FACE_CATALOG_FEMALE = [
    { id: "ff0", name: "Sin cara",   spriteKey: null,          tintable: false },
    { id: "ff1", name: "Ojos Nor F", spriteKey: "face_ff1",    tintable: true,  eyeColor: true  },
    { id: "ff2", name: "Ojos Cat F", spriteKey: "face_ff2",    tintable: true,  eyeColor: true  },
    { id: "ff3", name: "Rubor",      spriteKey: "face_ff3",    tintable: true  },
    { id: "ff4", name: "Pintura F",  spriteKey: "face_ff4",    tintable: true  },
    { id: "ff5", name: "Marcas F",   spriteKey: "face_ff5",    tintable: true  },
    { id: "ff6", name: "Cicatriz F", spriteKey: "face_ff6",    tintable: false },
    { id: "ff7", name: "Tatuaje F",  spriteKey: "face_ff7",    tintable: true  },
    { id: "ff8", name: "Pecas",      spriteKey: "face_ff8",    tintable: false },
  ];

  const FACE_CATALOG_NAMEKIAN = [
    { id: "fn0", name: "Sin cara",    spriteKey: null,          tintable: false },
    { id: "fn1", name: "Ojos Nam",    spriteKey: "face_fn1",    tintable: true,  eyeColor: true  },
    { id: "fn2", name: "Marcas Nam",  spriteKey: "face_fn2",    tintable: true  },
    { id: "fn3", name: "Ira Nam",     spriteKey: "face_fn3",    tintable: false },
    { id: "fn4", name: "Puntitos",    spriteKey: "face_fn4",    tintable: true  },
  ];

  const FACE_CATALOG_FRIEZA = [
    { id: "fr0", name: "Sin cara",    spriteKey: null,          tintable: false },
    { id: "fr1", name: "Ojos Arc",    spriteKey: "face_fr1",    tintable: true,  eyeColor: true  },
    { id: "fr2", name: "Marca Arc",   spriteKey: "face_fr2",    tintable: true  },
    { id: "fr3", name: "Lineas Arc",  spriteKey: "face_fr3",    tintable: true  },
    { id: "fr4", name: "Máscara",     spriteKey: "face_fr4",    tintable: false },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE CABELLO
  // ═══════════════════════════════════════════════════════════════

  const HAIR_CATALOG_MALE = [
    { id: "hm1", name: "Calvo",  spriteKey: "hair_hm1", tintable: true },
    { id: "hm2", name: "Vegeta", spriteKey: "hair_hm2", tintable: true },
    { id: "hm3", name: "SSJ",    spriteKey: "hair_hm3", tintable: true },
    { id: "hm4", name: "Blue",   spriteKey: "hair_hm4", tintable: true },
    { id: "hm5", name: "Trunks", spriteKey: "hair_hm5", tintable: true },
    { id: "hm6", name: "Corto",  spriteKey: "hair_hm6", tintable: true },
    { id: "hm7", name: "Largo",  spriteKey: "hair_hm7", tintable: true },
    { id: "hm8", name: "Goku",   spriteKey: "hair_hm8", tintable: true },
  ];

  const HAIR_CATALOG_FEMALE = [
    { id: "hf1", name: "Largo 1", spriteKey: "hair_hf1", tintable: true },
    { id: "hf2", name: "Coleta",  spriteKey: "hair_hf2", tintable: true },
    { id: "hf3", name: "Kefla",   spriteKey: "hair_hf3", tintable: true },
    { id: "hf4", name: "Corto F", spriteKey: "hair_hf4", tintable: true },
    { id: "hf5", name: "Trenzas", spriteKey: "hair_hf5", tintable: true },
    { id: "hf6", name: "Rizos",   spriteKey: "hair_hf6", tintable: true },
    { id: "hf7", name: "SSJ-F",   spriteKey: "hair_hf7", tintable: true },
    { id: "hf8", name: "Calva",   spriteKey: "hair_hf8", tintable: true },
  ];

  const HAIR_CATALOG_NAMEKIAN = [
    { id: "hn1", name: "Antenas 1", spriteKey: "hair_hn1", tintable: true },
    { id: "hn2", name: "Antenas 2", spriteKey: "hair_hn2", tintable: true },
    { id: "hn3", name: "Cresta",    spriteKey: "hair_hn3", tintable: true },
    { id: "hn4", name: "Cuernos",   spriteKey: "hair_hn4", tintable: true },
    { id: "hn5", name: "Sin crest", spriteKey: "hair_hn5", tintable: true },
    { id: "hn6", name: "Picos Nam", spriteKey: "hair_hn6", tintable: true },
    { id: "hn7", name: "Aletas",    spriteKey: "hair_hn7", tintable: true },
    { id: "hn8", name: "Dientes",   spriteKey: "hair_hn8", tintable: true },
  ];

  const HAIR_CATALOG_FRIEZA = [
    { id: "hr1", name: "Cuernos 1",  spriteKey: "hair_hr1", tintable: true },
    { id: "hr2", name: "Cuernos 2",  spriteKey: "hair_hr2", tintable: true },
    { id: "hr3", name: "Cresta Arc", spriteKey: "hair_hr3", tintable: true },
    { id: "hr4", name: "Picos Arc",  spriteKey: "hair_hr4", tintable: true },
    { id: "hr5", name: "Sin head",   spriteKey: "hair_hr5", tintable: true },
    { id: "hr6", name: "Armadura",   spriteKey: "hair_hr6", tintable: true },
    { id: "hr7", name: "Máscara",    spriteKey: "hair_hr7", tintable: true },
    { id: "hr8", name: "Corona",     spriteKey: "hair_hr8", tintable: true },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE ROPA SUPERIOR
  // ═══════════════════════════════════════════════════════════════

  const TOP_CATALOG_MALE = [
    { id: "sm1", name: "Gi Naranja", spriteKey: "top_sm1", color1: "#ff6a00", color2: "#1565c0", style: "gi"    },
    { id: "sm2", name: "Gi Azul",    spriteKey: "top_sm2", color1: "#1565c0", color2: "#ffffff", style: "gi"    },
    { id: "sm3", name: "Armadura",   spriteKey: "top_sm3", color1: "#c0c0c0", color2: "#333333", style: "armor" },
    { id: "sm4", name: "Gi Verde",   spriteKey: "top_sm4", color1: "#2e7d32", color2: "#ffffff", style: "gi"    },
    { id: "sm5", name: "Gi Morado",  spriteKey: "top_sm5", color1: "#6a1b9a", color2: "#ffd700", style: "gi"    },
    { id: "sm6", name: "Gi Rojo",    spriteKey: "top_sm6", color1: "#b71c1c", color2: "#ffffff", style: "gi"    },
    { id: "sm7", name: "Manga Neg",  spriteKey: "top_sm7", color1: "#1a1a1a", color2: "#444444", style: "plain" },
    { id: "sm8", name: "Sin ropa",   spriteKey: null,       color1: null,      color2: null,      style: "bare"  },
  ];

  const TOP_CATALOG_FEMALE = [
    { id: "sf1", name: "Gi Rosa",      spriteKey: "top_sf1", color1: "#e91e8c", color2: "#ffffff", style: "gi"    },
    { id: "sf2", name: "Gi Azul F",    spriteKey: "top_sf2", color1: "#1565c0", color2: "#ffffff", style: "gi"    },
    { id: "sf3", name: "Armadura F",   spriteKey: "top_sf3", color1: "#c0c0c0", color2: "#333333", style: "armor" },
    { id: "sf4", name: "Gi Verde F",   spriteKey: "top_sf4", color1: "#2e7d32", color2: "#ffffff", style: "gi"    },
    { id: "sf5", name: "Gi Naranja F", spriteKey: "top_sf5", color1: "#ff6a00", color2: "#1565c0", style: "gi"    },
    { id: "sf6", name: "Top Negro",    spriteKey: "top_sf6", color1: "#1a1a1a", color2: "#555555", style: "plain" },
    { id: "sf7", name: "Gi Morado F",  spriteKey: "top_sf7", color1: "#6a1b9a", color2: "#ffd700", style: "gi"    },
    { id: "sf8", name: "Sin ropa F",   spriteKey: null,       color1: null,      color2: null,      style: "bare"  },
  ];

  const TOP_CATALOG_NAMEKIAN = [
    { id: "sn1", name: "Manto Nam",  spriteKey: "top_sn1", color1: "#4caf50", color2: "#1b5e20", style: "gi"    },
    { id: "sn2", name: "Gi Nam 1",   spriteKey: "top_sn2", color1: "#388e3c", color2: "#ffffff", style: "gi"    },
    { id: "sn3", name: "Armad Nam",  spriteKey: "top_sn3", color1: "#2e7d32", color2: "#a5d6a7", style: "armor" },
    { id: "sn4", name: "Gi Nam 2",   spriteKey: "top_sn4", color1: "#1b5e20", color2: "#69f0ae", style: "gi"    },
    { id: "sn5", name: "Gi Nam 3",   spriteKey: "top_sn5", color1: "#00695c", color2: "#ffffff", style: "gi"    },
    { id: "sn6", name: "Gi Nam 4",   spriteKey: "top_sn6", color1: "#558b2f", color2: "#ccff90", style: "gi"    },
    { id: "sn7", name: "Mant Osc",   spriteKey: "top_sn7", color1: "#1a2a1a", color2: "#4caf50", style: "plain" },
    { id: "sn8", name: "Sin ropa N", spriteKey: null,       color1: null,      color2: null,      style: "bare"  },
  ];

  const TOP_CATALOG_FRIEZA = [
    { id: "sr1", name: "Armad Arc 1", spriteKey: "top_sr1", color1: "#7c4dff", color2: "#1a1a1a", style: "armor" },
    { id: "sr2", name: "Armad Arc 2", spriteKey: "top_sr2", color1: "#e040fb", color2: "#ffffff", style: "armor" },
    { id: "sr3", name: "Manto Arc",   spriteKey: "top_sr3", color1: "#f0e0f0", color2: "#9e9e9e", style: "gi"    },
    { id: "sr4", name: "Armad Arc 3", spriteKey: "top_sr4", color1: "#c0c0c0", color2: "#7c4dff", style: "armor" },
    { id: "sr5", name: "Gi Arc 1",    spriteKey: "top_sr5", color1: "#1a1a1a", color2: "#7c4dff", style: "gi"    },
    { id: "sr6", name: "Gi Arc 2",    spriteKey: "top_sr6", color1: "#f0e0f0", color2: "#e040fb", style: "gi"    },
    { id: "sr7", name: "Armad Dor",   spriteKey: "top_sr7", color1: "#ffd700", color2: "#1a1a1a", style: "armor" },
    { id: "sr8", name: "Sin ropa A",  spriteKey: null,       color1: null,      color2: null,      style: "bare"  },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE ROPA INFERIOR
  // ═══════════════════════════════════════════════════════════════

  const BOTTOM_CATALOG_MALE = [
    { id: "pm1", name: "Naranja", spriteKey: "bottom_pm1", color: "#ff6a00" },
    { id: "pm2", name: "Azul",    spriteKey: "bottom_pm2", color: "#1565c0" },
    { id: "pm3", name: "Blanco",  spriteKey: "bottom_pm3", color: "#e0e0e0" },
    { id: "pm4", name: "Morado",  spriteKey: "bottom_pm4", color: "#7b1fa2" },
    { id: "pm5", name: "Negro",   spriteKey: "bottom_pm5", color: "#1a1a1a" },
    { id: "pm6", name: "Verde",   spriteKey: "bottom_pm6", color: "#2e7d32" },
    { id: "pm7", name: "Rojo",    spriteKey: "bottom_pm7", color: "#b71c1c" },
    { id: "pm8", name: "Marrón",  spriteKey: "bottom_pm8", color: "#5d4037" },
  ];

  const BOTTOM_CATALOG_FEMALE = [
    { id: "pf1", name: "Falda Nar",  spriteKey: "bottom_pf1", color: "#ff6a00" },
    { id: "pf2", name: "Pantalon F", spriteKey: "bottom_pf2", color: "#1565c0" },
    { id: "pf3", name: "Falda Bla",  spriteKey: "bottom_pf3", color: "#e0e0e0" },
    { id: "pf4", name: "Leggings",   spriteKey: "bottom_pf4", color: "#1a1a1a" },
    { id: "pf5", name: "Falda Mor",  spriteKey: "bottom_pf5", color: "#7b1fa2" },
    { id: "pf6", name: "Short Ver",  spriteKey: "bottom_pf6", color: "#2e7d32" },
    { id: "pf7", name: "Falda Roj",  spriteKey: "bottom_pf7", color: "#b71c1c" },
    { id: "pf8", name: "Short Neg",  spriteKey: "bottom_pf8", color: "#1a1a1a" },
  ];

  const BOTTOM_CATALOG_NAMEKIAN = [
    { id: "pn1", name: "Pantam Nam", spriteKey: "bottom_pn1", color: "#4caf50" },
    { id: "pn2", name: "Manto Inf",  spriteKey: "bottom_pn2", color: "#1b5e20" },
    { id: "pn3", name: "Faja Nam",   spriteKey: "bottom_pn3", color: "#388e3c" },
    { id: "pn4", name: "Short Nam",  spriteKey: "bottom_pn4", color: "#2e7d32" },
    { id: "pn5", name: "Pant Osc",   spriteKey: "bottom_pn5", color: "#1a2a1a" },
    { id: "pn6", name: "Pant Cla",   spriteKey: "bottom_pn6", color: "#a5d6a7" },
    { id: "pn7", name: "Pant Amar",  spriteKey: "bottom_pn7", color: "#f9a825" },
    { id: "pn8", name: "Pant Azul",  spriteKey: "bottom_pn8", color: "#0d47a1" },
  ];

  const BOTTOM_CATALOG_FRIEZA = [
    { id: "pr1", name: "Arm Inf 1",  spriteKey: "bottom_pr1", color: "#7c4dff" },
    { id: "pr2", name: "Arm Inf 2",  spriteKey: "bottom_pr2", color: "#e040fb" },
    { id: "pr3", name: "Manto Arc",  spriteKey: "bottom_pr3", color: "#f0e0f0" },
    { id: "pr4", name: "Escam Neg",  spriteKey: "bottom_pr4", color: "#1a1a1a" },
    { id: "pr5", name: "Escam Bla",  spriteKey: "bottom_pr5", color: "#f5f5f5" },
    { id: "pr6", name: "Pant Arc",   spriteKey: "bottom_pr6", color: "#9e9e9e" },
    { id: "pr7", name: "Pant Dor",   spriteKey: "bottom_pr7", color: "#ffd700" },
    { id: "pr8", name: "Arm Inf 3",  spriteKey: "bottom_pr8", color: "#311b92" },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE CALZADO
  // ═══════════════════════════════════════════════════════════════

  const SHOES_CATALOG_MALE = [
    { id: "shm1", name: "Botas Azul", spriteKey: "shoes_shm1", color1: "#1565c0", color2: "#f5f5f5", style: "boots"   },
    { id: "shm2", name: "Botas Neg",  spriteKey: "shoes_shm2", color1: "#1a1a1a", color2: "#555555", style: "boots"   },
    { id: "shm3", name: "Botas Dor",  spriteKey: "shoes_shm3", color1: "#ffd600", color2: "#ff6f00", style: "boots"   },
    { id: "shm4", name: "Botas Mor",  spriteKey: "shoes_shm4", color1: "#7b1fa2", color2: "#e040fb", style: "boots"   },
    { id: "shm5", name: "Sandalia",   spriteKey: "shoes_shm5", color1: "#8d6e63", color2: "#6d4c41", style: "sandals" },
    { id: "shm6", name: "San Neg",    spriteKey: "shoes_shm6", color1: "#212121", color2: "#616161", style: "sandals" },
    { id: "shm7", name: "Botas Roj",  spriteKey: "shoes_shm7", color1: "#c62828", color2: "#ff5252", style: "boots"   },
    { id: "shm8", name: "Sin calz",   spriteKey: null,          color1: null,      color2: null,      style: "bare"    },
  ];

  const SHOES_CATALOG_FEMALE = [
    { id: "shf1", name: "Bota Alta",   spriteKey: "shoes_shf1", color1: "#1565c0", color2: "#f5f5f5", style: "boots"   },
    { id: "shf2", name: "Bota Neg F",  spriteKey: "shoes_shf2", color1: "#1a1a1a", color2: "#555555", style: "boots"   },
    { id: "shf3", name: "Bota Roja F", spriteKey: "shoes_shf3", color1: "#c62828", color2: "#ff5252", style: "boots"   },
    { id: "shf4", name: "Sandal F",    spriteKey: "shoes_shf4", color1: "#8d6e63", color2: "#6d4c41", style: "sandals" },
    { id: "shf5", name: "Tacón Dor",   spriteKey: "shoes_shf5", color1: "#ffd600", color2: "#ff6f00", style: "boots"   },
    { id: "shf6", name: "Zapato Bla",  spriteKey: "shoes_shf6", color1: "#f5f5f5", color2: "#bdbdbd", style: "boots"   },
    { id: "shf7", name: "Bota Mor F",  spriteKey: "shoes_shf7", color1: "#7b1fa2", color2: "#e040fb", style: "boots"   },
    { id: "shf8", name: "Sin calz F",  spriteKey: null,          color1: null,      color2: null,      style: "bare"    },
  ];

  const SHOES_CATALOG_NAMEKIAN = [
    { id: "shn1", name: "Sandal Nam",  spriteKey: "shoes_shn1", color1: "#4caf50", color2: "#1b5e20", style: "sandals" },
    { id: "shn2", name: "Bota Nam",    spriteKey: "shoes_shn2", color1: "#2e7d32", color2: "#a5d6a7", style: "boots"   },
    { id: "shn3", name: "Desc Nam",    spriteKey: null,          color1: null,      color2: null,      style: "bare"    },
    { id: "shn4", name: "Vendaje",     spriteKey: "shoes_shn4", color1: "#8d6e63", color2: "#4caf50", style: "sandals" },
    { id: "shn5", name: "Bota Osc",    spriteKey: "shoes_shn5", color1: "#1a2a1a", color2: "#4caf50", style: "boots"   },
    { id: "shn6", name: "Bota Amar",   spriteKey: "shoes_shn6", color1: "#f9a825", color2: "#f57f17", style: "boots"   },
    { id: "shn7", name: "Sandal Neg",  spriteKey: "shoes_shn7", color1: "#212121", color2: "#388e3c", style: "sandals" },
    { id: "shn8", name: "Bota Azul N", spriteKey: "shoes_shn8", color1: "#0d47a1", color2: "#4caf50", style: "boots"   },
  ];

  const SHOES_CATALOG_FRIEZA = [
    { id: "shr1", name: "Bota Arc 1", spriteKey: "shoes_shr1", color1: "#7c4dff", color2: "#1a1a1a", style: "boots"   },
    { id: "shr2", name: "Bota Arc 2", spriteKey: "shoes_shr2", color1: "#f0e0f0", color2: "#9e9e9e", style: "boots"   },
    { id: "shr3", name: "Escam Pie",  spriteKey: "shoes_shr3", color1: "#e040fb", color2: "#1a1a1a", style: "boots"   },
    { id: "shr4", name: "Desc Arc",   spriteKey: null,          color1: null,      color2: null,      style: "bare"    },
    { id: "shr5", name: "Bota Neg A", spriteKey: "shoes_shr5", color1: "#1a1a1a", color2: "#7c4dff", style: "boots"   },
    { id: "shr6", name: "Bota Dor A", spriteKey: "shoes_shr6", color1: "#ffd700", color2: "#1a1a1a", style: "boots"   },
    { id: "shr7", name: "Bota Bla A", spriteKey: "shoes_shr7", color1: "#f5f5f5", color2: "#e040fb", style: "boots"   },
    { id: "shr8", name: "Sandal Arc", spriteKey: "shoes_shr8", color1: "#9e9e9e", color2: "#7c4dff", style: "sandals" },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  CATÁLOGOS DE GUANTES
  // ═══════════════════════════════════════════════════════════════

  const GLOVES_CATALOG_MALE = [
    { id: "gm0", name: "Sin guantes", spriteKey: null,         color: null      },
    { id: "gm1", name: "Blancos",     spriteKey: "glove_gm1", color: "#f5f5f5" },
    { id: "gm2", name: "Negros",      spriteKey: "glove_gm2", color: "#212121" },
    { id: "gm3", name: "Rojos",       spriteKey: "glove_gm3", color: "#c62828" },
    { id: "gm4", name: "Azules",      spriteKey: "glove_gm4", color: "#1565c0" },
    { id: "gm5", name: "Dorados",     spriteKey: "glove_gm5", color: "#ffd600" },
    { id: "gm6", name: "Cibernét.",   spriteKey: "glove_gm6", color: "#00bcd4" },
    { id: "gm7", name: "Morados",     spriteKey: "glove_gm7", color: "#6a1b9a" },
  ];

  const GLOVES_CATALOG_FEMALE = [
    { id: "gf0", name: "Sin guantes", spriteKey: null,         color: null      },
    { id: "gf1", name: "Blancos F",   spriteKey: "glove_gf1", color: "#f5f5f5" },
    { id: "gf2", name: "Negros F",    spriteKey: "glove_gf2", color: "#212121" },
    { id: "gf3", name: "Rojos F",     spriteKey: "glove_gf3", color: "#c62828" },
    { id: "gf4", name: "Azules F",    spriteKey: "glove_gf4", color: "#1565c0" },
    { id: "gf5", name: "Dorados F",   spriteKey: "glove_gf5", color: "#ffd600" },
    { id: "gf6", name: "Cristal",     spriteKey: "glove_gf6", color: "#e1f5fe" },
    { id: "gf7", name: "Morados F",   spriteKey: "glove_gf7", color: "#6a1b9a" },
  ];

  const GLOVES_CATALOG_NAMEKIAN = [
    { id: "gn0", name: "Sin guantes",  spriteKey: null,          color: null      },
    { id: "gn1", name: "Guant Nam 1",  spriteKey: "glove_gn1",  color: "#4caf50" },
    { id: "gn2", name: "Guant Nam 2",  spriteKey: "glove_gn2",  color: "#1b5e20" },
    { id: "gn3", name: "Vendaje",      spriteKey: "glove_gn3",  color: "#8d6e63" },
    { id: "gn4", name: "Guant Neg N",  spriteKey: "glove_gn4",  color: "#1a2a1a" },
    { id: "gn5", name: "Guant Amar",   spriteKey: "glove_gn5",  color: "#f9a825" },
    { id: "gn6", name: "Guant Azul N", spriteKey: "glove_gn6",  color: "#0d47a1" },
    { id: "gn7", name: "Guant Bla N",  spriteKey: "glove_gn7",  color: "#c8e6c9" },
  ];

  const GLOVES_CATALOG_FRIEZA = [
    { id: "gr0", name: "Sin guantes", spriteKey: null,         color: null      },
    { id: "gr1", name: "Arm Mano 1",  spriteKey: "glove_gr1", color: "#7c4dff" },
    { id: "gr2", name: "Arm Mano 2",  spriteKey: "glove_gr2", color: "#f0e0f0" },
    { id: "gr3", name: "Garra Arc",   spriteKey: "glove_gr3", color: "#1a1a1a" },
    { id: "gr4", name: "Guant Dor A", spriteKey: "glove_gr4", color: "#ffd700" },
    { id: "gr5", name: "Guant Neg A", spriteKey: "glove_gr5", color: "#212121" },
    { id: "gr6", name: "Arm Mano 3",  spriteKey: "glove_gr6", color: "#e040fb" },
    { id: "gr7", name: "Guant Cris",  spriteKey: "glove_gr7", color: "#e1f5fe" },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  AURAS
  // ═══════════════════════════════════════════════════════════════

  const AURAS_CATALOG = [
    { id: "a0", name: "Sin aura",  spriteKey: null,       color: null,      style: "none"     },
    { id: "a1", name: "Amarilla",  spriteKey: "aura_a1", color: "#fdd835", style: "flames"   },
    { id: "a2", name: "Azul",      spriteKey: "aura_a2", color: "#00b0ff", style: "flames"   },
    { id: "a3", name: "Roja",      spriteKey: "aura_a3", color: "#ff1744", style: "flames"   },
    { id: "a4", name: "Morada",    spriteKey: "aura_a4", color: "#aa00ff", style: "flames"   },
    { id: "a5", name: "Verde",     spriteKey: "aura_a5", color: "#00e676", style: "flames"   },
    { id: "a6", name: "Blanca",    spriteKey: "aura_a6", color: "#e8eaf6", style: "divine"   },
    { id: "a7", name: "Eléctrica", spriteKey: "aura_a7", color: "#90a4ae", style: "electric" },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  ACCESORIOS IMPORTADOS POR USUARIO
  // ═══════════════════════════════════════════════════════════════

  const ACCESSORIES_CATALOG = [
    { id: "ac_none", name: "Ninguno", type: "none", slot: "over_shirt", color: null, userImage: null, dataURL: null },
  ];

  const ACCESSORY_TYPES = [
    { id: "belt",    label: "Cinturón",  slot: "belt_slot",   icon: "🥋" },
    { id: "cape",    label: "Capa",      slot: "under_shirt", icon: "🧣" },
    { id: "bag",     label: "Mochila",   slot: "under_shirt", icon: "🎒" },
    { id: "collar",  label: "Collar",    slot: "over_shirt",  icon: "📿" },
    { id: "brace",   label: "Brazal",    slot: "over_shirt",  icon: "⌚" },
    { id: "mask",    label: "Máscara",   slot: "over_shirt",  icon: "🥽" },
    { id: "scouter", label: "Scouter",   slot: "over_shirt",  icon: "🔭" },
    { id: "tail",    label: "Cola",      slot: "under_shirt", icon: "🐾" },
    { id: "wings",   label: "Alas",      slot: "under_shirt", icon: "🦋" },
    { id: "other",   label: "Otro",      slot: "over_shirt",  icon: "✨" },
  ];

  function addUserAccessory({ name, type, color, userImage, dataURL }) {
    const typeDef = ACCESSORY_TYPES.find(t => t.id === type) || ACCESSORY_TYPES[ACCESSORY_TYPES.length - 1];
    const entry = {
      id:         "user_acc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name:       name || "Accesorio",
      type:       typeDef.id,
      slot:       typeDef.slot,
      color:      color || "#888888",
      userImage:  userImage || null,
      dataURL:    dataURL   || null,
    };
    ACCESSORIES_CATALOG.push(entry);
    return entry;
  }

  function removeUserAccessory(id) {
    if (id === "ac_none") return false;
    const idx = ACCESSORIES_CATALOG.findIndex(a => a.id === id);
    if (idx === -1) return false;
    ACCESSORIES_CATALOG.splice(idx, 1);
    return true;
  }

  async function restoreUserAccessories(storedList) {
    if (!Array.isArray(storedList)) return;
    const loads = storedList.map(entry => new Promise(resolve => {
      if (!entry.dataURL) { resolve(); return; }
      const img = new Image();
      img.onload = () => {
        ACCESSORIES_CATALOG.push({
          id:        entry.id,
          name:      entry.name,
          type:      entry.type,
          slot:      (ACCESSORY_TYPES.find(t => t.id === entry.type) || { slot: "over_shirt" }).slot,
          color:     entry.color,
          userImage: img,
          dataURL:   entry.dataURL,
        });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = entry.dataURL;
    }));
    await Promise.all(loads);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Alias de catálogos por defecto (masculino)
  // ═══════════════════════════════════════════════════════════════

  const HAIR_CATALOG   = HAIR_CATALOG_MALE;
  const FACE_CATALOG   = FACE_CATALOG_MALE;
  const TOP_CATALOG    = TOP_CATALOG_MALE;
  const BOTTOM_CATALOG = BOTTOM_CATALOG_MALE;
  const SHOES_CATALOG  = SHOES_CATALOG_MALE;
  const GLOVES_CATALOG = GLOVES_CATALOG_MALE;

  const GENDERLESS_RACES = ["namekian", "frieza"];

  function getCatalogFor(cat, raceId, gender) {
    if (cat === "aura")      return AURAS_CATALOG;
    if (cat === "accessory") return ACCESSORIES_CATALOG;
    if (raceId === "namekian") {
      switch (cat) {
        case "face":   return FACE_CATALOG_NAMEKIAN;
        case "hair":   return HAIR_CATALOG_NAMEKIAN;
        case "shirt":  return TOP_CATALOG_NAMEKIAN;
        case "pants":  return BOTTOM_CATALOG_NAMEKIAN;
        case "shoes":  return SHOES_CATALOG_NAMEKIAN;
        case "gloves": return GLOVES_CATALOG_NAMEKIAN;
      }
    }
    if (raceId === "frieza") {
      switch (cat) {
        case "face":   return FACE_CATALOG_FRIEZA;
        case "hair":   return HAIR_CATALOG_FRIEZA;
        case "shirt":  return TOP_CATALOG_FRIEZA;
        case "pants":  return BOTTOM_CATALOG_FRIEZA;
        case "shoes":  return SHOES_CATALOG_FRIEZA;
        case "gloves": return GLOVES_CATALOG_FRIEZA;
      }
    }
    const isFemale = gender === "female";
    switch (cat) {
      case "face":   return isFemale ? FACE_CATALOG_FEMALE   : FACE_CATALOG_MALE;
      case "hair":   return isFemale ? HAIR_CATALOG_FEMALE   : HAIR_CATALOG_MALE;
      case "shirt":  return isFemale ? TOP_CATALOG_FEMALE    : TOP_CATALOG_MALE;
      case "pants":  return isFemale ? BOTTOM_CATALOG_FEMALE : BOTTOM_CATALOG_MALE;
      case "shoes":  return isFemale ? SHOES_CATALOG_FEMALE  : SHOES_CATALOG_MALE;
      case "gloves": return isFemale ? GLOVES_CATALOG_FEMALE : GLOVES_CATALOG_MALE;
    }
    return [];
  }

  function getDefaultIds(raceId, gender) {
    const face   = getCatalogFor("face",   raceId, gender);
    const hair   = getCatalogFor("hair",   raceId, gender);
    const shirt  = getCatalogFor("shirt",  raceId, gender);
    const pants  = getCatalogFor("pants",  raceId, gender);
    const shoes  = getCatalogFor("shoes",  raceId, gender);
    const gloves = getCatalogFor("gloves", raceId, gender);
    return {
      faceId:      face[0]   ? face[0].id   : "fm0",
      hairId:      hair[0]   ? hair[0].id   : "hm1",
      topId:       shirt[0]  ? shirt[0].id  : "sm1",
      bottomId:    pants[0]  ? pants[0].id  : "pm1",
      shoesId:     shoes[0]  ? shoes[0].id  : "shm1",
      glovesId:    gloves[0] ? gloves[0].id : "gm0",
      accessoryId: "ac_none",
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  MAPA DE SPRITES
  // ═══════════════════════════════════════════════════════════════

  const SPRITE_IMAGES = {
    human_male:      "Skins/HumanIdle.png",
    human_female:    "Skins/MujerIdle.png",
    saiyan_male:     "Skins/HumanIdle.png",
    saiyan_female:   "Skins/MujerIdle.png",
    namekian_male:   "Skins/NamekianIdle.png",
    android_male:    "Skins/HumanIdle.png",
    android_female:  "Skins/MujerIdle.png",
    kaioshin_male:   "Skins/Kaioshin.png",
    kaioshin_female: "Skins/KaioshinF.png",
    frieza_male:     "Skins/Arcosiano.png",

    face_fm1: "face/male/fm1_eyes_normal.png",
    face_fm2: "face/male/fm2_eyes_fierce.png",
    face_fm3: "face/male/fm3_scar1.png",
    face_fm4: "face/male/fm4_scar2.png",
    face_fm5: "face/male/fm5_war_marks.png",
    face_fm6: "face/male/fm6_paint.png",
    face_fm7: "face/male/fm7_tattoo.png",
    face_fm8: "face/male/fm8_beard.png",

    face_ff1: "face/female/ff1_eyes_normal.png",
    face_ff2: "face/female/ff2_eyes_cat.png",
    face_ff3: "face/female/ff3_blush.png",
    face_ff4: "face/female/ff4_paint.png",
    face_ff5: "face/female/ff5_marks.png",
    face_ff6: "face/female/ff6_scar.png",
    face_ff7: "face/female/ff7_tattoo.png",
    face_ff8: "face/female/ff8_freckles.png",

    face_fn1: "face/namekian/fn1_eyes.png",
    face_fn2: "face/namekian/fn2_marks.png",
    face_fn3: "face/namekian/fn3_angry.png",
    face_fn4: "face/namekian/fn4_dots.png",

    face_fr1: "face/frieza/fr1_eyes.png",
    face_fr2: "face/frieza/fr2_mark.png",
    face_fr3: "face/frieza/fr3_lines.png",
    face_fr4: "face/frieza/fr4_mask.png",

    hair_hm1: "hair/male/hm1_mondongo.png",
    hair_hm2: "hair/male/BaseSpriteSheet.png",
    hair_hm3: "hair/male/hm3_ssj.png",
    hair_hm4: "hair/male/hm4_blue.png",
    hair_hm5: "hair/male/hm5_trunks.png",
    hair_hm6: "hair/male/hm6_corto.png",
    hair_hm7: "hair/male/hm7_largo.png",
    hair_hm8: "hair/male/hm8_mohawk.png",

    hair_hf1: "hair/female/hf1_largo1.png",
    hair_hf2: "hair/female/hf2_coleta.png",
    hair_hf3: "hair/female/hf3_kefla.png",
    hair_hf4: "hair/female/hf4_corto.png",
    hair_hf5: "hair/female/hf5_trenzas.png",
    hair_hf6: "hair/female/hf6_rizos.png",
    hair_hf7: "hair/female/hf7_ssjf.png",
    hair_hf8: "hair/female/hf8_calva.png",

    hair_hn1: "hair/namekian/hn1_antenas1.png",
    hair_hn2: "hair/namekian/hn2_antenas2.png",
    hair_hn3: "hair/namekian/hn3_cresta.png",
    hair_hn4: "hair/namekian/hn4_cuernos.png",
    hair_hn5: "hair/namekian/hn5_sin.png",
    hair_hn6: "hair/namekian/hn6_picos.png",
    hair_hn7: "hair/namekian/hn7_aletas.png",
    hair_hn8: "hair/namekian/hn8_dientes.png",

    hair_hr1: "hair/frieza/hr1_cuernos1.png",
    hair_hr2: "hair/frieza/hr2_cuernos2.png",
    hair_hr3: "hair/frieza/hr3_cresta.png",
    hair_hr4: "hair/frieza/hr4_picos.png",
    hair_hr5: "hair/frieza/hr5_sin.png",
    hair_hr6: "hair/frieza/hr6_armadura.png",
    hair_hr7: "hair/frieza/hr7_mascara.png",
    hair_hr8: "hair/frieza/hr8_corona.png",

    top_sm1: "tops/male/sm1_gi_orange.png",
    top_sm2: "tops/male/sm2_gi_blue.png",
    top_sm3: "tops/male/sm3_armor.png",
    top_sm4: "tops/male/sm4_gi_green.png",
    top_sm5: "tops/male/sm5_gi_purple.png",
    top_sm6: "tops/male/sm6_gi_red.png",
    top_sm7: "tops/male/sm7_black_sleeves.png",

    top_sf1: "tops/female/sf1_gi_pink.png",
    top_sf2: "tops/female/sf2_gi_blue.png",
    top_sf3: "tops/female/sf3_armor.png",
    top_sf4: "tops/female/sf4_gi_green.png",
    top_sf5: "tops/female/sf5_gi_orange.png",
    top_sf6: "tops/female/sf6_top_black.png",
    top_sf7: "tops/female/sf7_gi_purple.png",

    top_sn1: "tops/namekian/sn1_manto.png",
    top_sn2: "tops/namekian/sn2_gi1.png",
    top_sn3: "tops/namekian/sn3_armor.png",
    top_sn4: "tops/namekian/sn4_gi2.png",
    top_sn5: "tops/namekian/sn5_gi3.png",
    top_sn6: "tops/namekian/sn6_gi4.png",
    top_sn7: "tops/namekian/sn7_mant_osc.png",

    top_sr1: "tops/frieza/sr1_armor1.png",
    top_sr2: "tops/frieza/sr2_armor2.png",
    top_sr3: "tops/frieza/sr3_manto.png",
    top_sr4: "tops/frieza/sr4_armor3.png",
    top_sr5: "tops/frieza/sr5_gi1.png",
    top_sr6: "tops/frieza/sr6_gi2.png",
    top_sr7: "tops/frieza/sr7_armor_gold.png",

    bottom_pm1: "bottoms/male/pm1_orange.png",
    bottom_pm2: "bottoms/male/pm2_blue.png",
    bottom_pm3: "bottoms/male/pm3_white.png",
    bottom_pm4: "bottoms/male/pm4_purple.png",
    bottom_pm5: "bottoms/male/pm5_black.png",
    bottom_pm6: "bottoms/male/pm6_green.png",
    bottom_pm7: "bottoms/male/pm7_red.png",
    bottom_pm8: "bottoms/male/pm8_brown.png",

    bottom_pf1: "bottoms/female/pf1_skirt_orange.png",
    bottom_pf2: "bottoms/female/pf2_pants_blue.png",
    bottom_pf3: "bottoms/female/pf3_skirt_white.png",
    bottom_pf4: "bottoms/female/pf4_leggings.png",
    bottom_pf5: "bottoms/female/pf5_skirt_purple.png",
    bottom_pf6: "bottoms/female/pf6_short_green.png",
    bottom_pf7: "bottoms/female/pf7_skirt_red.png",
    bottom_pf8: "bottoms/female/pf8_short_black.png",

    bottom_pn1: "bottoms/namekian/pn1_pants.png",
    bottom_pn2: "bottoms/namekian/pn2_manto_inf.png",
    bottom_pn3: "bottoms/namekian/pn3_faja.png",
    bottom_pn4: "bottoms/namekian/pn4_short.png",
    bottom_pn5: "bottoms/namekian/pn5_osc.png",
    bottom_pn6: "bottoms/namekian/pn6_cla.png",
    bottom_pn7: "bottoms/namekian/pn7_amar.png",
    bottom_pn8: "bottoms/namekian/pn8_azul.png",

    bottom_pr1: "bottoms/frieza/pr1_armor1.png",
    bottom_pr2: "bottoms/frieza/pr2_armor2.png",
    bottom_pr3: "bottoms/frieza/pr3_manto.png",
    bottom_pr4: "bottoms/frieza/pr4_escamas_neg.png",
    bottom_pr5: "bottoms/frieza/pr5_escamas_bla.png",
    bottom_pr6: "bottoms/frieza/pr6_pants.png",
    bottom_pr7: "bottoms/frieza/pr7_gold.png",
    bottom_pr8: "bottoms/frieza/pr8_armor3.png",

    shoes_shm1: "shoes/male/shm1_blue.png",
    shoes_shm2: "shoes/male/shm2_black.png",
    shoes_shm3: "shoes/male/shm3_gold.png",
    shoes_shm4: "shoes/male/shm4_purple.png",
    shoes_shm5: "shoes/male/shm5_sandals.png",
    shoes_shm6: "shoes/male/shm6_sandals_black.png",
    shoes_shm7: "shoes/male/shm7_red.png",

    shoes_shf1: "shoes/female/shf1_high_blue.png",
    shoes_shf2: "shoes/female/shf2_black.png",
    shoes_shf3: "shoes/female/shf3_red.png",
    shoes_shf4: "shoes/female/shf4_sandals.png",
    shoes_shf5: "shoes/female/shf5_gold.png",
    shoes_shf6: "shoes/female/shf6_white.png",
    shoes_shf7: "shoes/female/shf7_purple.png",

    shoes_shn1: "shoes/namekian/shn1_sandals.png",
    shoes_shn2: "shoes/namekian/shn2_boots.png",
    shoes_shn4: "shoes/namekian/shn4_vendaje.png",
    shoes_shn5: "shoes/namekian/shn5_osc.png",
    shoes_shn6: "shoes/namekian/shn6_amar.png",
    shoes_shn7: "shoes/namekian/shn7_sandals_black.png",
    shoes_shn8: "shoes/namekian/shn8_blue.png",

    shoes_shr1: "shoes/frieza/shr1_armor1.png",
    shoes_shr2: "shoes/frieza/shr2_armor2.png",
    shoes_shr3: "shoes/frieza/shr3_escamas.png",
    shoes_shr5: "shoes/frieza/shr5_black.png",
    shoes_shr6: "shoes/frieza/shr6_gold.png",
    shoes_shr7: "shoes/frieza/shr7_white.png",
    shoes_shr8: "shoes/frieza/shr8_sandals.png",

    glove_gm1: "gloves/male/gm1_white.png",
    glove_gm2: "gloves/male/gm2_black.png",
    glove_gm3: "gloves/male/gm3_red.png",
    glove_gm4: "gloves/male/gm4_blue.png",
    glove_gm5: "gloves/male/gm5_gold.png",
    glove_gm6: "gloves/male/gm6_cyber.png",
    glove_gm7: "gloves/male/gm7_purple.png",

    glove_gf1: "gloves/female/gf1_white.png",
    glove_gf2: "gloves/female/gf2_black.png",
    glove_gf3: "gloves/female/gf3_red.png",
    glove_gf4: "gloves/female/gf4_blue.png",
    glove_gf5: "gloves/female/gf5_gold.png",
    glove_gf6: "gloves/female/gf6_crystal.png",
    glove_gf7: "gloves/female/gf7_purple.png",

    glove_gn1: "gloves/namekian/gn1_green.png",
    glove_gn2: "gloves/namekian/gn2_dark.png",
    glove_gn3: "gloves/namekian/gn3_vendaje.png",
    glove_gn4: "gloves/namekian/gn4_black.png",
    glove_gn5: "gloves/namekian/gn5_yellow.png",
    glove_gn6: "gloves/namekian/gn6_blue.png",
    glove_gn7: "gloves/namekian/gn7_white.png",

    glove_gr1: "gloves/frieza/gr1_armor1.png",
    glove_gr2: "gloves/frieza/gr2_armor2.png",
    glove_gr3: "gloves/frieza/gr3_claw.png",
    glove_gr4: "gloves/frieza/gr4_gold.png",
    glove_gr5: "gloves/frieza/gr5_black.png",
    glove_gr6: "gloves/frieza/gr6_armor3.png",
    glove_gr7: "gloves/frieza/gr7_crystal.png",

    aura_a1: "auras/a1_yellow.png",
    aura_a2: "auras/a2_blue.png",
    aura_a3: "auras/a3_red.png",
    aura_a4: "auras/a4_purple.png",
    aura_a5: "auras/a5_green.png",
    aura_a6: "auras/a6_white.png",
    aura_a7: "auras/a7_electric.png",
  };

  // ═══════════════════════════════════════════════════════════════
  //  DETECCIÓN DE FRAME SIZE
  // ═══════════════════════════════════════════════════════════════

  const MAX_COLS   = 6;
  const TOTAL_ROWS = 14;
  const IDLE_ROW   = ACTIONS_META.idle.row;

  function detectFrameSize(img) {
    if (!img || !img.naturalWidth) return { fw: FRAME_W, fh: FRAME_H };
    const fw = Math.floor(img.naturalWidth  / MAX_COLS);
    const fh = Math.floor(img.naturalHeight / TOTAL_ROWS);
    return { fw: fw > 0 ? fw : FRAME_W, fh: fh > 0 ? fh : FRAME_H };
  }

  const _frameSizeCache = new Map();

  function getFrameSize(img) {
    if (!img) return { fw: FRAME_W, fh: FRAME_H };
    const key = img.src || (img.naturalWidth + "x" + img.naturalHeight);
    if (!_frameSizeCache.has(key)) _frameSizeCache.set(key, detectFrameSize(img));
    return _frameSizeCache.get(key);
  }

  function isCompatibleSheet(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return false;
    const { fw, fh } = getFrameSize(img);
    return img.naturalWidth >= fw && img.naturalHeight >= fh * TOTAL_ROWS;
  }

  function getIdleFrameCoords(img) {
    const { fw, fh } = getFrameSize(img);
    return { srcX: 0, srcY: IDLE_ROW * fh, fw, fh };
  }

  // ═══════════════════════════════════════════════════════════════
  //  OBJETO PLAYER
  //
  //  appearance ahora incluye browColor y pupilColor (v1.0.2):
  //    browColor  → color de las cejas  (null = usa eyeColor como fallback)
  //    pupilColor → color de las pupilas (null = usa eyeColor como fallback)
  //    eyeColor   → color global de ojos (fallback si los otros son null)
  // ═══════════════════════════════════════════════════════════════

  const player = {
    x: 0, y: 0, vx: 0, vy: 0,
    direction: 1,
    onGround: false,
    state: "idle",
    appearance: {
      raceId:      "human",
      gender:      "male",
      faceId:      "fm0",
      faceColor:   null,
      hairId:      "hm1",
      hairColor:   "#1a1a1a",
      topId:       "sm1",
      bottomId:    "pm1",
      shoesId:     "shm1",
      glovesId:    "gm0",
      auraId:      "a1",
      auraColor:   "#fdd835",
      skinColor:   "#e8c898",
      eyeColor:    "#3a2a1a",   // color global de ojos (fallback)
      browColor:   null,        // color de cejas  (null = usa eyeColor)
      pupilColor:  null,        // color de pupilas (null = usa eyeColor)
      accessoryId: "ac_none",
    },
    _animator: null,
  };

  // ═══════════════════════════════════════════════════════════════
  //  ANIMADOR
  // ═══════════════════════════════════════════════════════════════

  class SpriteAnimator {
    constructor(action = "idle") {
      this.action      = action;
      this.frame       = 0;
      this.elapsed     = 0;
      this._lastTime   = performance.now();
      this._onComplete = null;
      this._queue      = [];
      this.currentView = null;
    }

    get meta() {
      if (this.currentView && VIEW_META[this.currentView]) return VIEW_META[this.currentView];
      return ACTIONS_META[this.action] || ACTIONS_META.idle;
    }

    setView(viewKey) {
      if (!VIEW_META[viewKey]) return this;
      this.currentView = viewKey; this.frame = 0; this.elapsed = 0;
      return this;
    }

    clearView() { this.currentView = null; return this; }

    play(action, onComplete = null) {
      const m = ACTIONS_META[action];
      if (!m) return this;
      this.currentView = null;
      if (this.action === action && m.loop && !onComplete) return this;
      this.action = action; this.frame = 0; this.elapsed = 0;
      this._onComplete = onComplete;
      return this;
    }

    then(action) { this._queue.push(action); return this; }

    update(now = performance.now()) {
      const delta = now - this._lastTime;
      this._lastTime = now;
      const m = this.meta;
      if (!m) return;
      this.elapsed += delta;
      const fd = 1000 / m.fps;
      while (this.elapsed >= fd) {
        this.elapsed -= fd;
        this.frame++;
        if (this.frame >= m.frames) {
          if (m.loop) {
            this.frame = 0;
          } else {
            this.frame = m.frames - 1;
            if (this._onComplete) { this._onComplete(); this._onComplete = null; }
            if (this._queue.length > 0) this.play(this._queue.shift());
          }
        }
      }
    }

    getFrameCoords(img = null) {
      const m = this.meta;
      let fw = FRAME_W, fh = FRAME_H;
      if (img) { const sz = getFrameSize(img); fw = sz.fw; fh = sz.fh; }
      return {
        srcX: this.frame * fw, srcY: m.row * fh,
        fw, fh,
        action: this.currentView || this.action,
        frame:  this.frame,
        label:  m.label || "",
      };
    }

    reset() { this.currentView = null; this.play("idle"); this._queue = []; }
    is(...actions) { return actions.includes(this.currentView || this.action); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRELOADER
  // ═══════════════════════════════════════════════════════════════

  async function preloadAssets(basePath = "") {
    const entries = Object.entries(SPRITE_IMAGES);
    const loadOne = ([key, filename]) => new Promise((resolve) => {
      if (!filename) { resolve([key, null]); return; }
      const img = new Image();
      img.onload  = () => { _frameSizeCache.clear(); resolve([key, img]); };
      img.onerror = () => {
        console.warn(`[CharacterSystem] No se pudo cargar: ${basePath}${filename}`);
        resolve([key, null]);
      };
      img.src = basePath + filename;
    });
    const results = await Promise.all(entries.map(loadOne));
    return Object.fromEntries(results);
  }

  // ═══════════════════════════════════════════════════════════════
  //  UTILIDADES DE COLOR
  // ═══════════════════════════════════════════════════════════════

  const _tintCache = new Map();

  function _hexToRgb(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    return { h: h / 6, s, l };
  }

  function _hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
      g: Math.round(hue2rgb(p, q, h)       * 255),
      b: Math.round(hue2rgb(p, q, h - 1/3) * 255),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  tintLayer v4.3.1
  //  Usado para MARCAS, TATUAJES y PINTURAS (tintable:true, eyeColor falsy).
  //  Pixel-by-pixel: preserva degradados y matices múltiples.
  // ═══════════════════════════════════════════════════════════════

  function tintLayer(img, color, cacheKey, w = DISPLAY_W, h = DISPLAY_H, frameCoords = null) {
    if (!color) return null;
    const fc  = frameCoords ? `${frameCoords.srcX}_${frameCoords.srcY}_${frameCoords.fw}_${frameCoords.fh}` : "full";
    const key = `tint2|${cacheKey}|${w}|${h}|${color}|${fc}`;

    if (_tintCache.has(key)) return _tintCache.get(key);
    if (_tintCache.size > 512) { const k = _tintCache.keys().next().value; _tintCache.delete(k); }

    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const ctx = off.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    if (!img || !img.complete || !img.naturalWidth) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      _tintCache.set(key, off);
      return off;
    }

    if (frameCoords) {
      ctx.drawImage(img, frameCoords.srcX, frameCoords.srcY, frameCoords.fw, frameCoords.fh, 0, 0, w, h);
    } else {
      ctx.drawImage(img, 0, 0, w, h);
    }

    try {
      const target = _hexToRgb(color);
      const { h: targetH, s: targetS } = _rgbToHsl(target.r, target.g, target.b);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data      = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 16) continue;
        const pr = data[i], pg = data[i + 1], pb = data[i + 2];
        const { h: origH, s: origS, l: origL } = _rgbToHsl(pr, pg, pb);
        if (origL < 0.14) continue;
        if (origL > 0.86) {
          if (targetS < 0.05) continue;
          const { r, g, b } = _hslToRgb(targetH, targetS * 0.18, origL * 0.97);
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
          continue;
        }
        if (origS < 0.12) {
          const { r, g, b } = _hslToRgb(targetH, targetS * 0.55, origL);
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
          continue;
        }
        const { r, g, b } = _hslToRgb(targetH, Math.min(1, origS * 0.4 + targetS * 0.6), origL);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }

      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      console.warn("[tintLayer] fallback:", e.message);
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = 0.5;
      ctx.fillStyle   = color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    _tintCache.set(key, off);
    return off;
  }

  function invalidateHairCache() { _tintCache.clear(); }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER HELPERS
  // ═══════════════════════════════════════════════════════════════

  function _drawLayerSprite(ctx, img, destX, destY, dw, dh, animator) {
    if (!img || !img.complete || !img.naturalWidth) return false;
    const sheet = isCompatibleSheet(img);
    ctx.imageSmoothingEnabled = !sheet;
    if (sheet && animator) {
      const { srcX, srcY, fw, fh } = animator.getFrameCoords(img);
      if (srcX + fw <= img.naturalWidth && srcY + fh <= img.naturalHeight) {
        ctx.drawImage(img, srcX, srcY, fw, fh, destX, destY, dw, dh);
        return true;
      }
    }
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, destX, destY, dw, dh);
    return true;
  }

  function _drawProceduralAura(ctx, screenX, screenY, dw, dh, auraEntry, color, phase) {
    if (!auraEntry || auraEntry.style === "none" || !color) return;
    const rgba = (hex, a) => {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `rgba(${r},${g},${b},${a})`;
    };
    const cx = screenX, cy = screenY - dh * 0.55;
    const grd = ctx.createRadialGradient(cx, cy, 4, cx, cy, dw * 0.9);
    grd.addColorStop(0, rgba(color, 0.28));
    grd.addColorStop(0.5, rgba(color, 0.10));
    grd.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(cx, cy, dw * 0.6, dh * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + phase * 0.05;
      const rad = dw * 0.28 + Math.sin(phase * 0.08 + i) * 6;
      const fx = cx + Math.cos(ang) * rad, fy = cy + Math.sin(ang) * rad * 0.5;
      const fh2 = 10 + Math.sin(phase * 0.1 + i * 0.8) * 5;
      ctx.fillStyle = rgba(color, 0.52);
      ctx.beginPath();
      ctx.moveTo(fx - 2, fy + 3);
      ctx.lineTo(fx, fy - fh2);
      ctx.lineTo(fx + 2, fy + 3);
      ctx.fill();
    }
  }

  /**
   * _tintSprite — multiply blend + destination-in.
   * Usado por tintHair y tintFaceColor.
   * Negro (#000000) → negro perfecto. Rojo → solo canal R. Blanco → sin cambio.
   */
  function _tintSprite(sheetImg, color, w, h, coords, fullImg, iw, ih) {
    const off = document.createElement("canvas"); off.width = w; off.height = h;
    const c = off.getContext("2d");
    c.imageSmoothingEnabled = false;

    if (sheetImg && coords) {
      c.drawImage(sheetImg, coords.srcX, coords.srcY, coords.fw || FRAME_W, coords.fh || FRAME_H, 0, 0, w, h);
    } else if (fullImg) {
      c.imageSmoothingEnabled = true;
      c.drawImage(fullImg, 0, 0, iw, ih, 0, 0, w, h);
    }

    c.globalCompositeOperation = "multiply";
    c.globalAlpha = 1;
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);

    c.globalCompositeOperation = "destination-in";
    c.globalAlpha = 1;
    if (sheetImg && coords) {
      c.imageSmoothingEnabled = false;
      c.drawImage(sheetImg, coords.srcX, coords.srcY, coords.fw || FRAME_W, coords.fh || FRAME_H, 0, 0, w, h);
    } else if (fullImg) {
      c.imageSmoothingEnabled = true;
      c.drawImage(fullImg, 0, 0, iw, ih, 0, 0, w, h);
    }

    c.globalCompositeOperation = "source-over";
    return off;
  }

  /**
   * tintHair v4.3.2 — multiply igual que la piel.
   */
  function tintHair(hairImg, hairColor, hairDef, w, h, frameCoords) {
    if (!hairImg || !hairImg.complete || !hairImg.naturalWidth) return null;
    const color = hairColor || "#1a1a1a";
    const fc    = frameCoords
      ? `${frameCoords.srcX}_${frameCoords.srcY}_${frameCoords.fw}_${frameCoords.fh}`
      : "full";
    const key = `hair2|${hairDef ? hairDef.id : "hair"}|${hairImg.src || ""}|${w}|${h}|${color}|${fc}`;

    if (_tintCache.has(key)) return _tintCache.get(key);
    if (_tintCache.size > 512) { const k = _tintCache.keys().next().value; _tintCache.delete(k); }

    const result = _tintSprite(
      frameCoords ? hairImg : null, color, w, h,
      frameCoords || null,
      !frameCoords ? hairImg : null,
      hairImg.naturalWidth, hairImg.naturalHeight
    );
    _tintCache.set(key, result);
    return result;
  }

  /**
   * tintFaceColor v4.3.3 — multiply para ojos con un solo color (eyeColor).
   * Fallback cuando browColor y pupilColor son null.
   */
  function tintFaceColor(faceImg, color, faceDef, w, h, frameCoords) {
    if (!faceImg || !faceImg.complete || !faceImg.naturalWidth) return null;
    const fc  = frameCoords
      ? `${frameCoords.srcX}_${frameCoords.srcY}_${frameCoords.fw}_${frameCoords.fh}`
      : "full";
    const key = `faceColor2|${faceDef ? faceDef.id : "face"}|${faceImg.src || ""}|${w}|${h}|${color}|${fc}`;

    if (_tintCache.has(key)) return _tintCache.get(key);
    if (_tintCache.size > 512) { const k = _tintCache.keys().next().value; _tintCache.delete(k); }

    const result = _tintSprite(
      frameCoords ? faceImg : null, color, w, h,
      frameCoords || null,
      !frameCoords ? faceImg : null,
      faceImg.naturalWidth, faceImg.naturalHeight
    );
    _tintCache.set(key, result);
    return result;
  }

  /**
   * tintFaceDetailed v1.0.2
   * Tiñe cejas y pupilas con DOS colores independientes en una sola pasada.
   *
   * REQUISITO DEL SPRITESHEET (faces con eyeColor:true):
   *   · Cejas    → ROJO PURO   (#ff0000, hue 0°)   en el .png
   *   · Pupilas  → AZUL PURO   (#0000ff, hue 240°) en el .png
   *   · Contornos → negro      (#000000) → no se toca (l < 0.12)
   *   · Esclerótica → blanco   (#ffffff) → no se toca (l > 0.88)
   *   · Sombras de piel → grises de baja saturación (s < 0.25) → no se tocan
   *
   * Si browColor y pupilColor son iguales se comporta igual que tintFaceColor
   * pero con detección por zona en lugar de multiply global.
   *
   * @param {HTMLImageElement} faceImg
   * @param {string}      browColor    - hex color destino para cejas
   * @param {string}      pupilColor   - hex color destino para pupilas
   * @param {object}      faceDef
   * @param {number}      w, h         - tamaño de salida
   * @param {object|null} frameCoords  - { srcX, srcY, fw, fh }
   */
  function tintFaceDetailed(faceImg, browColor, pupilColor, faceDef, w, h, frameCoords) {
    if (!faceImg || !faceImg.complete || !faceImg.naturalWidth) return null;

    const fc  = frameCoords
      ? `${frameCoords.srcX}_${frameCoords.srcY}_${frameCoords.fw}_${frameCoords.fh}`
      : "full";
    const key = `faceDetail|${faceDef ? faceDef.id : "face"}|${faceImg.src || ""}|${w}|${h}|${browColor}|${pupilColor}|${fc}`;

    if (_tintCache.has(key)) return _tintCache.get(key);
    if (_tintCache.size > 512) { const k = _tintCache.keys().next().value; _tintCache.delete(k); }

    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const ctx = off.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // Dibujar frame fuente
    if (frameCoords) {
      ctx.drawImage(
        faceImg,
        frameCoords.srcX, frameCoords.srcY, frameCoords.fw, frameCoords.fh,
        0, 0, w, h
      );
    } else {
      ctx.drawImage(faceImg, 0, 0, faceImg.naturalWidth, faceImg.naturalHeight, 0, 0, w, h);
    }

    // Pre-calcular HSL de los colores destino
    const browRgb  = _hexToRgb(browColor);
    const pupilRgb = _hexToRgb(pupilColor);
    const { h: browH,  s: browS  } = _rgbToHsl(browRgb.r,  browRgb.g,  browRgb.b);
    const { h: pupilH, s: pupilS } = _rgbToHsl(pupilRgb.r, pupilRgb.g, pupilRgb.b);

    try {
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 16) continue;

        const r = data[i], g = data[i + 1], b = data[i + 2];
        const { h: hue, s, l } = _rgbToHsl(r, g, b);

        // Preservar: contornos negros, esclerótica blanca, grises neutros de piel
        if (l < 0.12 || l > 0.88 || s < 0.25) continue;

        // Detectar zona por hue del píxel en el spritesheet:
        //   Rojo  → hue < 0.08 o hue > 0.92  → ceja
        //   Azul  → hue entre 0.55 y 0.72     → pupila/iris
        const isBrow  = (hue < 0.08 || hue > 0.92);
        const isPupil = (hue >= 0.55 && hue <= 0.72);

        if (isBrow) {
          // Hue-replace conservando luminosidad original del píxel
          const { r: nr, g: ng, b: nb } = _hslToRgb(browH, browS, l);
          data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
        } else if (isPupil) {
          const { r: nr, g: ng, b: nb } = _hslToRgb(pupilH, pupilS, l);
          data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
        }
        // Cualquier otro color saturado (verde, amarillo, etc.) → se deja intacto
      }

      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      console.warn("[tintFaceDetailed] error:", e.message);
    }

    _tintCache.set(key, off);
    return off;
  }

  // ═══════════════════════════════════════════════════════════════
  //  drawPlayer — orden de capas v1.0.2
  // ═══════════════════════════════════════════════════════════════

  function drawPlayer(ctx, screenX, screenY, playerObj, imageMap, animator, charState) {
    const p   = playerObj || player;
    const app = p.appearance;
    const dir = p.direction || 1;
    const gender = app.gender || "male";
    const raceId = app.raceId || "human";
    const raceDef = RACE_CATALOG.find((r) => r.id === raceId) || RACE_CATALOG[0];

    const viewKey = charState && charState.viewKey;
    if (animator && viewKey && VIEW_META[viewKey]) animator.setView(viewKey);
    else if (animator && !viewKey && animator.currentView) animator.clearView();

    const faceCatalog = getCatalogFor("face",   raceId, gender);
    const hairCatalog = getCatalogFor("hair",   raceId, gender);
    const topCatalog  = getCatalogFor("shirt",  raceId, gender);
    const btmCatalog  = getCatalogFor("pants",  raceId, gender);
    const shoeCatalog = getCatalogFor("shoes",  raceId, gender);
    const glvCatalog  = getCatalogFor("gloves", raceId, gender);

    const faceDef   = faceCatalog.find((f) => f.id === app.faceId)   || faceCatalog[0];
    const hairDef   = hairCatalog.find((h) => h.id === app.hairId)   || hairCatalog[0];
    const topDef    = topCatalog.find((t)  => t.id === app.topId)    || topCatalog[0];
    const btmDef    = btmCatalog.find((b)  => b.id === app.bottomId) || btmCatalog[0];
    const shoesDef  = shoeCatalog.find((s) => s.id === app.shoesId)  || shoeCatalog[0];
    const glovesId  = app.glovesId || (charState && charState.glovesId) || glvCatalog[0].id;
    const glovesDef = glvCatalog.find((g) => g.id === glovesId) || glvCatalog[0];

    const auraId    = app.auraId    || (charState && charState.auraId)    || "a0";
    const auraColor = app.auraColor || (charState && charState.auraColor) || "#fdd835";
    const auraPhase = (charState && charState.auraPhase) || 0;
    const auraDef   = AURAS_CATALOG.find((a) => a.id === auraId) || AURAS_CATALOG[0];

    const accessoryId = app.accessoryId || (charState && charState.accessoryId) || "ac_none";
    const accDef      = ACCESSORIES_CATALOG.find((a) => a.id === accessoryId) || ACCESSORIES_CATALOG[0];
    const accImg      = accDef ? accDef.userImage : null;
    const accSlot     = accDef ? accDef.slot : "over_shirt";

    const bodyGender = raceDef.genderless ? "male" : gender;
    const bodyImg    = imageMap ? imageMap[`${raceDef.id}_${bodyGender}`] || null : null;

    const dw = DISPLAY_W, dh = DISPLAY_H;
    const destX = screenX - dw / 2, destY = screenY - dh;

    ctx.save();
    if (dir === -1) { ctx.translate(screenX * 2, 0); ctx.scale(-1, 1); }

    // 1. AURA
    const auraImg = imageMap ? imageMap[auraDef.spriteKey] || null : null;
    if (auraImg && auraImg.complete && auraImg.naturalWidth) {
      const aw = dw * 1.8, ah = dh * 1.2;
      const auraSheet = isCompatibleSheet(auraImg);
      ctx.globalAlpha = 0.65;
      if (auraSheet && animator) {
        const { srcX, srcY, fw, fh } = animator.getFrameCoords(auraImg);
        ctx.imageSmoothingEnabled = false;
        if (srcX + fw <= auraImg.naturalWidth && srcY + fh <= auraImg.naturalHeight) {
          ctx.drawImage(auraImg, srcX, srcY, fw, fh, screenX - aw / 2, destY - ah * 0.1, aw, ah);
        } else {
          ctx.drawImage(auraImg, 0, 0, auraImg.naturalWidth, auraImg.naturalHeight, screenX - aw / 2, destY - ah * 0.1, aw, ah);
        }
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(auraImg, screenX - aw / 2, destY - ah * 0.1, aw, ah);
      }
      ctx.globalAlpha = 1;
    } else {
      _drawProceduralAura(ctx, screenX, screenY, dw, dh, auraDef, auraColor, auraPhase);
    }

    // 2. ACCESORIO under_shirt
    if (accSlot === "under_shirt" && accImg && accImg.complete && accImg.naturalWidth) {
      _drawLayerSprite(ctx, accImg, destX, destY, dw, dh, animator);
    }

    // 3. CUERPO con tinte de piel
    if (bodyImg && bodyImg.complete && bodyImg.naturalWidth) {
      const sheet = isCompatibleSheet(bodyImg);
      ctx.imageSmoothingEnabled = !sheet;
      if (app.skinColor) {
        const coords = sheet && animator ? animator.getFrameCoords(bodyImg) : null;
        const tinted = _tintSprite(
          sheet ? bodyImg : null, app.skinColor, dw, dh,
          coords, !sheet ? bodyImg : null, bodyImg.naturalWidth, bodyImg.naturalHeight
        );
        ctx.drawImage(tinted, destX, destY, dw, dh);
      } else {
        _drawLayerSprite(ctx, bodyImg, destX, destY, dw, dh, animator);
      }
    }

    // 4. ROPA INFERIOR
    _drawLayerSprite(ctx, imageMap?.[btmDef?.spriteKey]    || null, destX, destY, dw, dh, animator);

    // 5. CALZADO
    _drawLayerSprite(ctx, imageMap?.[shoesDef?.spriteKey]  || null, destX, destY, dw, dh, animator);

    // 6. CINTURÓN belt_slot
    if (accSlot === "belt_slot" && accImg && accImg.complete && accImg.naturalWidth) {
      _drawLayerSprite(ctx, accImg, destX, destY, dw, dh, animator);
    }

    // 7. ROPA SUPERIOR
    _drawLayerSprite(ctx, imageMap?.[topDef?.spriteKey]    || null, destX, destY, dw, dh, animator);

    // 8. GUANTES
    _drawLayerSprite(ctx, imageMap?.[glovesDef?.spriteKey] || null, destX, destY, dw, dh, animator);

    // 9. CARA
    //
    //  Árbol de decisión (v1.0.2):
    //
    //  tintable:false
    //    └── dibujar sin tinte (_drawLayerSprite)
    //
    //  tintable:true, eyeColor:false
    //    └── tintLayer (pixel-by-pixel, preserva degradados)
    //        color = app.faceColor
    //
    //  tintable:true, eyeColor:true
    //    ├── browColor o pupilColor definidos
    //    │     └── tintFaceDetailed (cejas=browColor, pupilas=pupilColor)
    //    │         REQUIERE spritesheet con cejas en rojo y pupilas en azul
    //    └── solo eyeColor
    //          └── tintFaceColor (multiply global, igual que cabello)
    //              color = app.eyeColor
    const faceImg = imageMap ? imageMap[faceDef?.spriteKey] || null : null;
    if (faceImg && faceImg.complete && faceImg.naturalWidth) {

      if (faceDef && faceDef.tintable) {

        // Calcular frameCoords una sola vez
        const faceSheet = isCompatibleSheet(faceImg);
        let frameCoords = null;
        if (faceSheet && animator) {
          const { srcX, srcY, fw, fh } = animator.getFrameCoords(faceImg);
          if (srcX + fw <= faceImg.naturalWidth && srcY + fh <= faceImg.naturalHeight) {
            frameCoords = { srcX, srcY, fw, fh };
          }
        }

        if (faceDef.eyeColor) {
          // --- Ojos ---
          const browColor  = app.browColor  || null;
          const pupilColor = app.pupilColor || null;
          const eyeColor   = app.eyeColor   || null;

          let tinted = null;

          if (browColor || pupilColor) {
            // Modo detallado: cejas y pupilas con colores independientes
            tinted = tintFaceDetailed(
              faceImg,
              browColor  || eyeColor || "#1a1a1a",
              pupilColor || eyeColor || "#1a1a1a",
              faceDef, dw, dh, frameCoords
            );
          } else if (eyeColor) {
            // Modo simple: un solo color para toda la capa (multiply)
            tinted = tintFaceColor(faceImg, eyeColor, faceDef, dw, dh, frameCoords);
          }

          if (tinted) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tinted, destX, destY, dw, dh);
          } else {
            _drawLayerSprite(ctx, faceImg, destX, destY, dw, dh, animator);
          }

        } else {
          // --- Marcas, tatuajes, pinturas, barbas ---
          const faceColor = app.faceColor || null;
          if (faceColor) {
            const cacheKey = (faceDef.id || "face") + "|" + (faceImg.src || "");
            const tinted = tintLayer(faceImg, faceColor, cacheKey, dw, dh, frameCoords);
            if (tinted) {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(tinted, destX, destY, dw, dh);
            } else {
              _drawLayerSprite(ctx, faceImg, destX, destY, dw, dh, animator);
            }
          } else {
            _drawLayerSprite(ctx, faceImg, destX, destY, dw, dh, animator);
          }
        }

      } else {
        // tintable:false → dibujar sin tinte
        _drawLayerSprite(ctx, faceImg, destX, destY, dw, dh, animator);
      }
    }

    // 10. CABELLO — tintHair v4.3.2 (multiply)
    const hairImg = imageMap ? imageMap[hairDef?.spriteKey] || null : null;
    if (hairImg && hairImg.complete && hairImg.naturalWidth) {
      const sheet = isCompatibleSheet(hairImg) && animator;
      const coords = sheet ? (() => {
        const { srcX, srcY, fw, fh } = animator.getFrameCoords(hairImg);
        if (srcX + fw <= hairImg.naturalWidth && srcY + fh <= hairImg.naturalHeight)
          return { srcX, srcY, fw, fh };
        return null;
      })() : null;

      const tinted = tintHair(hairImg, app.hairColor || "#1a1a1a", hairDef, dw, dh, coords);
      if (tinted) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tinted, destX, destY, dw, dh);
      }
    }

    // 11. ACCESORIO over_shirt
    if (accSlot === "over_shirt" && accImg && accImg.complete && accImg.naturalWidth) {
      _drawLayerSprite(ctx, accImg, destX, destY, dw, dh, animator);
    }

    ctx.restore();
  }

  // ═══════════════════════════════════════════════════════════════
  //  UTILIDADES
  // ═══════════════════════════════════════════════════════════════

  function getById(catalog, id)           { return catalog.find((e) => e.id === id) || catalog[0]; }

  function cycleId(catalog, currentId, delta = 1) {
    const idx  = catalog.findIndex((e) => e.id === currentId);
    const next = ((idx === -1 ? 0 : idx) + delta + catalog.length) % catalog.length;
    return catalog[next].id;
  }

  function initPlayer(overrides = {}) {
    Object.assign(player, overrides);
    player._animator = new SpriteAnimator("idle");
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXPORT
  // ═══════════════════════════════════════════════════════════════

  const CharacterSystem = {
    player,
    RACE_CATALOG,
    AURAS_CATALOG,
    ACCESSORIES_CATALOG,
    ACCESSORY_TYPES,
    addUserAccessory,
    removeUserAccessory,
    restoreUserAccessories,

    FACE_CATALOG_MALE, FACE_CATALOG_FEMALE, FACE_CATALOG_NAMEKIAN, FACE_CATALOG_FRIEZA,
    FACE_CATALOG,

    HAIR_CATALOG_MALE,   HAIR_CATALOG_FEMALE,   HAIR_CATALOG_NAMEKIAN,   HAIR_CATALOG_FRIEZA,
    TOP_CATALOG_MALE,    TOP_CATALOG_FEMALE,    TOP_CATALOG_NAMEKIAN,    TOP_CATALOG_FRIEZA,
    BOTTOM_CATALOG_MALE, BOTTOM_CATALOG_FEMALE, BOTTOM_CATALOG_NAMEKIAN, BOTTOM_CATALOG_FRIEZA,
    SHOES_CATALOG_MALE,  SHOES_CATALOG_FEMALE,  SHOES_CATALOG_NAMEKIAN,  SHOES_CATALOG_FRIEZA,
    GLOVES_CATALOG_MALE, GLOVES_CATALOG_FEMALE, GLOVES_CATALOG_NAMEKIAN, GLOVES_CATALOG_FRIEZA,

    HAIR_CATALOG, TOP_CATALOG, BOTTOM_CATALOG, SHOES_CATALOG, GLOVES_CATALOG,

    getCatalogFor, getDefaultIds, GENDERLESS_RACES,

    SPRITE_IMAGES,

    ACTIONS_META, ACTIONS_META_MALE, ACTIONS_META_FEMALE, VIEW_META,

    HAIR_VIEW_META,    HAIR_ACTIONS_META,
    FACE_VIEW_META,    FACE_ACTIONS_META,
    TOP_VIEW_META,     TOP_ACTIONS_META,
    BOTTOM_VIEW_META,  BOTTOM_ACTIONS_META,
    SHOES_VIEW_META,   SHOES_ACTIONS_META,
    GLOVES_VIEW_META,  GLOVES_ACTIONS_META,
    AURA_VIEW_META,    AURA_ACTIONS_META,

    FRAME_W, FRAME_H, DISPLAY_W, DISPLAY_H, MAX_COLS, TOTAL_ROWS, IDLE_ROW,

    SpriteAnimator, initPlayer, preloadAssets, drawPlayer,

    tintHair, tintLayer, tintFaceColor, tintFaceDetailed, invalidateHairCache,
    _hexToRgb, _rgbToHsl, _hslToRgb,
    _tintSprite,

    detectFrameSize, getFrameSize, isCompatibleSheet, getIdleFrameCoords,

    getById, cycleId,

    getActionsMeta, getViewMeta,
    getHairViewMeta,   getHairActionsMeta,
    getFaceViewMeta,   getFaceActionsMeta,
    getTopViewMeta,    getTopActionsMeta,
    getBottomViewMeta, getBottomActionsMeta,
    getShoesViewMeta,  getShoesActionsMeta,
    getGlovesViewMeta, getGlovesActionsMeta,
    getAuraViewMeta,   getAuraActionsMeta,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CharacterSystem;
  else if (typeof window !== "undefined") window.CharacterSystem = CharacterSystem;

})();