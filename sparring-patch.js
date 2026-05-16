/**
 * DRAGON WORLD Z — Sparring Patch v2.0
 * ══════════════════════════════════════════════════════
 * INSTALACIÓN: una sola línea al final de game.html, antes de </body>
 *   <script src="sparring-patch.js"></script>
 *
 * CAMBIOS v2.0:
 *  ✅ Fix definitivo de animaciones: parchea el listener de Firebase
 *     para que no pise "hurt"/"attack" con "idle" mientras están corriendo
 *  ✅ Daño real funcional: descuenta HP, actualiza barra, sincroniza por Firebase
 *  ✅ Flash de pantalla al recibir golpe
 *  ✅ Números flotantes de daño
 *  ✅ K.O. con overlay y respawn en 3s
 *  ✅ Canal playerAnims/ para sincronizar animaciones al instante
 *  ✅ Pelea real: Ki cost, stats STR/DEF, varianza de daño
 */

(function patchSparring() {
  "use strict";

  // ─── Esperar a que Firebase + player estén listos ──────────────────────────
  function waitForGame(cb, n) {
    n = n || 0;
    if (n > 200) return;
    if (
      window.db && window.myPlayerId &&
      window.player && window.player.maxHp > 0 &&
      window.otherPlayerAnimators !== undefined
    ) { cb(); return; }
    setTimeout(() => waitForGame(cb, n + 1), 150);
  }

  waitForGame(main);

  // ══════════════════════════════════════════════════════════════════════════
  function main() {

    // ── Proxy de acceso a globales (siempre frescos) ──────────────────────
    const G = {
      get db()          { return window.db; },
      get myId()        { return window.myPlayerId; },
      get player()      { return window.player; },
      get others()      { return window.otherPlayers; },
      get animators()   { return window.otherPlayerAnimators; },
      get effects()     { return window.combatEffects; },
      get myAnim()      { return window.csAnimator; },
      get cam()         { return window.cam; },
      get flying()      { return window.isFlying; },
      get inParty()     { return window.isPartyMember; },
      get selId()       { return window.selectedPlayerId; },
      set selId(v)      { window.selectedPlayerId = v; },
      get online()      { return window.mpConnected; },
    };

    // ── Config de combate ─────────────────────────────────────────────────
    const MOVES = {
      sparring: { dmgBase:0.08, dmgVar:0.04, ki:5,  label:"SPARRING!",  atk:"attack_1", color:"#f5c400" },
      ki_clash: { dmgBase:0.13, dmgVar:0.05, ki:20, label:"KI CLASH!!",  atk:"ki_charge",color:"#00e5ff" },
      gut_hit:  { dmgBase:0.11, dmgVar:0.03, ki:8,  label:"¡ESTOMAGO!", atk:"attack_1", color:"#ff7043" },
      face_hit: { dmgBase:0.10, dmgVar:0.06, ki:6,  label:"¡EN LA CARA!",atk:"attack_2",color:"#ff5252" },
    };
    const SELF_HIT = new Set(["take_gut","take_face","lose"]);

    // ── Anti-spam ─────────────────────────────────────────────────────────
    const cooldowns  = {};   // targetId → timestamp último golpe
    const COOLDOWN   = 700;  // ms

    // ── Protección de animaciones remotas ─────────────────────────────────
    // Por cada id remoto, guarda hasta cuándo NO debe interrumpirse su anim
    const animProtect = {};  // remoteId → timestamp

    const ONE_SHOT = new Set(["hurt","death","attack_1","attack_2","ki_charge","jump"]);

    // ── Flag local: bloquea sendPlayerUpdate de pisar mi "hurt" ──────────
    let myAnimLock = 0;  // timestamp

    let koInProgress = false;

    // ══════════════════════════════════════════════════════════════════════
    //  FIX DEFINITIVO: parchear el listeners de Firebase para animaciones
    //  El listener original (línea ~1131 de game.html):
    //    otherPlayerAnimators[id].play(data.animAction)
    //  lo interceptamos para que ONE_SHOT anims no sean interrumpidas.
    // ══════════════════════════════════════════════════════════════════════

    // Esperamos un tick para que initMultiplayer ya haya corrido y conectado
    setTimeout(patchFirebaseListener, 500);

    function patchFirebaseListener() {
      // Monkey-patch play() en todos los animators remotos existentes
      // y en los que se creen en el futuro
      const animatorsProxy = new Proxy(G.animators || {}, {});

      // En lugar de parchear Firebase directamente (que es difícil),
      // sobreescribimos el método play() de cada animator remoto
      // apenas se crea, con una versión que respeta el lock.
      const _origPlay = window.CharacterSystem?.SpriteAnimator?.prototype?.play;
      if (!_origPlay) return;

      // Guardamos una referencia al map de animators
      const animMap = window.otherPlayerAnimators;
      if (!animMap) return;

      // Cada vez que se lee animMap[id], si el animator existe y no tiene
      // nuestro patch, lo aplicamos
      function ensurePatched(id) {
        const anim = animMap[id];
        if (!anim || anim.__sparringPatched) return;
        anim.__sparringPatched = true;
        const origPlay = anim.play.bind(anim);
        anim.play = function(action, onComplete) {
          // Si hay protección activa y la nueva acción es "idle" o "walk",
          // ignorar — no interrumpir la animación de combate
          const now = Date.now();
          if (animProtect[id] && now < animProtect[id]) {
            if (!ONE_SHOT.has(action)) return anim; // ignorar idle/walk/run
          }
          return origPlay(action, onComplete);
        };
      }

      // Parchear todos los que ya existen
      Object.keys(animMap).forEach(ensurePatched);

      // Interceptar adición de nuevos animators con Proxy en el objeto
      // Nota: como no podemos usar Proxy en todos los motores,
      // hacemos polling liviano cada 2s
      setInterval(() => { Object.keys(window.otherPlayerAnimators || {}).forEach(ensurePatched); }, 2000);

      console.log("[sparring v2] ✅ Animators remotos parcheados");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  CANAL playerAnims/ — animaciones instantáneas
    // ══════════════════════════════════════════════════════════════════════

    function broadcastAnim(animName, durationMs) {
      if (!G.online || !G.myId) return;
      G.db.ref("playerAnims/" + G.myId).set({ anim: animName, t: Date.now() });
      setTimeout(() => G.db.ref("playerAnims/" + G.myId).remove(), (durationMs || 900) + 300);
    }

    function listenAnims() {
      function apply(snap) {
        const data = snap.val();
        const rid  = snap.key;
        if (!data || rid === G.myId) return;
        if (Date.now() - (data.t || 0) > 3000) return;

        const anim = data.anim || "idle";

        // Parchear si hace falta
        const animMap = window.otherPlayerAnimators || {};
        const animator = animMap[rid];
        if (!animator) return;
        if (!animator.__sparringPatched) {
          // Aplicar patch on-the-fly
          const orig = animator.play.bind(animator);
          animator.__sparringPatched = true;
          animator.play = function(action, cb) {
            const now = Date.now();
            if (animProtect[rid] && now < animProtect[rid] && !ONE_SHOT.has(action)) return animator;
            return orig(action, cb);
          };
        }

        // Calcular duración de la animación para el lock
        const CS = window.CharacterSystem;
        const meta = CS?.ACTIONS_META?.[anim];
        const durMs = meta ? Math.ceil((meta.frames / meta.fps) * 1000) : 900;

        if (ONE_SHOT.has(anim)) {
          animProtect[rid] = Date.now() + durMs + 200;
          // Forzar llamada directa al play original antes de que el patch bloquee
          const origPlay = animator.__origPlay || animator.play;
          // Usar la función base (sin el proxy de bloqueo) para ONE_SHOT entrante
          window.CharacterSystem.SpriteAnimator.prototype.play.call(
            animator, anim, () => {
              animProtect[rid] = 0;
              window.CharacterSystem.SpriteAnimator.prototype.play.call(animator, "idle");
            }
          );
        } else {
          animator.play(anim);
        }
      }
      G.db.ref("playerAnims").on("child_added",   apply);
      G.db.ref("playerAnims").on("child_changed",  apply);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  HOOK sendPlayerUpdate — protege mi "hurt" local
    // ══════════════════════════════════════════════════════════════════════

    const _origSend = window.sendPlayerUpdate;
    if (_origSend) {
      window.sendPlayerUpdate = function() {
        if (Date.now() < myAnimLock && G.online && G.myId && G.player) {
          const p = G.player;
          G.db.ref("players/" + G.myId).update({
            x: Math.floor(p.x), y: Math.floor(p.y),
            facing: p.facing, animAction: "hurt",
            hp: p.hp, ki: Math.floor(p.ki),
            map: window.currentMap, t: Date.now(),
          });
          return;
        }
        _origSend();
      };
    }

    // ══════════════════════════════════════════════════════════════════════
    //  DAÑO
    // ══════════════════════════════════════════════════════════════════════

    function calcDmg(moveId, atkStr, defDef, defMaxHp) {
      const m = MOVES[moveId] || MOVES.sparring;
      const v = (Math.random() * m.dmgVar * 2) - m.dmgVar;
      const f = Math.max(0.5, Math.min(2.5, atkStr / Math.max(1, defDef)));
      return Math.max(1, Math.round(defMaxHp * (m.dmgBase + v) * f));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  RECIBIR GOLPE (soy el objetivo)
    // ══════════════════════════════════════════════════════════════════════

    function takeDamage(dmg, moveId, fromName) {
      const p = G.player;
      if (!p || koInProgress) return;

      p.hp = Math.max(0, p.hp - dmg);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // Número flotante de daño en canvas
      if (G.cam) {
        const cx = p.x - G.cam.x;
        const cy = p.y - G.cam.y - 55;
        spawnNum(cx, cy, dmg, MOVES[moveId]?.color || "#ff1744");
      }

      // combatEffects
      push(p.x, p.y - 58, `-${dmg}`, "#ff1744", 1.6);
      push(p.x, p.y - 38, `${fromName || "???"} GOLPEA`, "#ffab91", 1.0);

      // Mi animación de hurt (local)
      const HURT_DUR = 850;
      myAnimLock = Date.now() + HURT_DUR;
      playMine("hurt", () => { myAnimLock = 0; playMine(G.flying ? "fly" : "idle"); });

      // Broadcast para que el atacante me vea haciendo hurt
      broadcastAnim("hurt", HURT_DUR);

      // Publicar HP + animAction en Firebase de inmediato
      if (G.online && G.myId) {
        G.db.ref("players/" + G.myId).update({ animAction:"hurt", hp:p.hp, t:Date.now() });
      }

      screenFlash("#ff1744", 0.4);
      toast(`💥 -${dmg} HP`, "dmg");

      if (p.hp <= 0) ko(fromName);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  K.O.
    // ══════════════════════════════════════════════════════════════════════

    function ko(fromName) {
      koInProgress = true;
      const p = G.player;
      playMine("death");
      broadcastAnim("death", 1500);
      if (G.online && G.myId) {
        G.db.ref("chat").push().set({
          id:G.myId, name:"SISTEMA",
          text:`💀 ${p.name} fue noqueado por ${fromName||"???"} en el sparring.`,
          t:Date.now(),
        });
        G.db.ref("players/" + G.myId).update({ animAction:"death", t:Date.now() });
      }
      showKO(fromName);
      setTimeout(() => {
        p.hp = Math.floor(p.maxHp * 0.35);
        koInProgress = false;
        myAnimLock = 0;
        hideKO();
        playMine("idle");
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        if (G.online && G.myId) G.db.ref("players/" + G.myId).update({ hp:p.hp, animAction:"idle", t:Date.now() });
        toast("⚡ Recuperado (35% HP)", "xp");
      }, 3000);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ENVIAR GOLPE
    // ══════════════════════════════════════════════════════════════════════

    function sendHit(targetId, moveId, dmg) {
      if (!G.online || !G.myId) return;
      const now = Date.now();
      if (cooldowns[targetId] && now - cooldowns[targetId] < COOLDOWN) return;
      cooldowns[targetId] = now;
      G.db.ref("partyActions/" + targetId).set({
        fromId: G.myId, fromName: G.player.name,
        type: "sparringHit", moveId, dmg,
        atkStr: G.player.strength,
        atkAnim: MOVES[moveId]?.atk || "attack_1",
        t: now,
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  LISTENER GOLPES ENTRANTES (partyActions)
    // ══════════════════════════════════════════════════════════════════════

    function hookIncoming() {
      if (!G.myId) return;
      G.db.ref("partyActions/" + G.myId).on("value", snap => {
        const act = snap.val();
        if (!act || act.fromId === G.myId) return;

        if (act.type === "sparringHit") {
          takeDamage(act.dmg || 1, act.moveId || "sparring", act.fromName || "???");
          G.db.ref("partyActions/" + G.myId).remove();
          return;
        }

        // ── Comportamiento original ───────────────────────────────────
        const p = G.player;
        if (act.type === "pushBack") {
          p.x += Number(act.dx) || 0;
          push(p.x, p.y - 44, act.text || "PIERDE", "#ff5252", 1.3);
        } else {
          push(p.x, p.y - 50, act.icon || "✨", "#f5c400", 1.2);
          push(p.x, p.y - 32, act.text || "PARTY", "#00e5ff", 1.0);
        }
        const ha = act.anim || "hurt";
        playMine(ha, () => playMine(G.flying ? "fly" : "idle"));
        broadcastAnim(ha, 900);
        G.db.ref("partyActions/" + G.myId).remove();
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE performPartyAction
    // ══════════════════════════════════════════════════════════════════════

    const _origParty = window.performPartyAction;

    window.performPartyAction = function(moveId) {
      const mv = MOVES[moveId];
      const isSelf = SELF_HIT.has(moveId);

      // Delegar acciones que no son de combate
      if (!mv && !isSelf) {
        if (_origParty) return _origParty(moveId);
        return;
      }

      // Buscar objetivo
      const targetId = (G.selId && G.others[G.selId]) ? G.selId : nearestPartyMember();
      if (!targetId || !G.others[targetId]) {
        toast("Seleccioná un miembro de party", "info"); return;
      }
      if (!G.inParty(targetId)) {
        toast("Solo funciona en party", "dmg"); return;
      }
      G.selId = targetId;
      const p = G.player, tgt = G.others[targetId];
      const midX = (p.x + (tgt.x || p.x)) / 2;
      const midY = (p.y + (tgt.y || p.y)) / 2;

      // ── Acción de recibir (yo pulso "recibir") ─────────────────────
      if (isSelf) {
        const fd = Math.max(1, Math.round(p.maxHp * 0.09 * (0.75 + Math.random() * 0.5)));
        takeDamage(fd, "sparring", tgt.name || "???");
        return;
      }

      // ── Verificar Ki ───────────────────────────────────────────────
      if (p.ki < mv.ki) { toast(`⚡ Ki insuficiente (necesitás ${mv.ki})`, "info"); return; }
      p.ki = Math.max(0, p.ki - mv.ki);
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();

      // ── Calcular daño ──────────────────────────────────────────────
      const dmg = calcDmg(moveId, p.strength, tgt.defense || 80, tgt.maxHp || 500);

      // ── Efectos visuales del atacante ──────────────────────────────
      push(midX, midY - 62, `-${dmg}`, "#ff1744", 1.7);
      push(midX, midY - 40, mv.label,   mv.color,   1.1);

      // Número flotante en canvas (posición del objetivo)
      if (G.cam) {
        const tx = (tgt.x || p.x) - G.cam.x;
        const ty = (tgt.y || p.y) - G.cam.y - 55;
        spawnNum(tx, ty, dmg, mv.color);
      }

      // ── MI animación de ataque ─────────────────────────────────────
      playMine(mv.atk, () => playMine(G.flying ? "fly" : "idle"));
      broadcastAnim(mv.atk, 700);

      // Actualizar mi nodo en Firebase con la animación de ataque
      if (G.online && G.myId) {
        G.db.ref("players/" + G.myId).update({ animAction: mv.atk, t: Date.now() });
      }

      // Flash leve del atacante
      screenFlash(mv.color, 0.12);
      toast(`${mv.label} → -${dmg} HP`, "xp");

      // ── Enviar golpe al objetivo ───────────────────────────────────
      sendHit(targetId, moveId, dmg);
    };

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE acceptPartyInvite → entra en partyCombat automáticamente
    // ══════════════════════════════════════════════════════════════════════

    const _origAccept = window.acceptPartyInvite;
    window.acceptPartyInvite = function() {
      if (_origAccept) _origAccept();
      setTimeout(() => {
        if (typeof window.setControlMode === "function") {
          window.setControlMode("partyCombat");
          banner();
        }
      }, 400);
    };

    // ══════════════════════════════════════════════════════════════════════
    //  OVERRIDE setControlMode → mostrar/ocultar botón rendirse
    // ══════════════════════════════════════════════════════════════════════

    const _origMode = window.setControlMode;
    window.setControlMode = function(mode) {
      if (_origMode) _origMode(mode);
      const btn = document.getElementById("spSurrenderBtn");
      if (btn) btn.style.display = mode === "partyCombat" ? "block" : "none";
    };

    // ══════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════════════════════

    function playMine(anim, cb) {
      if (G.myAnim) G.myAnim.play(anim, cb || null);
    }

    function push(x, y, text, color, timer) {
      const ef = G.effects;
      if (ef) ef.push({ x, y, text, color, timer: timer || 1.2 });
    }

    function toast(msg, type) {
      if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
    }

    function nearestPartyMember() {
      const p = G.player;
      let best = null, bestD = Infinity;
      for (const [id, op] of Object.entries(G.others)) {
        if (!G.inParty(id)) continue;
        const d = Math.hypot((op.x||0)-p.x, (op.y||0)-p.y);
        if (d < bestD) { bestD = d; best = id; }
      }
      return best;
    }

    // ── Número flotante DOM ───────────────────────────────────────────────
    function spawnNum(cx, cy, dmg, color) {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const el = document.createElement("div");
      el.textContent = `-${dmg}`;
      el.style.cssText = `position:absolute;left:${cx-28}px;top:${cy}px;
        font-family:'Orbitron',monospace;font-size:26px;font-weight:900;
        color:${color||"#ff1744"};pointer-events:none;z-index:50;
        text-shadow:0 0 12px ${color||"#ff1744"},0 2px 0 rgba(0,0,0,.9);
        animation:spDmgNum 1.5s forwards;`;
      hud.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }

    // ── Flash pantalla ────────────────────────────────────────────────────
    function screenFlash(color, opacity) {
      let ov = document.getElementById("spFlash");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "spFlash";
        ov.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;transition:opacity .28s;opacity:0;";
        document.body.appendChild(ov);
      }
      ov.style.background = color || "#ff1744";
      ov.style.opacity = String(opacity || 0.35);
      setTimeout(() => { ov.style.opacity = "0"; }, 110);
    }

    // ── Banner de sparring iniciado ───────────────────────────────────────
    function banner() {
      const hud = document.getElementById("hud");
      if (!hud) return;
      const b = document.createElement("div");
      b.style.cssText = `position:absolute;top:50%;left:50%;
        transform:translate(-50%,-50%);z-index:60;pointer-events:none;
        font-family:'Orbitron',monospace;font-size:clamp(20px,5vw,36px);
        font-weight:900;letter-spacing:4px;color:#f5c400;text-align:center;
        text-shadow:0 0 24px #f5c400,0 0 48px #ff6a00;line-height:1.4;
        animation:spDmgNum 3s forwards;`;
      b.innerHTML = "🥊 SPARRING INICIADO<br><span style='font-size:.52em;color:#ff7043;letter-spacing:2px'>¡DAÑO REAL ACTIVADO!</span>";
      hud.appendChild(b);
      setTimeout(() => b.remove(), 3000);
    }

    // ── K.O. overlay ─────────────────────────────────────────────────────
    function showKO(fromName) {
      let ov = document.getElementById("spKO");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "spKO";
        ov.style.cssText = `position:fixed;inset:0;display:flex;flex-direction:column;
          align-items:center;justify-content:center;background:rgba(50,0,0,.85);
          z-index:200;font-family:'Orbitron',monospace;text-align:center;`;
        ov.innerHTML = `<div style="font-size:clamp(48px,12vw,90px);font-weight:900;color:#ff1744;
            text-shadow:0 0 48px #ff1744;letter-spacing:8px;margin-bottom:14px;">K.O.</div>
          <div id="spKOSub" style="font-size:clamp(13px,3vw,20px);color:#ff7043;
            letter-spacing:3px;margin-bottom:30px;"></div>
          <div style="font-size:11px;color:#8892b0;letter-spacing:2px;">
            RECUPERÁNDOTE EN 3 SEGUNDOS...</div>`;
        document.body.appendChild(ov);
      }
      const sub = ov.querySelector("#spKOSub");
      if (sub) sub.textContent = `Derrotado por ${fromName || "???"}`;
      ov.style.display = "flex";
    }

    function hideKO() {
      const ov = document.getElementById("spKO");
      if (ov) ov.style.display = "none";
    }

    // ── Botón Rendirse ────────────────────────────────────────────────────
    function injectSurrender() {
      const hud = document.getElementById("hud");
      if (!hud || document.getElementById("spSurrenderBtn")) return;
      const btn = document.createElement("button");
      btn.id = "spSurrenderBtn";
      btn.textContent = "🏳 RENDIRSE";
      btn.style.cssText = `position:absolute;bottom:20px;left:50%;
        transform:translateX(calc(-50% - 90px));padding:11px 20px;
        background:rgba(255,23,68,.2);border:1px solid #ff1744;border-radius:8px;
        color:#ff5252;font-family:'Orbitron',monospace;font-size:9px;
        letter-spacing:2px;cursor:pointer;pointer-events:auto;
        z-index:20;display:none;touch-action:manipulation;`;
      btn.onclick = () => {
        const tid = (G.selId && G.others[G.selId]) ? G.selId : nearestPartyMember();
        if (tid && G.online && G.myId) {
          G.db.ref("partyActions/" + tid).set({
            fromId:G.myId, fromName:G.player.name,
            type:"effect", anim:"attack_2", icon:"🏆", text:"GANA", t:Date.now(),
          });
        }
        push(G.player.x, G.player.y - 52, "ME RINDO", "#90a4ae", 1.8);
        playMine("hurt", () => playMine("idle"));
        broadcastAnim("hurt", 800);
        toast("🏳 Te rendiste", "info");
        if (typeof window.setControlMode === "function") window.setControlMode("partyFriendly");
      };
      hud.appendChild(btn);
    }

    // ── CSS ───────────────────────────────────────────────────────────────
    function injectCSS() {
      if (document.getElementById("spCSS")) return;
      const s = document.createElement("style");
      s.id = "spCSS";
      s.textContent = `
        @keyframes spDmgNum {
          0%   { opacity:0; transform:translateY(0)    scale(.5);  }
          12%  { opacity:1; transform:translateY(-18px) scale(1.3); }
          55%  { opacity:1; transform:translateY(-35px) scale(1.0); }
          100% { opacity:0; transform:translateY(-65px) scale(.8);  }
        }
      `;
      document.head.appendChild(s);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  ARRANQUE
    // ══════════════════════════════════════════════════════════════════════
    injectCSS();
    injectSurrender();
    hookIncoming();
    listenAnims();

    console.log("[sparring v2.0] ✅ Sistema de combate real activo");
  }

})();
