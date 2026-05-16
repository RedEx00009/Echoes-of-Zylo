/**
 * DRAGON WORLD Z — Sparring System Patch v1.1
 * ─────────────────────────────────────────────
 * INSTALACIÓN: agregar al final de game.html antes de </body>
 *   <script src="sparring-patch.js"></script>
 *
 * FIX v1.1: animaciones de hit visibles para AMBOS jugadores
 *  - Canal "playerAnims/{id}" dedicado solo a animaciones (no compite con sendPlayerUpdate)
 *  - animLockUntil: bloquea sendPlayerUpdate de pisar "hurt" mientras dura la animación
 *  - broadcastMyAnim(): publica la animación para que los remotos la vean instantáneo
 *  - listenRemoteAnims(): todos leen el canal y aplican al animator del remoto
 */

(function patchSparring() {
  "use strict";

  function waitForGame(cb, attempts) {
    attempts = attempts || 0;
    if (attempts > 120) { console.warn("[sparring] timeout"); return; }
    const ready =
      typeof window.db !== "undefined" &&
      typeof window.myPlayerId !== "undefined" && window.myPlayerId &&
      typeof window.player !== "undefined" && window.player.maxHp > 0;
    if (ready) cb();
    else setTimeout(() => waitForGame(cb, attempts + 1), 250);
  }

  waitForGame(init);

  function init() {

    const G = {
      get db()                   { return window.db; },
      get myId()                 { return window.myPlayerId; },
      get player()               { return window.player; },
      get otherPlayers()         { return window.otherPlayers; },
      get otherPlayerAnimators() { return window.otherPlayerAnimators; },
      get combatEffects()        { return window.combatEffects; },
      get csAnimator()           { return window.csAnimator; },
      get cam()                  { return window.cam; },
      get isFlying()             { return window.isFlying; },
      get isPartyMember()        { return window.isPartyMember; },
      get selectedPlayerId()           { return window.selectedPlayerId; },
      set selectedPlayerId(v)          { window.selectedPlayerId = v; },
      get mpConnected()                { return window.mpConnected; },
    };

    const DMG_CONFIG = {
      sparring: { base:0.08, variance:0.04, kiCost:5,  label:"SPARRING", atkAnim:"attack_1" },
      ki_clash: { base:0.12, variance:0.05, kiCost:18, label:"KI CLASH", atkAnim:"ki_charge"},
      gut_hit:  { base:0.10, variance:0.03, kiCost:8,  label:"ESTOMAGO", atkAnim:"attack_1" },
      face_hit: { base:0.09, variance:0.06, kiCost:6,  label:"CARA",     atkAnim:"attack_2" },
    };
    const RECEIVE_ACTIONS = new Set(["take_gut","take_face","lose"]);
    const ONE_SHOT_ANIMS  = new Set(["hurt","death","attack_1","attack_2","ki_charge","jump"]);

    const hitCooldowns = {};
    const HIT_COOLDOWN_MS = 650;

    let animLockUntil = 0;
    let myKoInProgress = false;

    // ════════════════════════════════════════════════════════════════════
    //  CANAL DE ANIMACIONES  playerAnims/{id}
    // ════════════════════════════════════════════════════════════════════

    function broadcastMyAnim(animName, durationMs) {
      if (!G.mpConnected || !G.myId) return;
      G.db.ref("playerAnims/" + G.myId).set({ anim:animName, fromId:G.myId, t:Date.now() });
      setTimeout(() => G.db.ref("playerAnims/" + G.myId).remove(), (durationMs || 900) + 200);
    }

    function listenRemoteAnims() {
      function apply(snap) {
        const data = snap.val();
        const remoteId = snap.key;
        if (!data || remoteId === G.myId) return;
        if (Date.now() - (data.t || 0) > 2000) return;
        const animator = G.otherPlayerAnimators?.[remoteId];
        if (!animator) return;
        const anim = data.anim || "idle";
        if (ONE_SHOT_ANIMS.has(anim)) animator.play(anim, () => animator.play("idle"));
        else animator.play(anim);
      }
      G.db.ref("playerAnims").on("child_added",   apply);
      G.db.ref("playerAnims").on("child_changed",  apply);
    }

    // ════════════════════════════════════════════════════════════════════
    //  HOOK sendPlayerUpdate — protege "hurt" durante animLockUntil
    // ════════════════════════════════════════════════════════════════════

    const _origSendUpdate = window.sendPlayerUpdate;
    if (_origSendUpdate) {
      window.sendPlayerUpdate = function sendPlayerUpdate() {
        if (Date.now() < animLockUntil && G.mpConnected && G.myId && G.player) {
          const p = G.player;
          G.db.ref("players/" + G.myId).update({
            x:Math.floor(p.x), y:Math.floor(p.y), facing:p.facing,
            animAction:"hurt", hp:p.hp, ki:Math.floor(p.ki),
            map:window.currentMap, t:Date.now(),
          });
          return;
        }
        _origSendUpdate();
      };
    }

    // ════════════════════════════════════════════════════════════════════
    //  DAÑO
    // ════════════════════════════════════════════════════════════════════

    function calcDamage(actionId, atkStr, defDef, defMaxHp) {
      const cfg = DMG_CONFIG[actionId] || DMG_CONFIG.sparring;
      const v = (Math.random() * cfg.variance * 2) - cfg.variance;
      const factor = Math.max(0.5, Math.min(2.0, atkStr / Math.max(1, defDef)));
      return Math.max(1, Math.round(defMaxHp * (cfg.base + v) * factor));
    }

    // ════════════════════════════════════════════════════════════════════
    //  RECIBIR GOLPE (soy el objetivo)
    // ════════════════════════════════════════════════════════════════════

    function applyDamageToSelf(dmg, actionId, attackerName) {
      const p = G.player;
      if (!p) return;

      p.hp = Math.max(0, p.hp - dmg);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Número flotante de daño
      if (G.cam) spawnDamageNumber(p.x - G.cam.x, p.y - G.cam.y - 60, dmg,
        actionId === "ki_clash" ? "#00e5ff" : "#ff1744");

      if (G.combatEffects) {
        G.combatEffects.push({ x:p.x, y:p.y-55, text:`-${dmg}`,               timer:1.5, color:"#ff1744"  });
        G.combatEffects.push({ x:p.x, y:p.y-36, text:(attackerName||"???")+"\u00a0GOLPEA", timer:1.0, color:"#ffab91" });
      }

      // Animar hurt local y proteger el lock
      const HURT_MS = 800;
      animLockUntil = Date.now() + HURT_MS;
      if (G.csAnimator) {
        G.csAnimator.play("hurt", () => {
          animLockUntil = 0;
          if (G.csAnimator) G.csAnimator.play(G.isFlying ? "fly" : "idle");
        });
      }

      // Publicar en canal de anims (el atacante lo verá en su copia remota de mí)
      broadcastMyAnim("hurt", HURT_MS);

      // Actualizar nodo de players inmediatamente (sin esperar sendPlayerUpdate)
      if (G.mpConnected && G.myId) {
        G.db.ref("players/" + G.myId).update({ animAction:"hurt", hp:p.hp, t:Date.now() });
      }

      screenFlash("#ff1744", 0.35);
      if (typeof window.showHudToast === "function")
        window.showHudToast(`💥 -${dmg} HP de ${attackerName || "???"}`, "dmg");

      if (p.hp <= 0 && !myKoInProgress) handleKO(attackerName);
    }

    // ════════════════════════════════════════════════════════════════════
    //  K.O.
    // ════════════════════════════════════════════════════════════════════

    function handleKO(attackerName) {
      myKoInProgress = true;
      const p = G.player;
      if (G.csAnimator) G.csAnimator.play("death");
      broadcastMyAnim("death", 1200);
      if (G.mpConnected && G.myId) {
        G.db.ref("chat").push().set({
          id:G.myId, name:"SISTEMA",
          text:`💀 ${p.name} fue noqueado por ${attackerName||"???"} en el sparring.`,
          t:Date.now(),
        });
      }
      showKoOverlay(attackerName);
      setTimeout(() => {
        p.hp = Math.floor(p.maxHp * 0.3);
        myKoInProgress = false;
        animLockUntil = 0;
        hideKoOverlay();
        if (G.csAnimator) G.csAnimator.play("idle");
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (G.mpConnected && G.myId)
          G.db.ref("players/" + G.myId).update({ hp:p.hp, animAction:"idle", t:Date.now() });
        if (typeof window.showHudToast === "function")
          window.showHudToast("⚡ Recuperado (30% HP)", "xp");
      }, 3000);
    }

    // ════════════════════════════════════════════════════════════════════
    //  ENVIAR GOLPE AL OBJETIVO
    // ════════════════════════════════════════════════════════════════════

    function sendHitToTarget(targetId, actionId, dmg) {
      if (!G.mpConnected || !G.myId) return;
      const now = Date.now();
      if (hitCooldowns[targetId] && now - hitCooldowns[targetId] < HIT_COOLDOWN_MS) return;
      hitCooldowns[targetId] = now;
      G.db.ref("partyActions/" + targetId).set({
        fromId:G.myId, fromName:G.player.name, type:"sparringHit",
        actionId, dmg, attackerStr:G.player.strength,
        atkAnim:DMG_CONFIG[actionId]?.atkAnim || "attack_1", t:now,
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  LISTENER GOLPES ENTRANTES
    // ════════════════════════════════════════════════════════════════════

    function hookIncomingHits() {
      if (!G.myId || !G.db) return;
      G.db.ref("partyActions/" + G.myId).on("value", (snap) => {
        const act = snap.val();
        if (!act || act.fromId === G.myId) return;

        if (act.type === "sparringHit") {
          applyDamageToSelf(act.dmg || 1, act.actionId || "sparring", act.fromName || "???");
          G.db.ref("partyActions/" + G.myId).remove();
          return;
        }
        // Comportamiento original
        if (act.type === "pushBack") {
          if (G.player) G.player.x += Number(act.dx) || 0;
          if (G.combatEffects) G.combatEffects.push({ x:G.player.x, y:G.player.y-44, text:act.text||"PIERDE", timer:1.3, color:"#ff5252" });
        } else {
          if (G.combatEffects) {
            G.combatEffects.push({ x:G.player.x, y:G.player.y-50, text:act.icon||"✨",   timer:1.2, color:"#f5c400" });
            G.combatEffects.push({ x:G.player.x, y:G.player.y-32, text:act.text||"PARTY", timer:1.0, color:"#00e5ff" });
          }
        }
        const hitAnim = act.anim || "hurt";
        if (G.csAnimator) G.csAnimator.play(hitAnim, () => { if (G.csAnimator) G.csAnimator.play(G.isFlying?"fly":"idle"); });
        broadcastMyAnim(hitAnim, 900);
        G.db.ref("partyActions/" + G.myId).remove();
      });
    }

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE performPartyAction
    // ════════════════════════════════════════════════════════════════════

    const _origPerformParty = window.performPartyAction;
    window.performPartyAction = function performPartyAction(actionId) {
      const cfg = DMG_CONFIG[actionId];
      const isReceive = RECEIVE_ACTIONS.has(actionId);
      if (!cfg && !isReceive) {
        if (_origPerformParty) return _origPerformParty(actionId);
        return;
      }

      const targetId = (G.selectedPlayerId && G.otherPlayers[G.selectedPlayerId])
        ? G.selectedPlayerId : getNearestPartyMember();

      if (!targetId || !G.otherPlayers[targetId]) {
        if (typeof window.showHudToast === "function") window.showHudToast("Selecciona un miembro de party","info");
        return;
      }
      if (!G.isPartyMember(targetId)) {
        if (typeof window.showHudToast === "function") window.showHudToast("Solo funciona en party","dmg");
        return;
      }

      G.selectedPlayerId = targetId;
      const p = G.player, target = G.otherPlayers[targetId];
      const midX = (p.x + (target.x||p.x)) / 2;
      const midY = (p.y + (target.y||p.y)) / 2;

      if (isReceive) {
        const fakeDmg = Math.max(1, Math.round(p.maxHp * 0.08 * (0.8 + Math.random() * 0.4)));
        applyDamageToSelf(fakeDmg, actionId, target.name||"???");
        return;
      }

      if (p.ki < cfg.kiCost) {
        if (typeof window.showHudToast === "function") window.showHudToast(`⚡ Ki insuficiente (${cfg.kiCost})`, "info");
        return;
      }
      p.ki = Math.max(0, p.ki - cfg.kiCost);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      const dmg = calcDamage(actionId, p.strength, target.defense||80, target.maxHp||500);
      const hitColor = {ki_clash:"#00e5ff",face_hit:"#ff5252",gut_hit:"#ff7043",sparring:"#f5c400"}[actionId]||"#f5c400";

      if (G.combatEffects) {
        G.combatEffects.push({ x:midX, y:midY-58, text:`-${dmg}`, timer:1.6, color:"#ff1744" });
        G.combatEffects.push({ x:midX, y:midY-36, text:cfg.label,  timer:1.0, color:hitColor  });
      }

      // Mi animación de ataque (local + broadcast para el remoto)
      const atkAnim = cfg.atkAnim || "attack_1";
      if (G.csAnimator) G.csAnimator.play(atkAnim, () => { if (G.csAnimator) G.csAnimator.play(G.isFlying?"fly":"idle"); });
      broadcastMyAnim(atkAnim, 700);
      if (G.mpConnected && G.myId)
        G.db.ref("players/" + G.myId).update({ animAction:atkAnim, t:Date.now() });

      screenFlash(hitColor, 0.15);
      if (typeof window.showHudToast === "function") window.showHudToast(`${cfg.label} → -${dmg} HP`, "xp");

      sendHitToTarget(targetId, actionId, dmg);
    };

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE acceptPartyInvite
    // ════════════════════════════════════════════════════════════════════

    const _origAccept = window.acceptPartyInvite;
    window.acceptPartyInvite = function acceptPartyInvite() {
      if (_origAccept) _origAccept();
      setTimeout(() => {
        if (typeof window.setControlMode === "function") {
          window.setControlMode("partyCombat");
          showSparringReadyBanner();
        }
      }, 400);
    };

    // ════════════════════════════════════════════════════════════════════
    //  OVERRIDE setControlMode — botón rendirse
    // ════════════════════════════════════════════════════════════════════

    const _origSetMode = window.setControlMode;
    window.setControlMode = function setControlMode(mode) {
      if (_origSetMode) _origSetMode(mode);
      const btn = document.getElementById("sparringSurrenderBtn");
      if (btn) btn.style.display = mode === "partyCombat" ? "block" : "none";
    };

    // ════════════════════════════════════════════════════════════════════
    //  UI
    // ════════════════════════════════════════════════════════════════════

    function spawnDamageNumber(cx, cy, dmg, color) {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const el = document.createElement("div");
      el.textContent = `-${dmg}`;
      el.style.cssText = `position:absolute;left:${cx-24}px;top:${cy}px;
        font-family:'Orbitron',monospace;font-size:22px;font-weight:900;color:${color||"#ff1744"};
        text-shadow:0 0 10px ${color||"#ff1744"},0 2px 0 rgba(0,0,0,.8);
        pointer-events:none;z-index:50;animation:spawnDmgNum 1.4s forwards;`;
      hud.appendChild(el);
      setTimeout(() => el.remove(), 1400);
    }

    function screenFlash(color, opacity) {
      let ov = document.getElementById("sparringFlashOverlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "sparringFlashOverlay";
        ov.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;transition:opacity .3s;opacity:0;";
        document.body.appendChild(ov);
      }
      ov.style.background = color || "#ff1744";
      ov.style.opacity = String(opacity || 0.35);
      setTimeout(() => { ov.style.opacity = "0"; }, 120);
    }

    function showSparringReadyBanner() {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const b = document.createElement("div");
      b.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
        font-family:'Orbitron',monospace;font-size:clamp(18px,4vw,32px);font-weight:900;
        letter-spacing:4px;color:#f5c400;text-shadow:0 0 20px #f5c400,0 0 40px #ff6a00;
        pointer-events:none;z-index:60;animation:spawnDmgNum 2.5s forwards;text-align:center;line-height:1.4;`;
      b.innerHTML = "🥊 SPARRING INICIADO<br><span style='font-size:.55em;color:#ff7043;letter-spacing:2px'>¡DAÑO REAL ACTIVADO!</span>";
      hud.appendChild(b);
      setTimeout(() => b.remove(), 2500);
    }

    function showKoOverlay(attackerName) {
      let ov = document.getElementById("sparringKoOverlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "sparringKoOverlay";
        ov.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(60,0,0,.82);z-index:150;font-family:'Orbitron',monospace;text-align:center;";
        ov.innerHTML = `<div style="font-size:clamp(40px,10vw,80px);font-weight:900;color:#ff1744;text-shadow:0 0 40px #ff1744;letter-spacing:6px;margin-bottom:12px;">K.O.</div>
          <div id="sparringKoSub" style="font-size:clamp(12px,3vw,18px);color:#ff7043;letter-spacing:3px;margin-bottom:28px;"></div>
          <div style="font-size:11px;color:#8892b0;letter-spacing:2px;">RECUPERÁNDOTE EN 3 SEGUNDOS...</div>`;
        document.body.appendChild(ov);
      }
      const sub = ov.querySelector("#sparringKoSub");
      if (sub) sub.textContent = `Derrotado por ${attackerName || "???"}`;
      ov.style.display = "flex";
    }

    function hideKoOverlay() {
      const ov = document.getElementById("sparringKoOverlay");
      if (ov) ov.style.display = "none";
    }

    function injectSurrenderButton() {
      const hud = document.getElementById("hud");
      if (!hud || document.getElementById("sparringSurrenderBtn")) return;
      const btn = document.createElement("button");
      btn.id = "sparringSurrenderBtn";
      btn.textContent = "🏳 RENDIRSE";
      btn.style.cssText = `position:absolute;bottom:20px;left:50%;transform:translateX(calc(-50% - 80px));
        padding:10px 18px;background:rgba(255,23,68,.18);border:1px solid #ff1744;border-radius:8px;
        color:#ff5252;font-family:'Orbitron',monospace;font-size:9px;letter-spacing:2px;
        cursor:pointer;pointer-events:auto;z-index:20;display:none;touch-action:manipulation;`;
      btn.addEventListener("click", () => {
        const targetId = (G.selectedPlayerId && G.otherPlayers[G.selectedPlayerId])
          ? G.selectedPlayerId : getNearestPartyMember();
        if (targetId && G.mpConnected && G.myId) {
          G.db.ref("partyActions/" + targetId).set({ fromId:G.myId, fromName:G.player.name, type:"effect", anim:"attack_2", icon:"🏆", text:"GANA", t:Date.now() });
        }
        if (G.combatEffects) G.combatEffects.push({ x:G.player.x, y:G.player.y-52, text:"ME RINDO", timer:1.8, color:"#90a4ae" });
        if (G.csAnimator) G.csAnimator.play("hurt", () => { if (G.csAnimator) G.csAnimator.play("idle"); });
        broadcastMyAnim("hurt", 700);
        if (typeof window.showHudToast === "function") window.showHudToast("🏳 Te rendiste","info");
        if (typeof window.setControlMode === "function") window.setControlMode("partyFriendly");
      });
      hud.appendChild(btn);
    }

    function getNearestPartyMember() {
      const p = G.player;
      let best = null, bestDist = Infinity;
      for (const [id, op] of Object.entries(G.otherPlayers)) {
        if (!G.isPartyMember(id)) continue;
        const d = Math.hypot((op.x||0)-p.x, (op.y||0)-p.y);
        if (d < bestDist) { bestDist = d; best = id; }
      }
      return best;
    }

    function injectCSS() {
      if (document.getElementById("sparringPatchCSS")) return;
      const s = document.createElement("style");
      s.id = "sparringPatchCSS";
      s.textContent = `@keyframes spawnDmgNum{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1;transform:translateY(-14px) scale(1.2)}60%{opacity:1;transform:translateY(-30px) scale(1)}100%{opacity:0;transform:translateY(-55px) scale(.85)}}`;
      document.head.appendChild(s);
    }

    // ── Arranque ──────────────────────────────────────────────────────
    injectCSS();
    injectSurrenderButton();
    hookIncomingHits();
    listenRemoteAnims();   // ← clave del fix v1.1

    console.log("[sparring-patch v1.1] ✅ Animaciones sincronizadas");
  }

})();
