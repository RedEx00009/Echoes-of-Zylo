/**
 * DRAGON WORLD Z — Sparring Patch v3.0
 * ══════════════════════════════════════════════════════════════════
 * INSTALACIÓN: al final de game.html, antes de </body>
 *   <script src="sparring-patch.js"></script>
 *
 * ARQUITECTURA v3.0 — Canal dedicado en Firebase Realtime Database:
 *
 *  combatAnims/{playerId}  → { anim, fromId, hp, dmg, label, color, victimName, t }
 *    - Se escribe cuando alguien RECIBE o EJECUTA una acción de combate
 *    - Todos los clientes escuchan child_changed y child_added en este nodo
 *    - Se auto-limpia después de la duración de la animación
 *    - sendPlayerUpdate NO toca este canal → no hay carrera de datos
 *
 *  partyActions/{targetId} → solo para enviar el aviso de daño (privado)
 *
 * FLUJO COMPLETO:
 *  Atacante pulsa botón
 *    → calcula daño
 *    → escribe combatAnims/{myId}      → todos ven el ataque
 *    → escribe partyActions/{targetId} → aviso privado de daño
 *
 *  Objetivo recibe partyAction
 *    → descuenta HP localmente
 *    → escribe combatAnims/{myId}      → todos ven el hurt
 *    → borra partyActions/{myId}
 * ══════════════════════════════════════════════════════════════════
 */

