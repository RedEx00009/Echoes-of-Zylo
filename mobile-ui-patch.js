/**
 * DRAGON WORLD Z — mobile-ui-patch.js  v4
 * Agregar al final de <body> tras systems-patch.js
 *
 * Fixes móvil:
 *  - Muestra botones Combate / Hablar / Volar en el action-grid
 *  - Mueve CORRER debajo del joystick
 *  - NPCs y Raids: botón en menú hamburguesa abre panel con scroll ▲▼
 *  - Objetos Mundo: igual
 *  - Chat RPG: expandible, emociones en grilla grande, scroll ▲▼
 *  - NO toca lógica del juego
 */
(function () {
  "use strict";

  var isTouch = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;
  if (!isTouch) return;

  /* ══════════════════════════════════════════════════
     1. REORGANIZAR CONTROLES INFERIORES
     ═════════════════════════════════════════════════ */
  function reorganizeControls() {
    var grid    = document.getElementById("actionGrid");
    var runBtn  = document.getElementById("mobileRunBtn");
    var joyWrap = document.getElementById("joystickWrap");
    var joyCol  = document.querySelector(".joystick-col");

    // Mover CORRER debajo del joystick
    if (runBtn && joyWrap && joyCol) {
      joyWrap.insertAdjacentElement("afterend", runBtn);
    }

    // Asegurarse de que el grid tenga los 3 botones de acción visibles
    if (grid) {
      var order = ["mobileCombatBtn", "mobileTalkBtn", "mobileFlyBtn"];
      var frag  = document.createDocumentFragment();
      order.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
          el.style.display = "";
          frag.appendChild(el);
        }
      });
      grid.innerHTML = "";
      grid.appendChild(frag);
      grid.style.display = "flex";
      grid.style.flexDirection = "column";
      grid.style.gap = "8px";
      grid.style.pointerEvents = "auto";
    }

    // Ocultar el mobileActionCorner (usamos el grid)
    var corner = document.getElementById("mobileActionCorner");
    if (corner) corner.style.display = "none";
  }

  /* ══════════════════════════════════════════════════
     2. HELPER: crear botones de scroll para un panel
     ═════════════════════════════════════════════════ */
  function createScrollButtons(containerId, wrapperId) {
    var wrapper = document.createElement("div");
    wrapper.id = wrapperId;
    wrapper.className = "panel-scroll-btns-wrap";
    wrapper.style.cssText = [
      "position:fixed",
      "right:10px",
      "top:50%",
      "transform:translateY(-50%)",
      "display:none",
      "flex-direction:column",
      "gap:6px",
      "z-index:1000",
      "pointer-events:auto"
    ].join(";");

    var btnUp = document.createElement("button");
    btnUp.className = "panel-scroll-btn";
    btnUp.textContent = "▲";
    btnUp.style.cssText = "width:32px;height:52px;background:var(--ui-bg,rgba(8,9,15,.92));border:1px solid #2a3560;border-radius:8px;color:#f5c400;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;backdrop-filter:blur(8px);";

    var btnDn = document.createElement("button");
    btnDn.className = "panel-scroll-btn";
    btnDn.textContent = "▼";
    btnDn.style.cssText = btnUp.style.cssText;

    wrapper.appendChild(btnUp);
    wrapper.appendChild(btnDn);
    document.body.appendChild(wrapper);

    // Scroll logic
    var STEP = 120, _iv = null;
    function startScroll(dir) {
      var container = document.getElementById(containerId);
      if (container) container.scrollTop += dir * STEP;
      _iv = setInterval(function() {
        var c = document.getElementById(containerId);
        if (c) c.scrollTop += dir * STEP;
      }, 80);
    }
    function stopScroll() { clearInterval(_iv); _iv = null; }

    btnUp.addEventListener("mousedown",  function(e){ e.stopPropagation(); startScroll(-1); });
    btnDn.addEventListener("mousedown",  function(e){ e.stopPropagation(); startScroll(1);  });
    document.addEventListener("mouseup", stopScroll);
    [btnUp, btnDn].forEach(function(btn) {
      btn.addEventListener("touchstart",  function(e){ e.stopPropagation(); e.preventDefault(); startScroll(btn===btnUp?-1:1); }, {passive:false});
      btn.addEventListener("touchend",    function(e){ e.stopPropagation(); stopScroll(); }, {passive:false});
      btn.addEventListener("touchcancel", function(e){ e.stopPropagation(); stopScroll(); }, {passive:false});
    });

    return wrapper;
  }

  /* ══════════════════════════════════════════════════
     3. PANELES woPanel y npcPanel con scroll ▲▼
        y cierre con botón X al abrir desde menú
     ═════════════════════════════════════════════════ */
  function setupOverlayPanel(panelId, scrollWrapperId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;

    // Botones scroll
    var scrollWrap = createScrollButtons(panelId, scrollWrapperId);

    // Botón cerrar (X) en mobile, si no existe
    if (!panel.querySelector(".mobile-panel-close")) {
      var closeBtn = document.createElement("button");
      closeBtn.className = "mobile-panel-close";
      closeBtn.innerHTML = "✕";
      closeBtn.style.cssText = [
        "position:absolute",
        "top:10px",
        "right:10px",
        "z-index:10",
        "background:rgba(255,255,255,.08)",
        "border:1px solid rgba(255,255,255,.18)",
        "border-radius:6px",
        "color:#8892b0",
        "width:32px",
        "height:32px",
        "font-size:14px",
        "cursor:pointer",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "touch-action:manipulation"
      ].join(";");
      closeBtn.onclick = function() { closeMobilePanel(panelId, scrollWrap); };
      // Asegurar que el panel tenga position relative para el botón absoluto
      if (getComputedStyle(panel).position === "static") {
        panel.style.position = "fixed";
      }
      panel.appendChild(closeBtn);
    }

    // Forzar estilos para overlay centrado
    panel.style.cssText += [
      ";position:fixed",
      "top:50%",
      "left:8px",
      "right:8px",
      "transform:translateY(-50%)",
      "width:auto",
      "max-height:72vh",
      "overflow-y:auto",
      "z-index:999",
      "display:none"
    ].join(";");

    // Observar cuando el panel se abre/cierra para mostrar/ocultar scroll btns
    var observer = new MutationObserver(function() {
      var isOpen = panel.classList.contains("open") || panel.style.display !== "none";
      scrollWrap.style.display = isOpen ? "flex" : "none";
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class","style"] });
  }

  function closeMobilePanel(panelId, scrollWrap) {
    var panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove("open");
      panel.style.display = "none";
    }
    if (scrollWrap) scrollWrap.style.display = "none";
  }

  /* ══════════════════════════════════════════════════
     4. PATCH DEL MENÚ: abrir woPanel y npcPanel
        correctamente en mobile
     ═════════════════════════════════════════════════ */
  function patchMenuButtons() {
    // Patch botón Objetos Mundo
    var menuBtns = document.querySelectorAll(".menu-btn");
    menuBtns.forEach(function(btn) {
      var txt = btn.textContent || "";

      if (txt.indexOf("OBJETOS MUNDO") !== -1 || txt.indexOf("OBJETOS") !== -1 && txt.indexOf("MUNDO") !== -1) {
        btn.onclick = function(e) {
          e.stopPropagation();
          if (window.WorldObjectsSystem) {
            // Abrir el panel
            var woPanel = document.getElementById("woPanel");
            if (woPanel) {
              var isOpen = woPanel.classList.contains("open") || woPanel.style.display === "flex";
              if (!isOpen) {
                WorldObjectsSystem.toggleUI();
                // Forzar visibilidad mobile
                setTimeout(function() {
                  woPanel.style.display = "flex";
                  woPanel.classList.add("open");
                }, 50);
              } else {
                WorldObjectsSystem.toggleUI();
                woPanel.style.display = "none";
                woPanel.classList.remove("open");
              }
            } else {
              WorldObjectsSystem.toggleUI();
            }
          }
          if (window.closeMenu) closeMenu();
        };
      }

      if (txt.indexOf("GESTIONAR") !== -1 && txt.indexOf("NPC") !== -1) {
        btn.onclick = function(e) {
          e.stopPropagation();
          if (window.NpcSystem) {
            var npcPanel = document.getElementById("npcPanel");
            if (npcPanel) {
              var isOpen = npcPanel.classList.contains("open") || npcPanel.style.display === "flex";
              if (!isOpen) {
                NpcSystem.togglePanel();
                setTimeout(function() {
                  npcPanel.style.display = "flex";
                  npcPanel.classList.add("open");
                  // Activar tab activos
                  var btn2 = npcPanel.querySelector(".npc-tab:nth-child(2)");
                  if (btn2 && NpcSystem.switchTab) NpcSystem.switchTab("active", btn2);
                }, 50);
              } else {
                NpcSystem.togglePanel();
                npcPanel.style.display = "none";
                npcPanel.classList.remove("open");
              }
            } else {
              NpcSystem.togglePanel();
            }
          }
          if (window.closeMenu) closeMenu();
        };
      }

      // Botón Chat RPG en el menú (si existe)
      if (txt.indexOf("CHAT RPG") !== -1 || txt.indexOf("RPG") !== -1 && txt.indexOf("CHAT") !== -1) {
        btn.onclick = function(e) {
          e.stopPropagation();
          if (window.RpgChatSystem) RpgChatSystem.toggle();
          if (window.closeMenu) closeMenu();
        };
      }
    });
  }

  /* ══════════════════════════════════════════════════
     5. CHAT RPG: scroll ▲▼ y emotion picker mejorado
     ═════════════════════════════════════════════════ */
  function setupRpgChat() {
    // Esperar a que el panel exista
    var panel = document.getElementById("rpgChatPanel");
    if (!panel) return;

    // Crear scroll buttons para el chat
    var scrollWrap = document.createElement("div");
    scrollWrap.id = "rpgChatScrollBtns";
    scrollWrap.style.cssText = [
      "position:fixed",
      "right:10px",
      "bottom:260px",
      "display:none",
      "flex-direction:column",
      "gap:6px",
      "z-index:31",
      "pointer-events:auto"
    ].join(";");

    var btnUp = document.createElement("button");
    btnUp.textContent = "▲";
    btnUp.style.cssText = "width:32px;height:52px;background:var(--ui-bg,rgba(8,9,15,.92));border:1px solid #2a3560;border-radius:8px;color:#f5c400;font-size:16px;cursor:pointer;touch-action:manipulation;backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;";
    var btnDn = document.createElement("button");
    btnDn.textContent = "▼";
    btnDn.style.cssText = btnUp.style.cssText;

    scrollWrap.appendChild(btnUp);
    scrollWrap.appendChild(btnDn);
    document.body.appendChild(scrollWrap);

    var STEP = 100, _iv = null;
    function startScroll(dir) {
      var msgs = document.getElementById("rpgChatMessages");
      if (msgs) msgs.scrollTop += dir * STEP;
      _iv = setInterval(function() {
        var m = document.getElementById("rpgChatMessages");
        if (m) m.scrollTop += dir * STEP;
      }, 80);
    }
    function stopScroll() { clearInterval(_iv); _iv = null; }
    btnUp.addEventListener("mousedown",  function(e){ e.stopPropagation(); startScroll(-1); });
    btnDn.addEventListener("mousedown",  function(e){ e.stopPropagation(); startScroll(1);  });
    document.addEventListener("mouseup", stopScroll);
    [btnUp, btnDn].forEach(function(btn) {
      btn.addEventListener("touchstart",  function(e){ e.stopPropagation(); e.preventDefault(); startScroll(btn===btnUp?-1:1); }, {passive:false});
      btn.addEventListener("touchend",    function(e){ e.stopPropagation(); stopScroll(); }, {passive:false});
      btn.addEventListener("touchcancel", function(e){ e.stopPropagation(); stopScroll(); }, {passive:false});
    });

    // Mostrar/ocultar scroll según estado open
    var observer = new MutationObserver(function() {
      var isOpen = panel.classList.contains("open");
      scrollWrap.style.display = isOpen ? "flex" : "none";
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });

    // Posicionar el emotion picker arriba del chat en mobile
    var emPicker = document.getElementById("rpgEmPicker");
    var emBtn    = document.getElementById("rpgEmotionBtn");
    if (emPicker && emBtn) {
      emBtn.onclick = function(e) {
        e.stopPropagation();
        // Reposicionar el picker encima del panel
        var rect = panel.getBoundingClientRect();
        emPicker.style.bottom = (window.innerHeight - rect.top + 6) + "px";
        if (window.RpgChatSystem) {
          RpgChatSystem.toggleEmPicker();
        }
      };
    }

    // Cerrar emotion picker al tocar fuera
    document.addEventListener("touchstart", function(e) {
      var ep = document.getElementById("rpgEmPicker");
      if (ep && ep.classList.contains("open")) {
        if (!ep.contains(e.target) && e.target !== emBtn) {
          if (window.RpgChatSystem) RpgChatSystem.toggleEmPicker(false);
        }
      }
    }, { passive: true });

    // Agregar botón "CHAT RPG" al menú hamburguesa si no existe
    addRpgChatToMenu();
  }

  function addRpgChatToMenu() {
    var menu = document.getElementById("leftMenu");
    if (!menu) return;
    // Verificar si ya hay botón de chat RPG
    var existingBtns = menu.querySelectorAll(".menu-btn");
    var hasRpg = false;
    existingBtns.forEach(function(b) {
      if ((b.textContent||"").indexOf("CHAT RPG") !== -1) hasRpg = true;
    });
    if (hasRpg) return;

    var section = document.createElement("div");
    section.className = "menu-section";
    section.innerHTML = [
      '<div class="menu-section-label">Chat</div>',
      '<button class="menu-btn" onclick="if(window.RpgChatSystem)RpgChatSystem.toggle();closeMenu()">',
      '<span class="btn-ic">💬</span> CHAT RPG',
      '</button>'
    ].join("");
    // Insertar antes de la sección de cámara
    var camSection = null;
    menu.querySelectorAll(".menu-section-label").forEach(function(lbl) {
      if ((lbl.textContent||"").toLowerCase().indexOf("cámara") !== -1 || (lbl.textContent||"").toLowerCase().indexOf("camara") !== -1) {
        camSection = lbl.parentElement;
      }
    });
    if (camSection) {
      menu.insertBefore(section, camSection);
    } else {
      menu.appendChild(section);
    }
  }

  /* ══════════════════════════════════════════════════
     6. INICIALIZAR TODO
     ═════════════════════════════════════════════════ */
  function init() {
    reorganizeControls();
    setupOverlayPanel("woPanel",  "woPanelScrollBtns");
    setupOverlayPanel("npcPanel", "npcPanelScrollBtns");

    // El Chat RPG se inyecta con delay (systems-patch.js lo crea dinámicamente)
    var tries = 0;
    var tryRpg = setInterval(function() {
      tries++;
      var panel = document.getElementById("rpgChatPanel");
      if (panel) {
        clearInterval(tryRpg);
        setupRpgChat();
      }
      if (tries > 40) clearInterval(tryRpg); // Máximo 4 segundos
    }, 100);

    // Parchear botones del menú
    var tries2 = 0;
    var tryMenu = setInterval(function() {
      tries2++;
      var menu = document.getElementById("leftMenu");
      if (menu && menu.querySelectorAll(".menu-btn").length > 2) {
        clearInterval(tryMenu);
        patchMenuButtons();
      }
      if (tries2 > 30) { clearInterval(tryMenu); patchMenuButtons(); }
    }, 150);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();