/**
 * DRAGON WORLD Z — Sparring Patch v2.1
 * ══════════════════════════════════════════════════════
 * INSTALACIÓN: una sola línea al final de game.html, antes de </body>
 *   <script src="sparring-patch.js"></script>
 *
 * CAMBIOS v2.1:
 *  ✅ Animaciones visibles para TODOS los jugadores via players/{id}/animAction
 *  ✅ Fix definitivo: parchea el listener de Firebase para que no pise
 *     animaciones de combate con "idle/walk" mientras corren
 *  ✅ Daño real: HP, barra, sincronización Firebase
 *  ✅ Flash de pantalla al recibir golpe
 *  ✅ Números flotantes de daño
 *  ✅ K.O. con overlay y respawn en 3s
 *  ✅ Ki cost, stats STR/DEF, varianza de daño
 */

(function patchSparring() {
  "use strict";

  function waitForGame(cb, n) {
    n = n || 0;
    if (n > 200) return;
    if (
      window.db && window.myPlayerId &&
      window.player && window.player.maxHp > 0 &&
      window.otherPlayerAnimators !== undefined
    ) { cb(); return; }
    setTimeout(function() { waitForGame(cb, n + 1); }, 150);
  }

  waitForGame(main);

  function main() {

    // ── Proxy de acceso a globales (siempre frescos) ──────────────────────
    var G = {
      get db()       { return window.db; },
      get myId()     { return window.myPlayerId; },
      get player()   { return window.player; },
      get others()   { return window.otherPlayers; },
      get animators(){ return window.otherPlayerAnimators; },
      get effects()  { return window.combatEffects; },
      get myAnim()   { return window.csAnimator; },
      get cam()      { return window.cam; },
      get flying()   { return window.isFlying; },
      get inParty()  { return window.isPartyMember; },
      get selId()    { return window.selectedPlayerId; },
      set selId(v)   { window.selectedPlayerId = v; },
      get online()   { return window.mpConnected; },
    };

    // ── Config de combate ──────────────────────────────────────────────────
    var MOVES = {
      sparring: { dmgBase:0.08, dmgVar:0.04, ki:5,  label:"SPARRING!",   atk:"attack_1", color:"#f5c400" },
      ki_clash: { dmgBase:0.13, dmgVar:0.05, ki:20, label:"KI CLASH!!",  atk:"ki_charge",color:"#00e5ff" },
      gut_hit:  { dmgBase:0.11, dmgVar:0.03, ki:8,  label:"¡ESTOMAGO!", atk:"attack_1", color:"#ff7043" },
      face_hit: { dmgBase:0.10, dmgVar:0.06, ki:6,  label:"¡EN LA CARA!",atk:"attack_2",color:"#ff5252" },
    };
    var SELF_HIT = new Set(["take_gut","take_face","lose"]);

    // Duración aproximada por animación (ms) para calcular el lock
    var ANIM_DURATIONS = {
      attack_1:  750,
      attack_2:  400,
      ki_charge: 600,
      hurt:      850,
      death:     1500,
      jump:      600,
    };

    // ── Anti-spam ─────────────────────────────────────────────────────────
    var cooldowns = {};
    var COOLDOWN  = 700;

    // ── Locks de animación ────────────────────────────────────────────────
    // myAnimLock: hasta cuándo no debe sobreescribirse MI animAction al publicar
    var myAnimLock  = 0;
    var myAnimName  = "idle"; // qué animación estoy reproduciendo en el lock

    // animProtect: hasta cuándo no se interrumpe la animación de cada jugador remoto
    var animProtect = {};

    var koInProgress = false;

    // ── ONE_SHOT: animaciones que no deben ser interrumpidas ──────────────
    var ONE_SHOT = new Set(["hurt","death","attack_1","attack_2","ki_charge","jump"]);

    // ══════════════════════════════════════════════════════════════════════
    //  PASO 1: Parchar los SpriteAnimator remotos para que respeten animProtect
    // ══════════════════════════════════════════════════════════════════════

    setTimeout(patchAnimators, 600);
    setInterval(patchAnimators, 2000);

    function patchAnimators() {
      var animMap = window.otherPlayerAnimators;
      if (!animMap) return;
      Object.keys(animMap).forEach(function(id) {
        var anim = animMap[id];
        if (!anim || anim.__sparringPatched) return;
        anim.__sparringPatched = true;
        var origPlay = anim.play.bind(anim);
        anim.play = function(action, onComplete) {
          var now = Date.now();
          if (animProtect[id] && now < animProtect[id]) {
            // Solo interrumpir si la nueva acción también es ONE_SHOT
            // (ej: recibir un segundo golpe). Ignorar idle/walk/run.
            if (!ONE_SHOT.has(action)) return anim;
          }
          if (ONE_SHOT.has(action)) {
            var dur = ANIM_DURATIONS[action] || 900;
            animProtect[id] = Date.now() + dur + 200;
          }
          return origPlay(action, onComplete);
        };
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PASO 2: Hook sendPlayerUpdate para publicar animAction correcto
    //  CLAVE: El listener de Firebase en game.html llama
    //  otherPlayerAnimators[id].play(data.animAction) para TODOS los jugadores.
    //  Entonces, si publicamos el animAction correcto en players/{id},
    //  todos los demás lo verán automáticamente.
    // ══════════════════════════════════════════════════════════════════════

    var _origSend = window.sendPlayerUpdate;
    if (_origSend) {
      window.sendPlayerUpdate = function() {
        var now = Date.now();
        if (now < myAnimLock && G.online && G.myId && G.player) {
          // Estamos en medio de una animación de combate:
          // publicar el animAction correcto en lugar de idle/walk
          var p = G.player;
          G.db.ref("players/" + G.myId).update({
            x:          Math.floor(p.x),
            y:          Math.floor(p.y),
            facing:     p.facing,
            animAction: myAnimName,
            hp:         p.hp,
            ki:         Math.floor(p.ki),
            map:        window.currentMap,
            t:          Date.now(),
          });
          return;
        }
        _origSend();
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Publicar animación de combate para que TODOS la vean
    //  Actualiza players/{myId}/animAction → el listener de Firebase
    //  en game.html lo propaga a todos los demás jugadores automáticamente.
    // ══════════════════════════════════════════════════════════════════════

    function publishCombatAnim(animName, durationMs) {
      if (!G.online || !G.myId) return;
      var dur = durationMs || ANIM_DURATIONS[animName] || 900;

      // Fijar el lock para que sendPlayerUpdate no pise esta animación
      myAnimLock = Date.now() + dur + 200;
      myAnimName = animName;

      // Publicar en el nodo principal de Firebase (el que escuchan todos)
      G.db.ref("players/" + G.myId).update({
        animAction: animName,
        t:          Date.now(),
      });

      // Después del lock, volver a idle
      setTimeout(function() {
        if (Date.now() >= myAnimLock && G.online && G.myId) {
          G.db.ref("players/" + G.myId).update({ animAction: "idle", t: Date.now() });
        }
      }, dur + 250);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CÁLCULO DE DAÑO
    // ══════════════════════════════════════════════════════════════════════

    function calcDmg(moveId, atkStr, defDef, defMaxHp) {
      var m = MOVES[moveId] || MOVES.sparring;
      var v = (Math.random() * m.dmgVar * 2) - m.dmgVar;
      var f = Math.max(0.5, Math.min(2.5, atkStr / Math.max(1, defDef)));
      return Math.max(1, Math.round(defMaxHp * (m.dmgBase + v) * f));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  RECIBIR GOLPE (yo soy el objetivo)
    // ══════════════════════════════════════════════════════════════════════

    function takeDamage(dmg, moveId, fromName) {
      var p = G.player;
      if (!p || koInProgress) return;

      p.hp = Math.max(0, p.hp - dmg);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Número flotante en canvas
      if (G.cam) {
        var cx = p.x - G.cam.x;
        var cy = p.y - G.cam.y - 55;
        spawnNum(cx, cy, dmg, (MOVES[moveId] || {}).color || "#ff1744");
      }

      // combatEffects locales
      push(p.x, p.y - 58, "-" + dmg, "#ff1744", 1.6);
      push(p.x, p.y - 38, (fromName || "???") + " GOLPEA", "#ffab91", 1.0);

      // Reproducir "hurt" localmente
      var HURT_DUR = 850;
      playMine("hurt", function() { playMine(G.flying ? "fly" : "idle"); });

      // Publicar hurt en Firebase para que TODOS me vean siendo golpeado
      publishCombatAnim("hurt", HURT_DUR);

      // Actualizar HP en Firebase
      if (G.online && G.myId) {
        G.db.ref("players/" + G.myId).update({ hp: p.hp, t: Date.now() });
      }

      screenFlash("#ff1744", 0.4);
      toast("💥 -" + dmg + " HP", "dmg");

      if (p.hp <= 0) ko(fromName);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  K.O.
    // ══════════════════════════════════════════════════════════════════════

    function ko(fromName) {
      koInProgress = true;
      var p = G.player;
      playMine("death");
      publishCombatAnim("death", 1500);

      if (G.online && G.myId) {
        G.db.ref("chat").push().set({
          id:   G.myId,
          name: "SISTEMA",
          text: "💀 " + p.name + " fue noqueado por " + (fromName || "???") + " en el sparring.",
          t:    Date.now(),
        });
      }
      showKO(fromName);
      setTimeout(function() {
        p.hp         = Math.floor(p.maxHp * 0.35);
        koInProgress = false;
        myAnimLock   = 0;
        myAnimName   = "idle";
        hideKO();
        playMine("idle");
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (G.online && G.myId) {
          G.db.ref("players/" + G.myId).update({ hp: p.hp, animAction: "idle", t: Date.now() });
        }
        toast("⚡ Recuperado (35% HP)", "xp");
      }, 3000);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ENVIAR GOLPE AL OBJETIVO (via partyActions)
    // ══════════════════════════════════════════════════════════════════════

    function sendHit(targetId, moveId, dmg) {
      if (!G.online || !G.myId) return;
      var now = Date.now();
      if (cooldowns[targetId] && now - cooldowns[targetId] < COOLDOWN) return;
      cooldowns[targetId] = now;
      G.db.ref("partyActions/" + targetId).set({
        fromId:   G.myId,
        fromName: G.player.name,
        type:     "sparringHit",
        moveId:   moveId,
        dmg:      dmg,
        atkStr:   G.player.strength,
        atkAnim:  (MOVES[moveId] || {}).atk || "attack_1",
        t:        now,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  LISTENER GOLPES ENTRANTES
    // ══════════════════════════════════════════════════════════════════════

    function hookIncoming() {
      if (!G.myId) return;
      G.db.ref("partyActions/" + G.myId).on("value", function(snap) {
        var act = snap.val();
        if (!act || act.fromId === G.myId) return;

        if (act.type === "sparringHit") {
          takeDamage(act.dmg || 1, act.moveId || "sparring", act.fromName || "???");
          G.db.ref("partyActions/" + G.myId).remove();
          return;
        }

        // Comportamiento original para otros tipos de party actions
        var p = G.player;
        if (act.type === "pushBack") {
          p.x += Number(act.dx) || 0;
          push(p.x, p.y - 44, act.text || "PIERDE", "#ff5252", 1.3);
        } else {
          push(p.x, p.y - 50, act.icon || "✨", "#f5c400", 1.2);
          push(p.x, p.y - 32, act.text || "PARTY", "#00e5ff", 1.0);
        }
        var ha = act.anim || "hurt";
        playMine(ha, function() { playMine(G.flying ? "fly" : "idle"); });
        publishCombatAnim(ha, ANIM_DURATIONS[ha] || 900);
        G.db.ref("partyActions/" + G.myId).remove();
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE performPartyAction
    // ══════════════════════════════════════════════════════════════════════

    var _origParty = window.performPartyAction;

    window.performPartyAction = function(moveId) {
      var mv     = MOVES[moveId];
      var isSelf = SELF_HIT.has(moveId);

      if (!mv && !isSelf) {
        if (_origParty) return _origParty(moveId);
        return;
      }

      var targetId = (G.selId && G.others[G.selId]) ? G.selId : nearestPartyMember();
      if (!targetId || !G.others[targetId]) {
        toast("Seleccioná un miembro de party", "info"); return;
      }
      if (!G.inParty(targetId)) {
        toast("Solo funciona en party", "dmg"); return;
      }
      G.selId = targetId;

      var p   = G.player;
      var tgt = G.others[targetId];
      var midX = (p.x + (tgt.x || p.x)) / 2;
      var midY = (p.y + (tgt.y || p.y)) / 2;

      // Acción de recibir (yo pulso "recibir")
      if (isSelf) {
        var fd = Math.max(1, Math.round(p.maxHp * 0.09 * (0.75 + Math.random() * 0.5)));
        takeDamage(fd, "sparring", tgt.name || "???");
        return;
      }

      // Verificar Ki
      if (p.ki < mv.ki) { toast("⚡ Ki insuficiente (necesitás " + mv.ki + ")", "info"); return; }
      p.ki = Math.max(0, p.ki - mv.ki);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Calcular daño
      var dmg = calcDmg(moveId, p.strength, tgt.defense || 80, tgt.maxHp || 500);

      // Efectos visuales locales (atacante)
      push(midX, midY - 62, "-" + dmg, "#ff1744", 1.7);
      push(midX, midY - 40, mv.label,  mv.color,  1.1);
      if (G.cam) {
        var tx = (tgt.x || p.x) - G.cam.x;
        var ty = (tgt.y || p.y) - G.cam.y - 55;
        spawnNum(tx, ty, dmg, mv.color);
      }

      // Mi animación de ataque — local Y publicada para que todos la vean
      var atkAnim = mv.atk || "attack_1";
      var atkDur  = ANIM_DURATIONS[atkAnim] || 750;
      playMine(atkAnim, function() { playMine(G.flying ? "fly" : "idle"); });
      publishCombatAnim(atkAnim, atkDur);

      screenFlash(mv.color, 0.12);
      toast(mv.label + " → -" + dmg + " HP", "xp");

      // Enviar golpe al objetivo (él recibirá hurt)
      sendHit(targetId, moveId, dmg);
    };

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE acceptPartyInvite → activa partyCombat automáticamente
    // ══════════════════════════════════════════════════════════════════════

    var _origAccept = window.acceptPartyInvite;
    window.acceptPartyInvite = function() {
      if (_origAccept) _origAccept();
      setTimeout(function() {
        if (typeof window.setControlMode === "function") {
          window.setControlMode("partyCombat");
          banner();
        }
      }, 400);
    };

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE setControlMode → mostrar/ocultar botón rendirse
    // ══════════════════════════════════════════════════════════════════════

    var _origMode = window.setControlMode;
    window.setControlMode = function(mode) {
      if (_origMode) _origMode(mode);
      var btn = document.getElementById("spSurrenderBtn");
      if (btn) btn.style.display = mode === "partyCombat" ? "block" : "none";
    };

    // ══════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════════════

    function playMine(anim, cb) {
      if (G.myAnim) G.myAnim.play(anim, cb || null);
    }

    function push(x, y, text, color, timer) {
      var ef = G.effects;
      if (ef) ef.push({ x:x, y:y, text:text, color:color, timer:timer || 1.2 });
    }

    function toast(msg, type) {
      if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
    }

    function nearestPartyMember() {
      var p    = G.player;
      var best = null, bestD = Infinity;
      for (var id in G.others) {
        if (!G.inParty(id)) continue;
        var op = G.others[id];
        var d  = Math.hypot((op.x||0)-p.x, (op.y||0)-p.y);
        if (d < bestD) { bestD = d; best = id; }
      }
      return best;
    }

    // ── Número flotante DOM ───────────────────────────────────────────────
    function spawnNum(cx, cy, dmg, color) {
      var hud = document.getElementById("hud");
      if (!hud) return;
      var el = document.createElement("div");
      el.textContent = "-" + dmg;
      el.style.cssText = [
        "position:absolute",
        "left:" + (cx - 28) + "px",
        "top:" + cy + "px",
        "font-family:'Orbitron',monospace",
        "font-size:26px",
        "font-weight:900",
        "color:" + (color || "#ff1744"),
        "pointer-events:none",
        "z-index:50",
        "text-shadow:0 0 12px " + (color || "#ff1744") + ",0 2px 0 rgba(0,0,0,.9)",
        "animation:spDmgNum 1.5s forwards",
      ].join(";");
      hud.appendChild(el);
      setTimeout(function() { el.remove(); }, 1500);
    }

    // ── Flash pantalla ────────────────────────────────────────────────────
    function screenFlash(color, opacity) {
      var ov = document.getElementById("spFlash");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "spFlash";
        ov.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;transition:opacity .28s;opacity:0;";
        document.body.appendChild(ov);
      }
      ov.style.background = color || "#ff1744";
      ov.style.opacity    = String(opacity || 0.35);
      setTimeout(function() { ov.style.opacity = "0"; }, 110);
    }

    // ── Banner de sparring iniciado ───────────────────────────────────────
    function banner() {
      var hud = document.getElementById("hud");
      if (!hud) return;
      var b = document.createElement("div");
      b.style.cssText = [
        "position:absolute",
        "top:50%",
        "left:50%",
        "transform:translate(-50%,-50%)",
        "z-index:60",
        "pointer-events:none",
        "font-family:'Orbitron',monospace",
        "font-size:clamp(20px,5vw,36px)",
        "font-weight:900",
        "letter-spacing:4px",
        "color:#f5c400",
        "text-align:center",
        "text-shadow:0 0 24px #f5c400,0 0 48px #ff6a00",
        "line-height:1.4",
        "animation:spDmgNum 3s forwards",
      ].join(";");
      b.innerHTML = "🥊 SPARRING INICIADO<br><span style='font-size:.52em;color:#ff7043;letter-spacing:2px'>¡DAÑO REAL ACTIVADO!</span>";
      hud.appendChild(b);
      setTimeout(function() { b.remove(); }, 3000);
    }

    // ── K.O. overlay ─────────────────────────────────────────────────────
    function showKO(fromName) {
      var ov = document.getElementById("spKO");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "spKO";
        ov.style.cssText = [
          "position:fixed",
          "inset:0",
          "display:flex",
          "flex-direction:column",
          "align-items:center",
          "justify-content:center",
          "background:rgba(50,0,0,.85)",
          "z-index:200",
          "font-family:'Orbitron',monospace",
          "text-align:center",
        ].join(";");
        ov.innerHTML = [
          "<div style='font-size:clamp(48px,12vw,90px);font-weight:900;color:#ff1744;",
          "text-shadow:0 0 48px #ff1744;letter-spacing:8px;margin-bottom:14px;'>K.O.</div>",
          "<div id='spKOSub' style='font-size:clamp(13px,3vw,20px);color:#ff7043;",
          "letter-spacing:3px;margin-bottom:30px;'></div>",
          "<div style='font-size:11px;color:#8892b0;letter-spacing:2px;'>",
          "RECUPERÁNDOTE EN 3 SEGUNDOS...</div>",
        ].join("");
        document.body.appendChild(ov);
      }
      var sub = ov.querySelector("#spKOSub");
      if (sub) sub.textContent = "Derrotado por " + (fromName || "???");
      ov.style.display = "flex";
    }

    function hideKO() {
      var ov = document.getElementById("spKO");
      if (ov) ov.style.display = "none";
    }

    // ── Botón Rendirse ────────────────────────────────────────────────────
    function injectSurrender() {
      var hud = document.getElementById("hud");
      if (!hud || document.getElementById("spSurrenderBtn")) return;
      var btn = document.createElement("button");
      btn.id = "spSurrenderBtn";
      btn.textContent = "🏳 RENDIRSE";
      btn.style.cssText = [
        "position:absolute",
        "bottom:20px",
        "left:50%",
        "transform:translateX(calc(-50% - 90px))",
        "padding:11px 20px",
        "background:rgba(255,23,68,.2)",
        "border:1px solid #ff1744",
        "border-radius:8px",
        "color:#ff5252",
        "font-family:'Orbitron',monospace",
        "font-size:9px",
        "letter-spacing:2px",
        "cursor:pointer",
        "pointer-events:auto",
        "z-index:20",
        "display:none",
        "touch-action:manipulation",
      ].join(";");
      btn.onclick = function() {
        var tid = (G.selId && G.others[G.selId]) ? G.selId : nearestPartyMember();
        if (tid && G.online && G.myId) {
          G.db.ref("partyActions/" + tid).set({
            fromId:   G.myId,
            fromName: G.player.name,
            type:     "effect",
            anim:     "attack_2",
            icon:     "🏆",
            text:     "GANA",
            t:        Date.now(),
          });
        }
        push(G.player.x, G.player.y - 52, "ME RINDO", "#90a4ae", 1.8);
        playMine("hurt", function() { playMine("idle"); });
        publishCombatAnim("hurt", ANIM_DURATIONS.hurt);
        toast("🏳 Te rendiste", "info");
        if (typeof window.setControlMode === "function") window.setControlMode("partyFriendly");
      };
      hud.appendChild(btn);
    }

    // ── CSS ───────────────────────────────────────────────────────────────
    function injectCSS() {
      if (document.getElementById("spCSS")) return;
      var s = document.createElement("style");
      s.id = "spCSS";
      s.textContent = "@keyframes spDmgNum{0%{opacity:0;transform:translateY(0) scale(.5)}12%{opacity:1;transform:translateY(-18px) scale(1.3)}55%{opacity:1;transform:translateY(-35px) scale(1.0)}100%{opacity:0;transform:translateY(-65px) scale(.8)}}";
      document.head.appendChild(s);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ARRANQUE
    // ══════════════════════════════════════════════════════════════════════
    injectCSS();
    injectSurrender();
    hookIncoming();

    console.log("[sparring v2.1] ✅ Sistema de combate real activo — animaciones via players/{id}/animAction");
  }

})();
