/**
 * DRAGON WORLD Z — mobile-ui-patch.js  v9
 *
 * ESTRATEGIA DE DETECCIÓN DE MODO COMBATE:
 *   MutationObserver en #skillsBar — cuando renderActionBars() lo rellena
 *   con skill-btns de combate, clonamos esos botones en #mrbCombatPanel
 *   (izquierda, sobre el joystick). Cuando vuelve a modo RP, lo ocultamos.
 *
 * MODO NORMAL (RP):
 *   Columna DERECHA: ⚡Acciones (desplegable del sideActionList) / ⚔️Combate / 💬Hablar / 🦅Volar / Correr
 *
 * MODO COMBATE:
 *   Panel IZQUIERDA del botón VOLAR (right:82px, bottom:60px — arriba del botón CORRER):
 *   botones clonados de #skillsBar + botón "VOLVER A RP" encima.
 *   Columna DERECHA oculta.
 *
 * #uiToggleBtn: todos los dispositivos
 */
(function () {
  "use strict";

  var isTouch = window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 768;

  /* ═══════════════════════════════════════════════════
     UI TOGGLE — todos los dispositivos
     ═══════════════════════════════════════════════════ */
  function buildUiToggle() {
    if (document.getElementById("uiToggleBtn")) {
      /* Ya existe en el HTML — solo cablear el toggle de texto */
      var existing = document.getElementById("uiToggleBtn");
      if (!existing.__wired) {
        existing.__wired = true;
        existing.addEventListener("click", function () {
          existing.textContent = document.body.classList.contains("ui-hidden") ? "👁" : "UI";
        });
      }
      return;
    }
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

  /* En PC solo necesitamos el toggle */
  if (!isTouch) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUiToggle);
    else buildUiToggle();
    return;
  }

  /* ═══════════════════════════════════════════════════
     PANEL COMBATE — usa directamente #actionGrid (ya tiene
     todos los botones con ontouchstart/ontouchend para cargar).
     En modo combate lo sacamos del .mobile-controls y lo
     posicionamos fijo sobre el joystick via CSS (#mrb-action-grid-combat).
     ═══════════════════════════════════════════════════ */
  var combatPanelVisible = false;

  function buildCombatPanel() {
    /* No creamos panel propio — usamos #actionGrid directamente */
  }

  function showCombatPanel(show) {
    combatPanelVisible = show;
    var grid   = document.getElementById("actionGrid");
    var normal = document.getElementById("mobileRightBtns");
    var rpPanel = document.getElementById("mrbRpPanel");

    if (grid) {
      if (show) {
        grid.classList.add("mrb-combat-mode");
      } else {
        grid.classList.remove("mrb-combat-mode");
      }
    }
    if (normal) normal.classList.toggle("mrb-mode-hidden", show);

    if (rpPanel && show) {
      rpPanel.classList.remove("open");
      var tog = document.getElementById("mrbRpToggleBtn");
      if (tog) tog.classList.remove("open-active");
    }
  }

  /* Observar #actionGrid para detectar cuando renderActionBars() lo cambia a modo combate */
  function watchSkillsBar() {
    var tried = 0;
    var ti = setInterval(function () {
      var grid = document.getElementById("actionGrid");
      if (grid || ++tried > 100) {
        clearInterval(ti);
        if (!grid) return;
        new MutationObserver(syncCombatMode).observe(grid, {
          childList: true,
          subtree: false,
        });
        syncCombatMode();
      }
    }, 80);
  }

  function syncCombatMode() {
    var grid = document.getElementById("actionGrid");
    if (!grid) return;
    /* En modo combate, renderActionBars() pone los botones con class "btn-emote/interact/trailer"
       y un botón "VOLVER A RP". En modo RP tiene mobileCombatBtn, mobileTalkBtn, etc. */
    var inCombat = !!grid.querySelector(".chargeable, .ult-btn");
    showCombatPanel(inCombat);
  }

  /* ═══════════════════════════════════════════════════
     PANEL RP ACCIONES — desplegable a la derecha
     Se rellena con #sideActionList (acciones RP)
     ═══════════════════════════════════════════════════ */
  function buildRpActionsPanel() {
    if (document.getElementById("mrbRpPanel")) return;
    var panel = document.createElement("div");
    panel.id = "mrbRpPanel";

    var grid = document.createElement("div");
    grid.id = "mrbRpGrid";
    panel.appendChild(grid);
    document.body.appendChild(panel);

    function syncRpGrid() {
      var src = document.getElementById("sideActionList");
      if (!src) return;
      var btns = src.querySelectorAll(".skill-btn");
      if (!btns.length) return;
      grid.innerHTML = "";
      btns.forEach(function (sb) {
        var b = document.createElement("button");
        b.className = "mrb-rp-action-btn";
        var icon = sb.querySelector(".skill-icon");
        var key  = sb.querySelector(".skill-key");
        b.innerHTML =
          (icon ? '<span class="mrb-rp-icon">' + icon.textContent + "</span>" : "") +
          (key  ? '<span class="mrb-rp-key">' + key.textContent + "</span>" : "");
        b.title = sb.title || "";
        var oc = sb.getAttribute("onclick");
        if (oc) {
          b.addEventListener("click", function () { try { (new Function(oc))(); } catch(e){} });
          b.addEventListener("touchend", function (e) { e.preventDefault(); try { (new Function(oc))(); } catch(err){} }, { passive: false });
        } else {
          b.addEventListener("click", function () { sb.click(); });
          b.addEventListener("touchend", function (e) { e.preventDefault(); sb.click(); }, { passive: false });
        }
        grid.appendChild(b);
      });
    }

    var tObs = 0;
    var tiObs = setInterval(function () {
      var src = document.getElementById("sideActionList");
      if (src || ++tObs > 100) {
        clearInterval(tiObs);
        if (src) {
          syncRpGrid();
          new MutationObserver(syncRpGrid).observe(src, { childList: true, subtree: true });
        }
      }
    }, 80);

    /* Cerrar al tocar fuera */
    document.addEventListener("touchstart", function (e) {
      var p2   = document.getElementById("mrbRpPanel");
      var tog2 = document.getElementById("mrbRpToggleBtn");
      if (p2 && p2.classList.contains("open") && !p2.contains(e.target) && e.target !== tog2) {
        p2.classList.remove("open");
        if (tog2) tog2.classList.remove("open-active");
      }
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════
     COLUMNA DERECHA — modo RP
     ═══════════════════════════════════════════════════ */
  function buildRightButtons() {
    if (document.getElementById("mobileRightBtns")) return;
    buildRpActionsPanel();

    var wrap = document.createElement("div");
    wrap.id = "mobileRightBtns";

    /* Toggle panel acciones RP */
    var rpToggle = document.createElement("button");
    rpToggle.id = "mrbRpToggleBtn";
    rpToggle.className = "mrb-btn mrb-rp-toggle";
    rpToggle.innerHTML = '⚡<span class="mrb-label">ACCIONES</span>';
    rpToggle.addEventListener("click", toggleRpPanel);
    rpToggle.addEventListener("touchend", function (e) { e.preventDefault(); toggleRpPanel(); }, { passive: false });

    /* Combate */
    var combatBtn = makeBtn("⚔️", "COMBATE", "mrb-btn mrb-combat", function () {
      if (window.setControlMode) setControlMode("combat");
    });
    combatBtn.id = "mrbCombatBtn";

    /* Hablar */
    var talkBtn = makeBtn("💬", "HABLAR", "mrb-btn mrb-talk", function () {
      if (window.interactNearby) interactNearby();
    });

    /* Volar */
    var flyBtn = makeBtn("🦅", "VOLAR", "mrb-btn mrb-fly", function () {
      if (window.toggleFly) toggleFly();
    });
    flyBtn.id = "mrbFlyBtn";

    /* Correr */
    var runBtn = document.createElement("button");
    runBtn.id = "mrbRunBtn";
    runBtn.className = "mrb-btn mrb-run";
    runBtn.innerHTML = '<span style="font-size:14px">💨</span><span class="mrb-label" id="mrbRunLabel">CORRER: OFF</span>';
    runBtn.addEventListener("click", doRun);
    runBtn.addEventListener("touchend", function (e) { e.preventDefault(); doRun(); }, { passive: false });

    wrap.appendChild(rpToggle);
    wrap.appendChild(combatBtn);
    wrap.appendChild(talkBtn);
    wrap.appendChild(flyBtn);
    wrap.appendChild(runBtn);
    document.body.appendChild(wrap);

    setInterval(syncStates, 400);
  }

  function toggleRpPanel() {
    var panel  = document.getElementById("mrbRpPanel");
    var togBtn = document.getElementById("mrbRpToggleBtn");
    if (!panel) return;
    panel.classList.toggle("open");
    if (togBtn) togBtn.classList.toggle("open-active", panel.classList.contains("open"));
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
      var rb = document.getElementById("mrbRunBtn");
      if (rb) rb.classList.toggle("run-active", txt.indexOf("ON") !== -1);
    }
    /* Volar columna derecha */
    var flyBtn = document.getElementById("mrbFlyBtn");
    if (flyBtn) flyBtn.classList.toggle("fly-active", typeof isFlying !== "undefined" && !!isFlying);
  }

  /* ═══════════════════════════════════════════════════
     HELPERS: scroll ▲▼ para paneles overlay
     ═══════════════════════════════════════════════════ */
  function createScrollButtons(scrollTargetId, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.style.cssText = [
      "position:fixed", "right:" + (opts.right || "10px"),
      opts.bottom ? "bottom:" + opts.bottom : "top:50%",
      opts.bottom ? "" : "transform:translateY(-50%)",
      "display:none", "flex-direction:column", "gap:6px",
      "z-index:" + (opts.z || "1000"), "pointer-events:auto"
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
    up.addEventListener("mousedown", function (e) { e.stopPropagation(); scroll(-1); });
    dn.addEventListener("mousedown", function (e) { e.stopPropagation(); scroll(1); });
    document.addEventListener("mouseup", stop);
    [up, dn].forEach(function (btn) {
      btn.addEventListener("touchstart", function (e) { e.stopPropagation(); e.preventDefault(); scroll(btn === up ? -1 : 1); }, { passive: false });
      btn.addEventListener("touchend",   function (e) { e.stopPropagation(); stop(); }, { passive: false });
      btn.addEventListener("touchcancel",function (e) { e.stopPropagation(); stop(); }, { passive: false });
    });
    return wrap;
  }

  /* ═══════════════════════════════════════════════════
     OVERLAY PANELS: woPanel / npcPanel
     ═══════════════════════════════════════════════════ */
  function setupOverlayPanel(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var scrollWrap = createScrollButtons(panelId, { z: "1000" });
    if (!panel.querySelector(".mob-close")) {
      var x = document.createElement("button");
      x.className = "mob-close";
      x.textContent = "✕";
      x.style.cssText = "position:absolute;top:10px;right:10px;z-index:10;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:6px;color:#8892b0;width:32px;height:32px;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;touch-action:manipulation;";
      x.onclick = function (e) { e.stopPropagation(); panel.classList.remove("open"); panel.style.display = "none"; scrollWrap.style.display = "none"; };
      panel.style.position = "fixed";
      panel.appendChild(x);
    }
    new MutationObserver(function () {
      var vis = panel.classList.contains("open") || (panel.style.display !== "" && panel.style.display !== "none");
      scrollWrap.style.display = vis ? "flex" : "none";
    }).observe(panel, { attributes: true, attributeFilter: ["class", "style"] });
  }

  /* ═══════════════════════════════════════════════════
     MENÚ HAMBURGUESA
     ═══════════════════════════════════════════════════ */
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
            else { WorldObjectsSystem.toggleUI(); panel.style.display = "none"; panel.classList.remove("open"); }
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
            if (!open) { NpcSystem.togglePanel(); setTimeout(function () { panel.style.display = "flex"; panel.classList.add("open"); var tab2 = panel.querySelector(".npc-tab:nth-child(2)"); if (tab2 && NpcSystem.switchTab) NpcSystem.switchTab("active", tab2); }, 40); }
            else { NpcSystem.togglePanel(); panel.style.display = "none"; panel.classList.remove("open"); }
          } else if (window.NpcSystem) NpcSystem.togglePanel();
          if (window.closeMenu) closeMenu();
        };
      }
      if (txt.indexOf("CHAT RPG") !== -1) {
        btn.onclick = function (e) { e.stopPropagation(); if (window.RpgChatSystem) RpgChatSystem.toggle(); if (window.closeMenu) closeMenu(); };
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
    sec.innerHTML = '<div class="menu-section-label">Chat</div><button class="menu-btn" onclick="if(window.RpgChatSystem)RpgChatSystem.toggle();closeMenu()"><span class="btn-ic">💬</span> CHAT RPG</button>';
    var cam = null;
    menu.querySelectorAll(".menu-section-label").forEach(function (l) { if (/c[aá]mara/i.test(l.textContent)) cam = l.parentElement; });
    if (cam) menu.insertBefore(sec, cam); else menu.appendChild(sec);
  }

  /* ═══════════════════════════════════════════════════
     CHAT RPG
     ═══════════════════════════════════════════════════ */
  function setupRpgChat() {
    var panel = document.getElementById("rpgChatPanel");
    if (!panel) return;
    var scrollWrap = createScrollButtons("rpgChatMessages", { bottom: "260px", z: "31" });
    new MutationObserver(function () {
      scrollWrap.style.display = panel.classList.contains("open") ? "flex" : "none";
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    var emBtn = document.getElementById("rpgEmotionBtn");
    if (emBtn) {
      emBtn.onclick = function (e) {
        e.stopPropagation();
        var ep = document.getElementById("rpgEmPicker");
        if (!ep) return;
        ep.style.bottom = (window.innerHeight - panel.getBoundingClientRect().top + 6) + "px";
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

  /* ═══════════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════════ */
  function init() {
    buildUiToggle();
    buildCombatPanel();
    buildRightButtons();
    watchSkillsBar();
    setupOverlayPanel("woPanel");
    setupOverlayPanel("npcPanel");

    /* RPG Chat dinámico */
    var t1 = 0;
    var ti = setInterval(function () {
      if (document.getElementById("rpgChatPanel") || ++t1 > 40) {
        clearInterval(ti);
        if (document.getElementById("rpgChatPanel")) setupRpgChat();
      }
    }, 100);

    /* Menú hamburguesa */
    var t2 = 0;
    var tm = setInterval(function () {
      if (document.querySelectorAll(".menu-btn").length > 2 || ++t2 > 30) {
        clearInterval(tm); patchMenuButtons(); addRpgChatToMenu();
      }
    }, 150);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})();