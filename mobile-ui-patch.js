/**
 * DRAGON WORLD Z — mobile-ui-patch.js
 * Incluir al FINAL de <body>, después de todos los demás scripts.
 *
 * Qué hace:
 *  - En mobile, reordena los botones de acción para que queden
 *    en columna vertical (Combate / Hablar / Volar) a la derecha
 *  - Oculta el botón CORRER de la acción-grid y lo mueve debajo del joystick
 *  - Esconde el botón TRANS del joystick-col y pone un botón circular pequeño
 *  - Sincroniza el estado de los botones con las funciones existentes del juego
 */

(function () {
  "use strict";

  const isTouch = window.matchMedia("(pointer: coarse)").matches ||
                  window.innerWidth <= 768;
  if (!isTouch) return; // No hacer nada en PC

  /* ── Esperar a que el DOM esté listo ── */
  function init() {
    reorganizeActionGrid();
    moveRunBtnBelowJoystick();
    makeTransBtnCompact();
    fixActionGridLayout();
  }

  /* ─────────────────────────────────────────
   *  Reorganiza el action-grid en columna
   * ───────────────────────────────────────── */
  function reorganizeActionGrid() {
    const grid = document.getElementById("actionGrid");
    if (!grid) return;

    // Quitar el botón CORRER del grid — se mueve abajo del joystick
    const runBtn = document.getElementById("mobileRunBtn");
    if (runBtn && runBtn.parentElement === grid) {
      grid.removeChild(runBtn);
    }

    // El grid queda: Combate | Hablar | Volar (3 botones en columna)
    // El CSS ya lo convierte en flex-column, no hace falta más JS
  }

  /* ─────────────────────────────────────────
   *  Mueve el botón CORRER debajo del joystick
   * ───────────────────────────────────────── */
  function moveRunBelowJoystick() {
    const runBtn  = document.getElementById("mobileRunBtn");
    const joyCol  = document.querySelector(".joystick-col");
    const joyWrap = document.getElementById("joystickWrap");
    if (!runBtn || !joyCol || !joyWrap) return;

    // Insertar debajo del joystick
    joyWrap.insertAdjacentElement("afterend", runBtn);
  }
  function moveRunBtnBelowJoystick() { moveRunBelowJoystick(); }

  /* ─────────────────────────────────────────
   *  Botón TRANS — circular pequeño encima del joystick
   * ───────────────────────────────────────── */
  function makeTransBtnCompact() {
    const transBtn = document.getElementById("mobileTransBtn");
    if (!transBtn) return;
    // Ya está en joystick-col; el CSS lo reduce a 44px circular
    // Solo aseguramos que el label esté oculto por CSS (ya en el .css)
  }

  /* ─────────────────────────────────────────
   *  Asegurar que el action-grid tenga los 3 botones correctos
   *  y en el orden adecuado
   * ───────────────────────────────────────── */
  function fixActionGridLayout() {
    const grid = document.getElementById("actionGrid");
    if (!grid) return;

    // Orden deseado: combate, hablar, volar
    const order = ["mobileCombatBtn", "mobileTalkBtn", "mobileFlyBtn"];
    const fragment = document.createDocumentFragment();
    order.forEach(id => {
      const el = document.getElementById(id);
      if (el) fragment.appendChild(el);
    });
    grid.innerHTML = "";
    grid.appendChild(fragment);
  }

  /* ─────────────────────────────────────────
   *  Mini barra de estado en la parte superior
   *  Muestra bando e integridad en forma compacta
   *  (reemplaza el world-status que ocultamos)
   * ───────────────────────────────────────── */
  function injectMiniStatusBar() {
    // Crear barra compacta pegada al HUD superior
    const bar = document.createElement("div");
    bar.id = "mobileStatusBar";
    bar.style.cssText = `
      position: fixed;
      top: 8px;
      right: 84px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      pointer-events: none;
    `;

    // Chip de bando — copia el texto del original
    const factionOrig = document.getElementById("factionText");
    const integrityOrig = document.getElementById("integrityText");

    if (factionOrig) {
      const chip = document.createElement("div");
      chip.style.cssText = `
        font-family: 'Orbitron', monospace;
        font-size: 7px;
        letter-spacing: 1px;
        color: #f5c400;
        background: rgba(8,9,15,0.75);
        border: 1px solid rgba(42,53,96,0.8);
        border-radius: 4px;
        padding: 2px 6px;
        white-space: nowrap;
        max-width: 110px;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      chip.id = "mobileFactionChip";
      // Sincronizar texto con el original
      const sync = () => { chip.textContent = factionOrig.textContent; };
      sync();
      new MutationObserver(sync).observe(factionOrig, { childList: true, subtree: true, characterData: true });
      bar.appendChild(chip);
    }

    document.body.appendChild(bar);
  }

  /* ─────────────────────────────────────────
   *  Ejecutar todo
   * ───────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { init(); setTimeout(injectMiniStatusBar, 800); });
  } else {
    init();
    setTimeout(injectMiniStatusBar, 800);
  }

})();
