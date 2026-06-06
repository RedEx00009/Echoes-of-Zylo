/**
 * DRAGON WORLD Z — mobile-ui-patch.js  v3
 * Agregar al final de <body> tras systems-patch.js
 *
 * Solo hace cambios visuales en mobile:
 *  - Mueve el botón CORRER debajo del joystick
 *  - Limpia el action-grid (deja Combate / Hablar / Volar en columna)
 *  - NO toca lógica del juego
 */
(function () {
  "use strict";

  var isTouch = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;
  if (!isTouch) return;

  function init() {
    reorganizeControls();
  }

  function reorganizeControls() {
    var grid   = document.getElementById("actionGrid");
    var runBtn = document.getElementById("mobileRunBtn");
    var joyWrap = document.getElementById("joystickWrap");
    var joyCol  = document.querySelector(".joystick-col");

    /* Mover CORRER debajo del joystick */
    if (runBtn && joyWrap && joyCol) {
      joyWrap.insertAdjacentElement("afterend", runBtn);
    }

    /* Reordenar el grid: Combate → Hablar → Volar */
    if (grid) {
      var order = ["mobileCombatBtn", "mobileTalkBtn", "mobileFlyBtn"];
      var frag  = document.createDocumentFragment();
      order.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) frag.appendChild(el);
      });
      grid.innerHTML = "";
      grid.appendChild(frag);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