(function patchSparring() {
  "use strict";

  function waitForGame(cb, attempts) {
    attempts = attempts || 0;
    if (attempts > 300) {
      console.warn("[sparring v3] Timeout esperando el juego");
      return;
    }
    if (
      window.db &&
      window.myPlayerId &&
      window.player &&
      window.player.maxHp > 0 &&
      window.otherPlayerAnimators !== undefined
    ) {
      cb();
      return;
    }
    setTimeout(function () { waitForGame(cb, attempts + 1); }, 150);
  }

  waitForGame(main);

  function main() {

    // ── Acceso a globales siempre frescos ─────────────────────────────────
    var G = {
      get db()        { return window.db; },
      get myId()      { return window.myPlayerId; },
      get player()    { return window.player; },
      get others()    { return window.otherPlayers; },
      get animators() { return window.otherPlayerAnimators; },
      get effects()   { return window.combatEffects; },
      get myAnim()    { return window.csAnimator; },
      get cam()       { return window.cam; },
      get flying()    { return window.isFlying; },
      get inParty()   { return window.isPartyMember; },
      get selId()     { return window.selectedPlayerId; },
      set selId(v)    { window.selectedPlayerId = v; },
      get online()    { return window.mpConnected; },
    };

    // ── Config de movimientos ─────────────────────────────────────────────
    var MOVES = {
      sparring: { dmgBase:0.08, dmgVar:0.04, ki:5,  label:"SPARRING!",    atk:"attack_1",  color:"#f5c400" },
      ki_clash: { dmgBase:0.13, dmgVar:0.05, ki:20, label:"KI CLASH!!",   atk:"ki_charge", color:"#00e5ff" },
      gut_hit:  { dmgBase:0.11, dmgVar:0.03, ki:8,  label:"¡ESTOMAGO!",  atk:"attack_1",  color:"#ff7043" },
      face_hit: { dmgBase:0.10, dmgVar:0.06, ki:6,  label:"¡EN LA CARA!", atk:"attack_2",  color:"#ff5252" },
    };
    var SELF_HIT = new Set(["take_gut", "take_face", "lose"]);

    // Duración aproximada de cada animación en ms
    var ANIM_DUR = {
      attack_1:  750,
      attack_2:  500,
      ki_charge: 700,
      hurt:      850,
      death:     1500,
      jump:      600,
    };

    // Animaciones de combate que no deben ser interrumpidas por idle/walk
    var COMBAT_ANIMS = new Set(["attack_1", "attack_2", "ki_charge", "hurt", "death", "jump"]);

    // ── Estado local ──────────────────────────────────────────────────────
    var cooldowns   = {};     // targetId → timestamp último golpe enviado
    var COOLDOWN_MS = 700;
    var koInProgress = false;

    // Protección de animaciones remotas
    // animProtect[remoteId] = timestamp hasta el que NO se interrumpe
    var animProtect = {};

    // Lock de mi animación local (evita que sendPlayerUpdate pise con idle)
    var myLockUntil = 0;
    var myLockAnim  = "idle";

    // ════════════════════════════════════════════════════════════════════
    //  PASO 1: Parchear SpriteAnimators remotos para respetar animProtect
    // ════════════════════════════════════════════════════════════════════

    function patchRemoteAnimators() {
      var animMap = window.otherPlayerAnimators;
      if (!animMap) return;
      Object.keys(animMap).forEach(function (id) {
        var anim = animMap[id];
        if (!anim || anim.__sp3Patched) return;
        anim.__sp3Patched = true;
        var _orig = anim.play.bind(anim);
        anim.play = function (action, onComplete) {
          var now = Date.now();
          if (animProtect[id] && now < animProtect[id] && !COMBAT_ANIMS.has(action)) {
            return anim; // ignorar idle/walk/run durante animación de combate
          }
          if (COMBAT_ANIMS.has(action)) {
            animProtect[id] = now + (ANIM_DUR[action] || 800) + 200;
          }
          return _orig(action, onComplete);
        };
      });
    }

    patchRemoteAnimators();
    setInterval(patchRemoteAnimators, 2000);

    // ════════════════════════════════════════════════════════════════════
    //  PASO 2: Hook sendPlayerUpdate para publicar animación correcta
    //  durante el lock de combate
    // ════════════════════════════════════════════════════════════════════

    var _origSend = window.sendPlayerUpdate;
    if (_origSend) {
      window.sendPlayerUpdate = function () {
        if (Date.now() < myLockUntil && G.online && G.myId && G.player) {
          var p = G.player;
          G.db.ref("players/" + G.myId).update({
            x:          Math.floor(p.x),
            y:          Math.floor(p.y),
            facing:     p.facing,
            animAction: myLockAnim,
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

    // ════════════════════════════════════════════════════════════════════
    //  PASO 3: Canal combatAnims/ en Firebase Realtime Database
    //  Todos los jugadores escuchan este canal.
    //  Cuando cambia el nodo de alguien, se reproduce su animación
    //  en la pantalla de todos los demás.
    // ════════════════════════════════════════════════════════════════════

    function initCombatAnimsListener() {
      if (!G.db || !G.myId) return;

      var ref = G.db.ref("combatAnims");

      function handleCombatAnim(snap) {
        var data    = snap.val();
        var ownerId = snap.key; // el jugador que hace/recibe la acción

        if (!data) return;
        if (ownerId === G.myId) return; // yo ya lo hice localmente
        if (Date.now() - (data.t || 0) > 4000) return; // dato viejo

        var animName = data.anim;
        if (!animName || !COMBAT_ANIMS.has(animName)) return;

        // ── Reproducir la animación en el animator remoto ────────────────
        var animMap = window.otherPlayerAnimators;
        if (!animMap || !animMap[ownerId]) return;
        var remoteAnim = animMap[ownerId];

        if (!remoteAnim.__sp3Patched) patchRemoteAnimators();

        // Fijar protección para que idle/walk no interrumpa
        var dur = ANIM_DUR[animName] || 800;
        animProtect[ownerId] = Date.now() + dur + 200;

        // Llamar al prototipo original (bypasear el wrapper de protección)
        // para asegurarnos de que se reproduce SÍ O SÍ
        var proto = window.CharacterSystem &&
                    window.CharacterSystem.SpriteAnimator &&
                    window.CharacterSystem.SpriteAnimator.prototype;

        if (proto && proto.play) {
          proto.play.call(remoteAnim, animName, function () {
            animProtect[ownerId] = 0;
            proto.play.call(remoteAnim, "idle");
          });
        } else {
          remoteAnim.play(animName, function () {
            animProtect[ownerId] = 0;
          });
        }

        // ── Mostrar efectos visuales del combate ──────────────────────────
        var remotePlayer = G.others ? G.others[ownerId] : null;
        if (remotePlayer) {
          if (data.label) {
            push(
              remotePlayer.x || 0,
              (remotePlayer.y || 0) - 60,
              data.label,
              data.color || "#f5c400",
              1.4
            );
          }
          if (data.dmg && G.cam) {
            var sx = (remotePlayer.x || 0) - G.cam.x;
            var sy = (remotePlayer.y || 0) - G.cam.y - 55;
            spawnNum(sx, sy, data.dmg, data.color || "#ff1744");
          }
          if (animName === "death") {
            toast("💀 " + (data.victimName || "Un jugador") + " fue K.O.", "dmg");
          }
        }
      }

      ref.on("child_changed", handleCombatAnim);
      ref.on("child_added",   handleCombatAnim);
    }

    // ── Escribir mi animación de combate en Firebase ──────────────────────
    function writeCombatAnim(animName, extra) {
      if (!G.online || !G.myId) return;

      var dur  = ANIM_DUR[animName] || 800;
      var node = {
        anim:       animName,
        fromId:     G.myId,
        hp:         null,
        dmg:        null,
        label:      null,
        color:      null,
        victimName: null,
        t:          Date.now(),
      };

      // Mezclar datos extra (hp, dmg, label, color, victimName)
      if (extra) {
        Object.keys(extra).forEach(function (k) {
          node[k] = extra[k];
        });
      }

      G.db.ref("combatAnims/" + G.myId).set(node);

      // Bloquear sendPlayerUpdate para que no sobreescriba con idle/walk
      myLockUntil = Date.now() + dur + 250;
      myLockAnim  = animName;

      // Limpiar nodo después de la animación
      setTimeout(function () {
        G.db.ref("combatAnims/" + G.myId).remove();
      }, dur + 350);
    }

    // ════════════════════════════════════════════════════════════════════
    //  CÁLCULO DE DAÑO
    // ════════════════════════════════════════════════════════════════════

    function calcDmg(moveId, atkStr, defDef, defMaxHp) {
      var m = MOVES[moveId] || MOVES.sparring;
      var v = (Math.random() * m.dmgVar * 2) - m.dmgVar;
      var f = Math.max(0.5, Math.min(2.5, atkStr / Math.max(1, defDef)));
      return Math.max(1, Math.round(defMaxHp * (m.dmgBase + v) * f));
    }

    // ════════════════════════════════════════════════════════════════════
    //  RECIBIR GOLPE (soy el objetivo)
    // ════════════════════════════════════════════════════════════════════

    function takeDamage(dmg, moveId, fromName) {
      var p = G.player;
      if (!p || koInProgress) return;

      p.hp = Math.max(0, p.hp - dmg);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Efectos locales
      if (G.cam) {
        spawnNum(p.x - G.cam.x, p.y - G.cam.y - 55, dmg, (MOVES[moveId] || {}).color || "#ff1744");
      }
      push(p.x, p.y - 58, "-" + dmg, "#ff1744", 1.6);
      push(p.x, p.y - 38, (fromName || "???") + " GOLPEA", "#ffab91", 1.0);

      // Reproducir hurt localmente
      playMine("hurt", function () {
        if (!koInProgress) playMine(G.flying ? "fly" : "idle");
      });

      // Publicar en combatAnims/ → todos ven mi hurt
      writeCombatAnim("hurt", {
        hp:    p.hp,
        dmg:   dmg,
        label: "-" + dmg,
        color: "#ff1744",
      });

      // Sincronizar HP
      if (G.online && G.myId) {
        G.db.ref("players/" + G.myId).update({ hp: p.hp, t: Date.now() });
      }

      screenFlash("#ff1744", 0.4);
      toast("💥 -" + dmg + " HP de " + (fromName || "???"), "dmg");

      if (p.hp <= 0) ko(fromName);
    }

    // ════════════════════════════════════════════════════════════════════
    //  K.O.
    // ════════════════════════════════════════════════════════════════════

    function ko(fromName) {
      koInProgress = true;
      var p = G.player;

      playMine("death");

      // Publicar death → todos ven la caída
      writeCombatAnim("death", {
        hp:         0,
        label:      "K.O.",
        color:      "#ff1744",
        victimName: p.name,
      });

      if (G.online && G.myId) {
        G.db.ref("chat").push().set({
          id:   G.myId,
          name: "SISTEMA",
          text: "💀 " + p.name + " fue noqueado por " + (fromName || "???") + " en el sparring.",
          t:    Date.now(),
        });
        G.db.ref("players/" + G.myId).update({ hp: 0, animAction: "death", t: Date.now() });
      }

      showKO(fromName);

      setTimeout(function () {
        p.hp         = Math.floor(p.maxHp * 0.35);
        koInProgress = false;
        myLockUntil  = 0;
        myLockAnim   = "idle";
        hideKO();
        playMine("idle");
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (G.online && G.myId) {
          G.db.ref("players/" + G.myId).update({ hp: p.hp, animAction: "idle", t: Date.now() });
        }
        toast("⚡ Recuperado (35% HP)", "xp");
      }, 3200);
    }

    // ════════════════════════════════════════════════════════════════════
    //  ENVIAR GOLPE al objetivo (aviso privado via partyActions)
    // ════════════════════════════════════════════════════════════════════

    function sendHit(targetId, moveId, dmg) {
      if (!G.online || !G.myId) return;
      var now = Date.now();
      if (cooldowns[targetId] && now - cooldowns[targetId] < COOLDOWN_MS) return;
      cooldowns[targetId] = now;

      G.db.ref("partyActions/" + targetId).set({
        fromId:   G.myId,
        fromName: G.player.name,
        type:     "sparringHit",
        moveId:   moveId,
        dmg:      dmg,
        atkStr:   G.player.strength,
        t:        now,
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  LISTENER GOLPES ENTRANTES (partyActions/{myId})
    // ════════════════════════════════════════════════════════════════════

    function hookIncoming() {
      if (!G.myId) return;
      G.db.ref("partyActions/" + G.myId).on("value", function (snap) {
        var act = snap.val();
        if (!act || act.fromId === G.myId) return;

        if (act.type === "sparringHit") {
          takeDamage(act.dmg || 1, act.moveId || "sparring", act.fromName || "???");
          G.db.ref("partyActions/" + G.myId).remove();
          return;
        }

        // Party actions originales
        var p = G.player;
        if (act.type === "pushBack") {
          p.x += Number(act.dx) || 0;
          push(p.x, p.y - 44, act.text || "PIERDE", "#ff5252", 1.3);
        } else {
          push(p.x, p.y - 50, act.icon || "✨", "#f5c400", 1.2);
          push(p.x, p.y - 32, act.text || "PARTY", "#00e5ff", 1.0);
        }
        var animName = act.anim || "hurt";
        playMine(animName, function () { playMine(G.flying ? "fly" : "idle"); });
        writeCombatAnim(animName, {
          label: act.text || act.icon || null,
          color: "#f5c400",
        });
        G.db.ref("partyActions/" + G.myId).remove();
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE performPartyAction
    // ════════════════════════════════════════════════════════════════════

    var _origParty = window.performPartyAction;

    window.performPartyAction = function (moveId) {
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

      if (isSelf) {
        var fd = Math.max(1, Math.round(p.maxHp * 0.09 * (0.75 + Math.random() * 0.5)));
        takeDamage(fd, "sparring", tgt.name || "???");
        return;
      }

      if (p.ki < mv.ki) { toast("⚡ Ki insuficiente (necesitás " + mv.ki + ")", "info"); return; }
      p.ki = Math.max(0, p.ki - mv.ki);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      var dmg     = calcDmg(moveId, p.strength, tgt.defense || 80, tgt.maxHp || 500);
      var midX    = (p.x + (tgt.x || p.x)) / 2;
      var midY    = (p.y + (tgt.y || p.y)) / 2;
      var atkAnim = mv.atk || "attack_1";

      // Efectos locales del atacante
      push(midX, midY - 62, "-" + dmg, "#ff1744", 1.7);
      push(midX, midY - 40, mv.label, mv.color, 1.1);
      if (G.cam) {
        spawnNum((tgt.x || p.x) - G.cam.x, (tgt.y || p.y) - G.cam.y - 55, dmg, mv.color);
      }

      // Reproducir ataque localmente
      playMine(atkAnim, function () { playMine(G.flying ? "fly" : "idle"); });

      // Publicar en combatAnims/ → todos ven mi ataque
      writeCombatAnim(atkAnim, {
        label: mv.label,
        color: mv.color,
        dmg:   dmg,
      });

      screenFlash(mv.color, 0.12);
      toast(mv.label + " → -" + dmg + " HP", "xp");

      // Aviso privado al objetivo (él publicará su hurt)
      sendHit(targetId, moveId, dmg);
    };

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDES menores
    // ════════════════════════════════════════════════════════════════════

    var _origAccept = window.acceptPartyInvite;
    window.acceptPartyInvite = function () {
      if (_origAccept) _origAccept();
      setTimeout(function () {
        if (typeof window.setControlMode === "function") {
          window.setControlMode("partyCombat");
          banner();
        }
      }, 400);
    };

    var _origMode = window.setControlMode;
    window.setControlMode = function (mode) {
      if (_origMode) _origMode(mode);
      var btn = document.getElementById("spSurrenderBtn");
      if (btn) btn.style.display = mode === "partyCombat" ? "block" : "none";
    };

    // ════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ════════════════════════════════════════════════════════════════════

    function playMine(anim, cb) {
      if (G.myAnim) G.myAnim.play(anim, cb || null);
    }

    function push(x, y, text, color, timer) {
      var ef = G.effects;
      if (ef) ef.push({ x: x, y: y, text: text, color: color, timer: timer || 1.2 });
    }

    function toast(msg, type) {
      if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
    }

    function nearestPartyMember() {
      var p = G.player, best = null, bestD = Infinity;
      for (var id in G.others) {
        if (!G.inParty(id)) continue;
        var op = G.others[id];
        var d  = Math.hypot((op.x || 0) - p.x, (op.y || 0) - p.y);
        if (d < bestD) { bestD = d; best = id; }
      }
      return best;
    }

    function spawnNum(cx, cy, dmg, color) {
      if (!dmg) return;
      var hud = document.getElementById("hud");
      if (!hud) return;
      var el = document.createElement("div");
      el.textContent = "-" + dmg;
      el.style.cssText = [
        "position:absolute",
        "left:" + (cx - 28) + "px",
        "top:"  + cy + "px",
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
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
    }

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
      setTimeout(function () { ov.style.opacity = "0"; }, 110);
    }

    function banner() {
      var hud = document.getElementById("hud");
      if (!hud) return;
      var b = document.createElement("div");
      b.style.cssText = [
        "position:absolute", "top:50%", "left:50%",
        "transform:translate(-50%,-50%)",
        "z-index:60", "pointer-events:none",
        "font-family:'Orbitron',monospace",
        "font-size:clamp(20px,5vw,36px)", "font-weight:900",
        "letter-spacing:4px", "color:#f5c400", "text-align:center",
        "text-shadow:0 0 24px #f5c400,0 0 48px #ff6a00", "line-height:1.4",
        "animation:spDmgNum 3s forwards",
      ].join(";");
      b.innerHTML = "🥊 SPARRING INICIADO<br><span style='font-size:.52em;color:#ff7043;letter-spacing:2px'>¡DAÑO REAL ACTIVADO!</span>";
      hud.appendChild(b);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 3000);
    }

    function showKO(fromName) {
      var ov = document.getElementById("spKO");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "spKO";
        ov.style.cssText = [
          "position:fixed", "inset:0", "display:flex", "flex-direction:column",
          "align-items:center", "justify-content:center",
          "background:rgba(50,0,0,.88)", "z-index:200",
          "font-family:'Orbitron',monospace", "text-align:center",
        ].join(";");
        ov.innerHTML = [
          "<div style='font-size:clamp(48px,12vw,90px);font-weight:900;color:#ff1744;",
          "text-shadow:0 0 48px #ff1744;letter-spacing:8px;margin-bottom:14px'>K.O.</div>",
          "<div id='spKOSub' style='font-size:clamp(13px,3vw,20px);color:#ff7043;",
          "letter-spacing:3px;margin-bottom:30px'></div>",
          "<div style='font-size:11px;color:#8892b0;letter-spacing:2px'>",
          "RECUPERÁNDOTE EN 3 SEGUNDOS...</div>",
        ].join("");
        document.body.appendChild(ov);
      }
      var sub = document.getElementById("spKOSub");
      if (sub) sub.textContent = "Derrotado por " + (fromName || "???");
      ov.style.display = "flex";
    }

    function hideKO() {
      var ov = document.getElementById("spKO");
      if (ov) ov.style.display = "none";
    }

    function injectSurrender() {
      var hud = document.getElementById("hud");
      if (!hud || document.getElementById("spSurrenderBtn")) return;
      var btn = document.createElement("button");
      btn.id = "spSurrenderBtn";
      btn.textContent = "🏳 RENDIRSE";
      btn.style.cssText = [
        "position:absolute", "bottom:20px", "left:50%",
        "transform:translateX(calc(-50% - 90px))",
        "padding:11px 20px",
        "background:rgba(255,23,68,.2)", "border:1px solid #ff1744",
        "border-radius:8px", "color:#ff5252",
        "font-family:'Orbitron',monospace", "font-size:9px",
        "letter-spacing:2px", "cursor:pointer", "pointer-events:auto",
        "z-index:20", "display:none", "touch-action:manipulation",
      ].join(";");
      btn.onclick = function () {
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
        playMine("hurt", function () { playMine("idle"); });
        writeCombatAnim("hurt", { label: "RENDIDO", color: "#90a4ae" });
        toast("🏳 Te rendiste", "info");
        if (typeof window.setControlMode === "function") window.setControlMode("partyFriendly");
      };
      hud.appendChild(btn);
    }

    function injectCSS() {
      if (document.getElementById("spCSS")) return;
      var s = document.createElement("style");
      s.id = "spCSS";
      s.textContent = "@keyframes spDmgNum{0%{opacity:0;transform:translateY(0) scale(.5)}12%{opacity:1;transform:translateY(-18px) scale(1.3)}55%{opacity:1;transform:translateY(-35px) scale(1)}100%{opacity:0;transform:translateY(-65px) scale(.8)}}";
      document.head.appendChild(s);
    }

    // ════════════════════════════════════════════════════════════════════
    //  ARRANQUE
    // ════════════════════════════════════════════════════════════════════

    injectCSS();
    injectSurrender();
    hookIncoming();
    initCombatAnimsListener();

    // Limpiar mi nodo en combatAnims/ al desconectarse
    if (G.online && G.myId) {
      G.db.ref("combatAnims/" + G.myId).onDisconnect().remove();
    }

    console.log("[sparring v3.0] ✅ Canal combatAnims/ activo — animaciones de combate visibles para todos");
  }

})();
