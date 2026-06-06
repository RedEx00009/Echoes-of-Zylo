/**
 * DRAGON WORLD Z — mobile-ui-patch.js  v6
 * Solo mobile (pointer:coarse / ancho ≤768px).
 *
 * - #mobileRightBtns: columna Combate / Hablar / Volar / Correr a la DERECHA
 * - Joystick queda a la IZQUIERDA (layout natural del HTML)
 * - #uiToggleBtn: botón central inferior para ocultar/mostrar toda la UI
 * - NPCs / Objetos Mundo: overlay centrado con ▲▼ y botón X
 * - Chat RPG: expandible, emotion picker en grilla, scroll ▲▼
 */
(function () {
  "use strict";

  var isTouch = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;
  if (!isTouch) return;

  /* ═══════════════════════════════════════════════════════
     1. BOTONES DERECHA (#mobileRightBtns)
     ═══════════════════════════════════════════════════════ */
  function buildRightButtons() {
    if (document.getElementById("mobileRightBtns")) return;

    var wrap = document.createElement("div");
    wrap.id = "mobileRightBtns";

    /* ── Combate ── */
    var combatBtn = makeBtn("⚔️", "COMBATE", "mrb-btn mrb-combat", function () {
      if (window.setControlMode) {
        var next = (typeof controlMode !== "undefined" && controlMode === "combat") ? "rp" : "combat";
        setControlMode(next);
      }
    });
    combatBtn.id = "mrbCombatBtn";

    /* ── Hablar ── */
    var talkBtn = makeBtn("💬", "HABLAR", "mrb-btn mrb-talk", function () {
      if (window.interactNearby) interactNearby();
    });

    /* ── Volar ── */
    var flyBtn = makeBtn("🦅", "VOLAR", "mrb-btn mrb-fly", function () {
      if (window.toggleFly) toggleFly();
    });
    flyBtn.id = "mrbFlyBtn";

    /* ── Correr ── */
    var runBtn = document.createElement("button");
    runBtn.id = "mrbRunBtn";
    runBtn.className = "mrb-btn mrb-run";
    runBtn.innerHTML = '<span style="font-size:14px">💨</span><span class="mrb-label" id="mrbRunLabel">CORRER: OFF</span>';
    runBtn.addEventListener("click", doRun);
    runBtn.addEventListener("touchend", function (e) { e.preventDefault(); doRun(); }, { passive: false });

    wrap.appendChild(combatBtn);
    wrap.appendChild(talkBtn);
    wrap.appendChild(flyBtn);
    wrap.appendChild(runBtn);
    document.body.appendChild(wrap);

    /* Sincronizar estados cada 400 ms */
    setInterval(syncStates, 400);
  }

  function makeBtn(icon, label, cls, handler) {
    var btn = document.createElement("button");
    btn.className = cls;
    btn.innerHTML = icon + '<span class="mrb-label">' + label + "</span>";
    btn.addEventListener("click", handler);
    btn.addEventListener("touchend", function (e) { e.preventDefault(); handler(); }, { passive: false });
    return btn;
  }

  function doRun() {
    if (window.toggleRunMobile) toggleRunMobile();
    setTimeout(syncStates, 80);
  }

  function syncStates() {
    /* Correr */
    var origLbl = document.getElementById("runBtnLabel");
    var mrbLbl  = document.getElementById("mrbRunLabel");
    if (mrbLbl && origLbl) {
      var txt = origLbl.textContent || "";
      mrbLbl.textContent = txt || "CORRER";
      var runBtn = document.getElementById("mrbRunBtn");
      if (runBtn) runBtn.classList.toggle("run-active", txt.indexOf("ON") !== -1);
    }
    /* Modo combate */
    var combatBtn = document.getElementById("mrbCombatBtn");
    if (combatBtn) {
      var inCombat = typeof controlMode !== "undefined" && controlMode === "combat";
      combatBtn.classList.toggle("active-mode", inCombat);
    }
    /* Volar */
    var flyBtn = document.getElementById("mrbFlyBtn");
    if (flyBtn) {
      var flying = typeof isFlying !== "undefined" && isFlying;
      flyBtn.classList.toggle("fly-active", !!flying);
    }
  }

  /* ═══════════════════════════════════════════════════════
     2. BOTÓN OCULTAR / MOSTRAR UI (#uiToggleBtn)
     ═══════════════════════════════════════════════════════ */
  function buildUiToggle() {
    if (document.getElementById("uiToggleBtn")) return;

    var btn = document.createElement("button");
    btn.id = "uiToggleBtn";
    btn.title = "Mostrar / Ocultar interfaz";
    btn.textContent = "UI";

    var hidden = false;
    function toggle(e) {
      e && e.stopPropagation();
      hidden = !hidden;
      document.body.classList.toggle("ui-hidden", hidden);
      btn.textContent = hidden ? "👁" : "UI";
    }
    btn.addEventListener("click", toggle);
    btn.addEventListener("touchend", function (e) { e.preventDefault(); toggle(); }, { passive: false });
    document.body.appendChild(btn);
  }

  /* ═══════════════════════════════════════════════════════
     3. HELPER: scroll ▲▼ para paneles
     ═══════════════════════════════════════════════════════ */
  function createScrollButtons(scrollTargetId, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.style.cssText = [
      "position:fixed",
      "right:" + (opts.right || "10px"),
      opts.bottom ? "bottom:" + opts.bottom : "top:50%",
      opts.bottom ? "" : "transform:translateY(-50%)",
      "display:none",
      "flex-direction:column",
      "gap:6px",
      "z-index:" + (opts.z || "1000"),
      "pointer-events:auto"
    ].join(";");

    var s = "width:32px;height:52px;background:rgba(8,9,15,.92);border:1px solid #2a3560;border-radius:8px;color:#f5c400;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;backdrop-filter:blur(8px);";
    var up = document.createElement("button"); up.textContent = "▲"; up.style.cssText = s;
    var dn = document.createElement("button"); dn.textContent = "▼"; dn.style.cssText = s;
    wrap.appendChild(up); wrap.appendChild(dn);
    document.body.appendChild(wrap);

    var STEP = 120, _iv = null;
    function scroll(dir) {
      var el = document.getElementById(scrollTargetId);
      if (el) el.scrollTop += dir * STEP;
      _iv = setInterval(function () { var e2 = document.getElementById(scrollTargetId); if (e2) e2.scrollTop += dir * STEP; }, 80);
    }
    function stop() { clearInterval(_iv); _iv = null; }
    up.addEventListener("mousedown",  function (e) { e.stopPropagation(); scroll(-1); });
    dn.addEventListener("mousedown",  function (e) { e.stopPropagation(); scroll(1);  });
    document.addEventListener("mouseup", stop);
    [up, dn].forEach(function (btn) {
      btn.addEventListener("touchstart",  function (e) { e.stopPropagation(); e.preventDefault(); scroll(btn === up ? -1 : 1); }, { passive: false });
      btn.addEventListener("touchend",    function (e) { e.stopPropagation(); stop(); }, { passive: false });
      btn.addEventListener("touchcancel", function (e) { e.stopPropagation(); stop(); }, { passive: false });
    });
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════
     4. OVERLAY PANELS: woPanel / npcPanel
     ═══════════════════════════════════════════════════════ */
  function setupOverlayPanel(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;

    var scrollWrap = createScrollButtons(panelId, { z: "1000" });

    /* Botón X cerrar */
    if (!panel.querySelector(".mob-close")) {
      var x = document.createElement("button");
      x.className = "mob-close";
      x.textContent = "✕";
      x.style.cssText = "position:absolute;top:10px;right:10px;z-index:10;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#8892b0;width:32px;height:32px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;";
      x.onclick = function (e) {
        e.stopPropagation();
        panel.classList.remove("open");
        panel.style.display = "none";
        scrollWrap.style.display = "none";
      };
      panel.style.position = "fixed";
      panel.appendChild(x);
    }

    var obs = new MutationObserver(function () {
      var vis = panel.classList.contains("open") || (panel.style.display !== "" && panel.style.display !== "none");
      scrollWrap.style.display = vis ? "flex" : "none";
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class", "style"] });
  }

  /* ═══════════════════════════════════════════════════════
     5. MENÚ HAMBURGUESA: patching
     ═══════════════════════════════════════════════════════ */
  function patchMenuButtons() {
    document.querySelectorAll(".menu-btn").forEach(function (btn) {
      var txt = (btn.textContent || "").trim();

      if (txt.indexOf("OBJETOS MUNDO") !== -1 || (txt.indexOf("OBJETOS") !== -1 && txt.indexOf("MUNDO") !== -1)) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var panel = document.getElementById("woPanel");
          if (window.WorldObjectsSystem && panel) {
            var open = panel.classList.contains("open") || panel.style.display === "flex";
            if (!open) { WorldObjectsSystem.toggleUI(); setTimeout(function () { panel.style.display = "flex"; panel.classList.add("open"); }, 40); }
            else        { WorldObjectsSystem.toggleUI(); panel.style.display = "none"; panel.classList.remove("open"); }
          } else if (window.WorldObjectsSystem) WorldObjectsSystem.toggleUI();
          if (window.closeMenu) closeMenu();
        };
      }

      if (txt.indexOf("GESTIONAR") !== -1 && txt.indexOf("NPC") !== -1) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var panel = document.getElementById("npcPanel");
          if (window.NpcSystem && panel) {
            var open = panel.classList.contains("open") || panel.style.display === "flex";
            if (!open) {
              NpcSystem.togglePanel();
              setTimeout(function () {
                panel.style.display = "flex"; panel.classList.add("open");
                var tab2 = panel.querySelector(".npc-tab:nth-child(2)");
                if (tab2 && NpcSystem.switchTab) NpcSystem.switchTab("active", tab2);
              }, 40);
            } else { NpcSystem.togglePanel(); panel.style.display = "none"; panel.classList.remove("open"); }
          } else if (window.NpcSystem) NpcSystem.togglePanel();
          if (window.closeMenu) closeMenu();
        };
      }

      if (txt.indexOf("CHAT RPG") !== -1) {
        btn.onclick = function (e) {
          e.stopPropagation();
          if (window.RpgChatSystem) RpgChatSystem.toggle();
          if (window.closeMenu) closeMenu();
        };
      }
    });
  }

  function addRpgChatToMenu() {
    var menu = document.getElementById("leftMenu");
    if (!menu) return;
    var already = false;
    menu.querySelectorAll(".menu-btn").forEach(function (b) { if ((b.textContent || "").indexOf("CHAT RPG") !== -1) already = true; });
    if (already) return;
    var sec = document.createElement("div");
    sec.className = "menu-section";
    sec.innerHTML = '<div class="menu-section-label">Chat</div>' +
      '<button class="menu-btn" onclick="if(window.RpgChatSystem)RpgChatSystem.toggle();closeMenu()">' +
      '<span class="btn-ic">💬</span> CHAT RPG</button>';
    var cam = null;
    menu.querySelectorAll(".menu-section-label").forEach(function (l) { if (/c[aá]mara/i.test(l.textContent)) cam = l.parentElement; });
    if (cam) menu.insertBefore(sec, cam); else menu.appendChild(sec);
  }

  /* ═══════════════════════════════════════════════════════
     6. CHAT RPG: scroll ▲▼ + emotion picker
     ═══════════════════════════════════════════════════════ */
  function setupRpgChat() {
    var panel = document.getElementById("rpgChatPanel");
    if (!panel) return;

    var scrollWrap = createScrollButtons("rpgChatMessages", { bottom: "260px", z: "31" });
    var obs = new MutationObserver(function () {
      scrollWrap.style.display = panel.classList.contains("open") ? "flex" : "none";
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class"] });

    var emBtn = document.getElementById("rpgEmotionBtn");
    if (emBtn) {
      /* Reemplazar el handler original para reposicionar el picker */
      emBtn.onclick = function (e) {
        e.stopPropagation();
        var ep = document.getElementById("rpgEmPicker");
        if (!ep) return;
        var rect = panel.getBoundingClientRect();
        ep.style.bottom = (window.innerHeight - rect.top + 6) + "px";
        if (window.RpgChatSystem) RpgChatSystem.toggleEmPicker();
      };
    }

    document.addEventListener("touchstart", function (e) {
      var ep = document.getElementById("rpgEmPicker");
      if (ep && ep.classList.contains("open") && !ep.contains(e.target) && e.target !== emBtn) {
        if (window.RpgChatSystem) RpgChatSystem.toggleEmPicker(false);
      }
    }, { passive: true });

    addRpgChatToMenu();
  }

  /* ═══════════════════════════════════════════════════════
     7. INIT
     ═══════════════════════════════════════════════════════ */
  function init() {
    buildRightButtons();
    buildUiToggle();
    setupOverlayPanel("woPanel");
    setupOverlayPanel("npcPanel");

    /* RPG Chat se crea dinámicamente — esperar hasta 4 s */
    var t1 = 0;
    var ti = setInterval(function () {
      if (document.getElementById("rpgChatPanel") || ++t1 > 40) { clearInterval(ti); if (document.getElementById("rpgChatPanel")) setupRpgChat(); }
    }, 100);

    /* Menú hamburguesa — esperar a que tenga botones */
    var t2 = 0;
    var tm = setInterval(function () {
      if (document.querySelectorAll(".menu-btn").length > 2 || ++t2 > 30) { clearInterval(tm); patchMenuButtons(); addRpgChatToMenu(); }
    }, 150);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})();