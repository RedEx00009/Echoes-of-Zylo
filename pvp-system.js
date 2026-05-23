/**
 * DRAGON WORLD Z — Party + PvP Challenge + Real-time Combat
 * Firebase: parties/, partyInvites/, pvpChallenge/, combatAnims/
 */
(function () {
  "use strict";

  const MAX_PARTY = 6;
  const HIT_RANGE = 92;
  const ATK_COOLDOWN_MS = 380;
  const BLOCK_REDUCE = 0.22;
  const MUTUAL_END_NEEDED = 2;

  const ATTACKS = {
    light:   { anim: "light_combo",  ki: 0,  dmgBase: 0.06, dmgVar: 0.02, label: "GOLPE LIGERO", color: "#f5c400" },
    heavy:   { anim: "heavy_combo",  ki: 8,  dmgBase: 0.11, dmgVar: 0.03, label: "GOLPE PESADO", color: "#ff7043" },
    special: { anim: "special",      ki: 18, dmgBase: 0.15, dmgVar: 0.04, label: "ESPECIAL",     color: "#00e5ff" },
    dash:    { anim: "dash_rush",    ki: 4,  dmgBase: 0,    dmgVar: 0,    label: "DASH",         color: "#b0bec5", move: 72 },
    jump:    { anim: "dash_rush",    ki: 3,  dmgBase: 0,    dmgVar: 0,    label: "SALTO",        color: "#c8cfe8", move: 0, jump: 38 },
  };

  const ANIM_DUR = {
    light_combo: 750, heavy_combo: 550, special: 800, block: 400,
    hit: 850, knockback: 900, dash_rush: 500, recovery: 600, fly_combat: 300, combat_idle: 200,
  };

  const COMBAT_ANIMS = new Set(Object.values(ATTACKS).map((a) => a.anim).concat(["block", "hit", "knockback", "recovery"]));

  let myPartyId = null;
  let partyMembers = {};
  let activeChallenge = null;
  let challengeListener = null;
  let partyListener = null;
  let inviteListener = null;
  let lastHitSeq = 0;
  let atkCooldownUntil = 0;
  let isBlocking = false;
  let koInProgress = false;
  let myLockUntil = 0;
  let myLockAnim = "combat_idle";
  let animProtect = {};
  let selectedMemberId = null;

  const G = {
    get db() { return window.db; },
    get myId() { return window.myPlayerId; },
    get player() { return window.player; },
    get others() { return window.otherPlayers || {}; },
    get animators() { return window.otherPlayerAnimators || {}; },
    get effects() { return window.combatEffects || []; },
    get myAnim() { return window.csAnimator; },
    get cam() { return window.cam; },
    get flying() { return window.isFlying; },
    get map() { return window.currentMap; },
    get online() { return window.mpConnected; },
  };

  function waitForGame(cb, n) {
    n = n || 0;
    if (n > 400) return;
    if (window.db && window.myPlayerId && window.player && window.player.maxHp > 0) {
      cb();
      return;
    }
    setTimeout(() => waitForGame(cb, n + 1), 120);
  }

  function toast(msg, type) {
    if (typeof window.showHudToast === "function") window.showHudToast(msg, type || "info");
  }

  function push(x, y, text, color, timer) {
    if (window.combatEffects) {
      window.combatEffects.push({ x, y, text, color: color || "#f5c400", timer: timer || 1.2 });
    }
  }

  function spawnNum(sx, sy, val, color) {
    const el = document.createElement("div");
    el.className = "pvp-dmg-num";
    el.textContent = "-" + val;
    el.style.cssText = `left:${sx}px;top:${sy}px;color:${color || "#ff1744"}`;
    document.getElementById("pvpFxLayer")?.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  function isPartyMember(id) {
    return !!(id && id !== G.myId && partyMembers[id]);
  }

  function getPartyMemberIds() {
    return Object.keys(partyMembers).filter((id) => id !== G.myId);
  }

  function isFighter() {
    if (!activeChallenge || activeChallenge.status !== "active") return false;
    return activeChallenge.challengerId === G.myId || activeChallenge.targetId === G.myId;
  }

  function isSpectator() {
    if (!activeChallenge || activeChallenge.status !== "active") return false;
    if (isFighter()) return false;
    return !!(myPartyId && activeChallenge.partyId === myPartyId);
  }

  function opponentId() {
    if (!activeChallenge) return null;
    return activeChallenge.challengerId === G.myId ? activeChallenge.targetId : activeChallenge.challengerId;
  }

  function calcDamage(atkType, atkStr, defDef, defMaxHp) {
    const m = ATTACKS[atkType] || ATTACKS.light;
    if (!m.dmgBase) return 0;
    const v = Math.random() * m.dmgVar * 2 - m.dmgVar;
    const f = Math.max(0.5, Math.min(2.5, atkStr / Math.max(1, defDef)));
    return Math.max(1, Math.round(defMaxHp * (m.dmgBase + v) * f));
  }

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function facingAttacker(defFacing, defX, atkX) {
    return (defFacing > 0 && atkX > defX) || (defFacing < 0 && atkX < defX);
  }

  // ── UI ──────────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById("pvpSysCSS")) return;
    const s = document.createElement("style");
    s.id = "pvpSysCSS";
    s.textContent = `
      #partyPanel,#pvpChallengeModal{position:fixed;z-index:140;pointer-events:auto;background:rgba(8,9,15,.95);border:1px solid #2a3560;border-radius:10px;backdrop-filter:blur(12px);font-family:Rajdhani,sans-serif;color:#e8eaf6}
      #partyPanel{top:72px;right:12px;width:min(260px,90vw);max-height:50vh;display:none;flex-direction:column}
      #partyPanel.open{display:flex}
      .pvp-hdr{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #2a3560}
      .pvp-hdr-t{font-family:Orbitron,monospace;font-size:10px;letter-spacing:2px;color:#f5c400}
      .pvp-close{background:none;border:none;color:#8892b0;font-size:16px;cursor:pointer}
      .pvp-body{padding:10px 12px;overflow-y:auto;flex:1}
      .pvp-member{display:flex;align-items:center;gap:8px;padding:8px;margin-bottom:6px;border:1px solid #2a3560;border-radius:6px;cursor:pointer}
      .pvp-member:hover,.pvp-member.sel{border-color:#f5c400;background:rgba(245,196,0,.08)}
      .pvp-member-name{flex:1;font-size:13px}
      .pvp-btn{width:100%;padding:9px;margin-top:6px;border-radius:6px;border:1px solid rgba(245,196,0,.3);background:rgba(245,196,0,.12);color:#fff;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer}
      .pvp-btn.danger{border-color:rgba(255,23,68,.4);background:rgba(255,23,68,.15)}
      .pvp-btn.primary{border-color:rgba(0,229,255,.5);background:rgba(0,229,255,.12)}
      #pvpChallengeModal{top:50%;left:50%;transform:translate(-50%,-50%);width:min(320px,92vw);display:none;flex-direction:column}
      #pvpChallengeModal.open{display:flex}
      .pvp-modal-text{font-size:14px;line-height:1.5;margin:12px 0;color:#c8cfe8}
      .pvp-modal-btns{display:flex;gap:8px;margin-top:8px}
      .pvp-modal-btns .pvp-btn{flex:1;margin:0}
      #pvpNotify{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:145;display:none;padding:10px 16px;background:rgba(255,23,68,.2);border:1px solid #ff5252;border-radius:8px;font-family:Orbitron,monospace;font-size:10px;color:#fff;pointer-events:auto;cursor:pointer}
      #pvpNotify.open{display:block}
      #pvpArenaBanner{position:fixed;top:50%;left:50%;transform:translate(-50%,-120%);z-index:50;pointer-events:none;font-family:Orbitron,monospace;font-size:11px;letter-spacing:3px;color:#f5c400;text-shadow:0 0 12px #f5c400;opacity:0;transition:opacity .4s}
      #pvpArenaBanner.show{opacity:1}
      #pvpFxLayer{position:fixed;inset:0;pointer-events:none;z-index:95}
      .pvp-dmg-num{position:absolute;font-family:Orbitron,monospace;font-size:18px;font-weight:bold;animation:pvpDmgFloat .9s forwards;pointer-events:none;text-shadow:0 0 8px currentColor}
      @keyframes pvpDmgFloat{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-40px) scale(1.2)}}
      #pvpEndBar{position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:130;display:none;gap:8px;pointer-events:auto}
      #pvpEndBar.open{display:flex}
    `;
    document.head.appendChild(s);
  }

  function injectUI() {
    injectStyles();
    if (document.getElementById("partyPanel")) return;

    const fx = document.createElement("div");
    fx.id = "pvpFxLayer";
    document.body.appendChild(fx);

    const banner = document.createElement("div");
    banner.id = "pvpArenaBanner";
    banner.textContent = "⚔️ DUELO PvP";
    document.body.appendChild(banner);

    const notify = document.createElement("div");
    notify.id = "pvpNotify";
    notify.onclick = () => openChallengeModal();
    document.body.appendChild(notify);

    const panel = document.createElement("div");
    panel.id = "partyPanel";
    panel.innerHTML = `
      <div class="pvp-hdr"><span class="pvp-hdr-t">👥 PARTY</span><button class="pvp-close" type="button" id="partyPanelClose">✕</button></div>
      <div class="pvp-body" id="partyMemberList"></div>
      <div style="padding:0 12px 12px">
        <button class="pvp-btn primary" type="button" id="partyInviteBtn">📨 INVITAR JUGADOR CERCANO</button>
        <button class="pvp-btn" type="button" id="partyChallengeBtn">⚔️ DESAFIAR A COMBATE</button>
        <button class="pvp-btn danger" type="button" id="partyLeaveBtn">SALIR DE PARTY</button>
      </div>`;
    document.body.appendChild(panel);

    const modal = document.createElement("div");
    modal.id = "pvpChallengeModal";
    modal.innerHTML = `
      <div class="pvp-hdr"><span class="pvp-hdr-t" id="pvpModalTitle">DESAFÍO</span><button class="pvp-close" type="button" id="pvpModalClose">✕</button></div>
      <div class="pvp-body">
        <div class="pvp-modal-text" id="pvpModalText"></div>
        <div class="pvp-modal-btns" id="pvpModalBtns"></div>
      </div>`;
    document.body.appendChild(modal);

    const endBar = document.createElement("div");
    endBar.id = "pvpEndBar";
    endBar.innerHTML = `<button class="pvp-btn" type="button" id="pvpMutualEndBtn">🤝 PEDIR FIN DEL COMBATE</button>`;
    document.body.appendChild(endBar);

    document.getElementById("partyPanelClose").onclick = () => panel.classList.remove("open");
    document.getElementById("pvpModalClose").onclick = closeChallengeModal;
    document.getElementById("partyInviteBtn").onclick = inviteNearestPlayer;
    document.getElementById("partyChallengeBtn").onclick = sendChallengeToSelected;
    document.getElementById("partyLeaveBtn").onclick = leaveParty;
    document.getElementById("pvpMutualEndBtn").onclick = requestMutualEnd;
  }

  function togglePartyPanel() {
    document.getElementById("partyPanel")?.classList.toggle("open");
    renderPartyList();
  }

  function renderPartyList() {
    const list = document.getElementById("partyMemberList");
    if (!list) return;
    const me = G.player;
    let html = `<div class="pvp-member"><span class="pvp-member-name">🟢 ${me?.name || "Tú"} (tú)</span></div>`;
    getPartyMemberIds().forEach((id) => {
      const m = partyMembers[id];
      const name = m?.name || G.others[id]?.name || id.slice(0, 10);
      const sel = selectedMemberId === id ? " sel" : "";
      html += `<div class="pvp-member${sel}" data-id="${id}"><span class="pvp-member-name">${name}</span></div>`;
    });
    if (!getPartyMemberIds().length) {
      html += `<div style="font-size:12px;color:#4a5880;text-align:center;padding:8px">Sin miembros — invitá a alguien cercano</div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll(".pvp-member[data-id]").forEach((el) => {
      el.onclick = () => {
        selectedMemberId = el.getAttribute("data-id");
        renderPartyList();
      };
    });
  }

  function showNotify(text) {
    const n = document.getElementById("pvpNotify");
    if (!n) return;
    n.textContent = text;
    n.classList.add("open");
  }

  function hideNotify() {
    document.getElementById("pvpNotify")?.classList.remove("open");
  }

  let pendingChallenge = null;

  function openChallengeModal() {
    if (!pendingChallenge) return;
    const modal = document.getElementById("pvpChallengeModal");
    const text = document.getElementById("pvpModalText");
    const btns = document.getElementById("pvpModalBtns");
    document.getElementById("pvpModalTitle").textContent = "⚔️ DESAFÍO PvP";
    text.textContent = `${pendingChallenge.challengerName} te desafía a combate. ¿Aceptás?`;
    btns.innerHTML = `
      <button class="pvp-btn primary" type="button" id="pvpAcceptBtn">✓ ACEPTAR</button>
      <button class="pvp-btn danger" type="button" id="pvpDeclineBtn">✕ RECHAZAR</button>`;
    document.getElementById("pvpAcceptBtn").onclick = () => acceptChallenge(pendingChallenge.id);
    document.getElementById("pvpDeclineBtn").onclick = () => declineChallenge(pendingChallenge.id);
    modal.classList.add("open");
    hideNotify();
  }

  function closeChallengeModal() {
    document.getElementById("pvpChallengeModal")?.classList.remove("open");
  }

  // ── Party Firebase ───────────────────────────────────────────────────

  function ensurePartyId() {
    if (myPartyId) return myPartyId;
    myPartyId = "party_" + G.myId;
    return myPartyId;
  }

  function listenParty() {
    if (!G.db || !G.myId) return;
    if (partyListener) partyListener.off();
    partyListener = G.db.ref("parties");
    partyListener.on("value", (snap) => {
      const all = snap.val() || {};
      myPartyId = null;
      partyMembers = {};
      for (const [pid, party] of Object.entries(all)) {
        if (party?.members?.[G.myId]) {
          myPartyId = pid;
          partyMembers = { ...party.members };
          delete partyMembers[G.myId];
          break;
        }
      }
      renderPartyList();
    });
  }

  function listenInvites() {
    if (!G.db || !G.myId) return;
    if (inviteListener) inviteListener.off();
    inviteListener = G.db.ref("partyInvites/" + G.myId);
    inviteListener.on("value", (snap) => {
      const inv = snap.val();
      if (!inv || !inv.partyId) return;
      toast(`${inv.fromName} te invita a su party`, "info");
      if (confirm(`${inv.fromName} te invita a la party. ¿Aceptar?`)) {
        joinParty(inv.partyId, inv.fromId);
        snap.ref.remove();
      } else {
        snap.ref.remove();
      }
    });
  }

  function inviteNearestPlayer() {
    if (!G.online || !G.myId) return toast("Conectate al servidor primero", "dmg");
    const p = G.player;
    let best = null;
    let bestD = 220;
    for (const [id, op] of Object.entries(G.others)) {
      if (op.map && op.map !== G.map) continue;
      const d = dist(p.x, p.y, op.x, op.y);
      if (d < bestD) {
        bestD = d;
        best = { id, name: op.name || "Jugador" };
      }
    }
    if (!best) return toast("No hay jugadores cerca", "dmg");
    const partyId = ensurePartyId();
    const members = { [G.myId]: { name: p.name, t: Date.now() } };
    G.db.ref("parties/" + partyId).transaction((cur) => {
      if (!cur) return { leaderId: G.myId, members, createdAt: Date.now() };
      cur.members = cur.members || {};
      cur.members[G.myId] = { name: p.name, t: Date.now() };
      return cur;
    });
    G.db.ref("partyInvites/" + best.id).set({
      partyId,
      fromId: G.myId,
      fromName: p.name,
      t: Date.now(),
    });
    toast(`Invitación enviada a ${best.name}`, "info");
  }

  function joinParty(partyId, leaderId) {
    const p = G.player;
    G.db.ref("parties/" + partyId + "/members/" + G.myId).set({ name: p.name, t: Date.now() });
    myPartyId = partyId;
    toast("Entraste a la party", "info");
  }

  function leaveParty() {
    if (!myPartyId || !G.db) return;
    G.db.ref("parties/" + myPartyId + "/members/" + G.myId).remove();
    myPartyId = null;
    partyMembers = {};
    selectedMemberId = null;
    renderPartyList();
    toast("Saliste de la party", "info");
  }

  // ── PvP Challenge ────────────────────────────────────────────────────

  function listenChallenges() {
    if (!G.db) return;
    if (challengeListener) challengeListener.off();
    challengeListener = G.db.ref("pvpChallenge");
    challengeListener.on("value", (snap) => {
      const all = snap.val() || {};
      let mine = null;
      let pending = null;
      const now = Date.now();
      for (const [id, ch] of Object.entries(all)) {
        if (!ch || now - (ch.t || 0) > 300000) continue;
        if (ch.challengerId === G.myId || ch.targetId === G.myId) mine = { ...ch, id };
        if (ch.targetId === G.myId && ch.status === "pending") pending = { ...ch, id };
        if (myPartyId && ch.partyId === myPartyId && ch.status === "active") {
          if (ch.challengerId !== G.myId && ch.targetId !== G.myId) mine = { ...ch, id };
        }
      }
      if (pending && pending.id !== pendingChallenge?.id) {
        pendingChallenge = pending;
        showNotify(`⚔️ ${pending.challengerName} te desafía — clic para responder`);
      }
      const prevStatus = activeChallenge?.status;
      activeChallenge = mine;
      onChallengeStateChange(prevStatus);
    });
  }

  function onChallengeStateChange(prevStatus) {
    const ch = activeChallenge;
    const banner = document.getElementById("pvpArenaBanner");
    const endBar = document.getElementById("pvpEndBar");

    if (!ch || ch.status === "finished" || ch.status === "declined" || ch.status === "cancelled") {
      if (prevStatus === "active") endDuelLocal(ch);
      banner?.classList.remove("show");
      endBar?.classList.remove("open");
      if (ch?.status === "finished" && ch.winnerId) {
        const won = ch.winnerId === G.myId;
        toast(won ? "🏆 ¡GANASTE EL DUELO!" : "Perdiste el duelo", won ? "lvl" : "dmg");
      }
      if (ch?.status === "declined") toast("Desafío rechazado", "info");
      return;
    }

    if (ch.status === "pending") {
      if (ch.challengerId === G.myId) toast("Esperando respuesta del desafío...", "info");
      return;
    }

    if (ch.status === "active") {
      banner?.classList.add("show");
      syncHealthFromChallenge(ch);
      if (isFighter()) {
        enterDuelFighter(ch);
        endBar?.classList.add("open");
      } else if (isSpectator()) {
        enterDuelSpectator(ch);
        endBar?.classList.remove("open");
      }
    }
  }

  function syncHealthFromChallenge(ch) {
    const hp = ch.health?.[G.myId];
    if (hp != null && isFighter() && G.player) {
      G.player.hp = hp;
      if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
    }
  }

  function sendChallengeToSelected() {
    if (!selectedMemberId || !isPartyMember(selectedMemberId)) {
      return toast("Seleccioná un miembro de la party", "dmg");
    }
    if (!myPartyId) return toast("Creá o unite a una party primero", "dmg");
    if (activeChallenge && activeChallenge.status === "active") {
      return toast("Ya hay un duelo activo", "dmg");
    }
    const targetId = selectedMemberId;
    const p = G.player;
    const tgt = G.others[targetId];
    const id = "ch_" + G.myId + "_" + targetId + "_" + Date.now();
    const midX = Math.floor((p.x + (tgt?.x || p.x)) / 2);
    const midY = Math.floor((p.y + (tgt?.y || p.y)) / 2);
    const tgtMax = tgt?.maxHp || 100;
    G.db.ref("pvpChallenge/" + id).set({
      partyId: myPartyId,
      challengerId: G.myId,
      challengerName: p.name,
      targetId,
      targetName: tgt?.name || partyMembers[targetId]?.name || "Rival",
      status: "pending",
      map: G.map,
      arenaX: midX,
      arenaY: midY,
      health: { [G.myId]: p.maxHp, [targetId]: tgtMax },
      maxHealth: { [G.myId]: p.maxHp, [targetId]: tgtMax },
      endVotes: {},
      winnerId: null,
      endedReason: null,
      lastHitSeq: 0,
      t: Date.now(),
    });
    toast("Desafío enviado", "info");
  }

  function acceptChallenge(challengeId) {
    if (!G.db) return;
    const p = G.player;
    const ref = G.db.ref("pvpChallenge/" + challengeId);
    ref.once("value", (snap) => {
      const ch = snap.val();
      if (!ch || ch.status !== "pending" || ch.targetId !== G.myId) return;
      const maxH = { [ch.challengerId]: ch.maxHealth?.[ch.challengerId] || 100, [ch.targetId]: p.maxHp };
      const health = { [ch.challengerId]: maxH[ch.challengerId], [ch.targetId]: p.maxHp };
      const op = G.others[ch.challengerId];
      ref.update({
        status: "active",
        startedAt: Date.now(),
        maxHealth: {
          [ch.challengerId]: op?.maxHp || maxH[ch.challengerId],
          [ch.targetId]: p.maxHp,
        },
        health,
        t: Date.now(),
      });
      closeChallengeModal();
      pendingChallenge = null;
      toast("¡Duelo iniciado!", "lvl");
    });
  }

  function declineChallenge(challengeId) {
    G.db.ref("pvpChallenge/" + challengeId).update({ status: "declined", t: Date.now() });
    closeChallengeModal();
    pendingChallenge = null;
    toast("Desafío rechazado", "info");
  }

  function requestMutualEnd() {
    if (!activeChallenge || !isFighter()) return;
    const votes = { ...(activeChallenge.endVotes || {}) };
    votes[G.myId] = true;
    G.db.ref("pvpChallenge/" + activeChallenge.id).update({ endVotes: votes, t: Date.now() });
    toast("Pediste terminar el combate", "info");
    checkMutualEnd(votes);
  }

  function checkMutualEnd(votes) {
    if (!activeChallenge) return;
    const a = activeChallenge.challengerId;
    const b = activeChallenge.targetId;
    if (votes[a] && votes[b]) finishChallenge(null, "mutual");
  }

  function finishChallenge(winnerId, reason) {
    if (!activeChallenge) return;
    G.db.ref("pvpChallenge/" + activeChallenge.id).update({
      status: "finished",
      winnerId: winnerId || null,
      endedReason: reason || "ko",
      t: Date.now(),
    });
    setTimeout(() => {
      G.db.ref("pvpChallenge/" + activeChallenge.id).remove();
    }, 8000);
  }

  function enterDuelFighter(ch) {
    if (typeof window.setControlMode === "function") window.setControlMode("pvp");
    const p = G.player;
    if (ch.arenaX != null) {
      const off = G.myId === ch.challengerId ? -48 : 48;
      p.x = ch.arenaX + off;
      p.y = ch.arenaY;
    }
    if (ch.health?.[G.myId] != null) p.hp = ch.health[G.myId];
    if (ch.maxHealth?.[G.myId]) p.maxHp = ch.maxHealth[G.myId];
    if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
    if (typeof window.renderActionBars === "function") window.renderActionBars();
    if (typeof window.publishMyAppearance === "function") window.publishMyAppearance(true);
  }

  function enterDuelSpectator() {
    toast("Modo espectador — no podés interferir", "info");
  }

  function endDuelLocal(ch) {
    koInProgress = false;
    isBlocking = false;
    if (typeof window.setControlMode === "function") window.setControlMode("rp");
    if (typeof window.renderActionBars === "function") window.renderActionBars();
    document.getElementById("pvpEndBar")?.classList.remove("open");
    document.getElementById("pvpArenaBanner")?.classList.remove("show");
    activeChallenge = null;
  }

  // ── Combat anims (Firebase combatAnims/) ─────────────────────────────

  function writeCombatAnim(animName, extra) {
    if (!G.online || !G.myId) return;
    const dur = ANIM_DUR[animName] || 800;
    const node = { anim: animName, fromId: G.myId, t: Date.now() };
    if (extra) Object.assign(node, extra);
    G.db.ref("combatAnims/" + G.myId).set(node);
    myLockUntil = Date.now() + dur + 200;
    myLockAnim = animName;
    setTimeout(() => G.db.ref("combatAnims/" + G.myId).remove(), dur + 300);
  }

  function playLocalAnim(animName, cb) {
    const anim = G.myAnim;
    if (!anim) return cb && cb();
    if (anim.setBattleMode) anim.setBattleMode(true);
    anim.play(animName, () => {
      const finish = () => {
        if (cb) cb();
        else anim.play(G.flying ? "fly_combat" : "combat_idle");
      };
      setTimeout(finish, Math.max(0, myLockUntil - Date.now()));
    });
    writeCombatAnim(animName);
  }

  function initCombatAnimsListener() {
    if (!G.db) return;
    G.db.ref("combatAnims").on("child_changed", handleRemoteCombatAnim);
    G.db.ref("combatAnims").on("child_added", handleRemoteCombatAnim);
  }

  function handleRemoteCombatAnim(snap) {
    const data = snap.val();
    const ownerId = snap.key;
    if (!data || ownerId === G.myId || Date.now() - (data.t || 0) > 4000) return;
    const animName = data.anim;
    if (!animName || !COMBAT_ANIMS.has(animName)) return;
    const remoteAnim = G.animators[ownerId];
    if (!remoteAnim) return;
    const dur = ANIM_DUR[animName] || 800;
    animProtect[ownerId] = Date.now() + dur + 200;
    if (remoteAnim.setBattleMode) remoteAnim.setBattleMode(true);
    remoteAnim.play(animName, () => {
      animProtect[ownerId] = 0;
      remoteAnim.play(remoteAnim.battleMode ? "combat_idle" : "idle");
    });
    const rp = G.others[ownerId];
    if (rp && data.label && G.cam) {
      push(rp.x, rp.y - 58, data.label, data.color || "#f5c400", 1.2);
    }
    if (rp && data.dmg && G.cam) {
      spawnNum(rp.x - G.cam.x, rp.y - G.cam.y - 50, data.dmg, data.color || "#ff1744");
    }
  }

  function patchRemoteAnimators() {
    Object.keys(G.animators).forEach((id) => {
      const anim = G.animators[id];
      if (!anim || anim.__pvpPatched) return;
      anim.__pvpPatched = true;
      const orig = anim.play.bind(anim);
      anim.play = function (action, onComplete) {
        if (animProtect[id] && Date.now() < animProtect[id] && !COMBAT_ANIMS.has(action)) return anim;
        if (COMBAT_ANIMS.has(action)) animProtect[id] = Date.now() + (ANIM_DUR[action] || 800) + 150;
        return orig(action, onComplete);
      };
    });
  }

  // ── Real-time attacks ────────────────────────────────────────────────

  function performPvpAction(actionId) {
    if (!isFighter() || !activeChallenge || koInProgress) return;
    const now = Date.now();
    if (now < atkCooldownUntil && actionId !== "block") return;

    const p = G.player;
    const atk = ATTACKS[actionId];
    if (!atk) return;

    if (actionId === "block") {
      isBlocking = true;
      playLocalAnim("block");
      return;
    }

    isBlocking = false;

    if (atk.ki && p.ki < atk.ki) return toast("Ki insuficiente", "dmg");
    if (atk.ki) p.ki -= atk.ki;

    if (atk.move) {
      p.x += p.facing * atk.move;
      playLocalAnim(atk.anim);
      atkCooldownUntil = now + 300;
      return;
    }
    if (atk.jump) {
      p.y -= atk.jump;
      playLocalAnim(atk.anim);
      atkCooldownUntil = now + 350;
      return;
    }

    const oid = opponentId();
    const op = G.others[oid];
    if (!op) return toast("Rival no visible", "dmg");

    const d = dist(p.x, p.y, op.x, op.y);
    if (d > HIT_RANGE) {
      playLocalAnim(atk.anim);
      push(p.x + p.facing * 20, p.y - 44, "FALLÓ", "#8892b0", 0.7);
      atkCooldownUntil = now + ATK_COOLDOWN_MS;
      return;
    }

    const facingTarget = (p.facing > 0 && op.x > p.x) || (p.facing < 0 && op.x < p.x);
    if (!facingTarget) {
      toast("Girá hacia el rival", "dmg");
      return;
    }

    const defMax = op.maxHp || activeChallenge.maxHealth?.[oid] || 100;
    const defDef = op.defense || 80;
    let damage = calcDamage(actionId, p.strength || 80, defDef, defMax);

    const seq = (activeChallenge.lastHitSeq || 0) + 1;
    atkCooldownUntil = now + ATK_COOLDOWN_MS;

    playLocalAnim(atk.anim, () => {});
    push(p.x + p.facing * 24, p.y - 48, atk.label, atk.color, 0.85);

    G.db.ref("pvpChallenge/" + activeChallenge.id).update({ lastHitSeq: seq, t: Date.now() });
    G.db.ref("pvpChallenge/" + activeChallenge.id + "/hits").push({
      seq,
      fromId: G.myId,
      toId: oid,
      action: actionId,
      damage,
      blocked: false,
      fromName: p.name,
      t: Date.now(),
    });
  }

  function releaseBlock() {
    isBlocking = false;
  }

  function listenHits() {
    if (!G.db) return;
    G.db.ref("pvpChallenge").on("child_changed", (snap) => {
      const ch = snap.val();
      if (!ch || ch.status !== "active") return;
      if (snap.key !== activeChallenge?.id && activeChallenge) {
        activeChallenge = { ...ch, id: snap.key };
      }
      if (ch.endVotes) checkMutualEnd(ch.endVotes);
    });
  }

  const watchedHitChallenges = new Set();

  function initHitListener() {
    G.db.ref("pvpChallenge").on("child_added", watchChallengeHits);
    G.db.ref("pvpChallenge").on("child_changed", watchChallengeHits);
  }

  function watchChallengeHits(snap) {
    const ch = snap.val();
    if (!ch || ch.status !== "active") return;
    const cid = snap.key;
    if (watchedHitChallenges.has(cid)) return;
    watchedHitChallenges.add(cid);
    G.db.ref("pvpChallenge/" + cid + "/hits").on("child_added", (hitSnap) => {
      const hit = hitSnap.val();
      if (!hit || hit.toId !== G.myId || hit.seq <= lastHitSeq) return;
      lastHitSeq = hit.seq;
      processIncomingHit(hit, cid);
    });
  }

  function processIncomingHit(hit, challengeId) {
    if (!isFighter() || koInProgress) return;
    const p = G.player;
    let damage = hit.damage || 0;
    let blocked = false;

    if (isBlocking && facingAttacker(p.facing, p.x, G.others[hit.fromId]?.x ?? p.x)) {
      damage = Math.max(1, Math.round(damage * BLOCK_REDUCE));
      blocked = true;
    }

    p.hp = Math.max(0, p.hp - damage);
    const health = { ...(activeChallenge?.health || {}) };
    health[G.myId] = p.hp;

    G.db.ref("pvpChallenge/" + challengeId).update({
      health,
      [`health/${G.myId}`]: p.hp,
      t: Date.now(),
    });

    if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
    if (G.cam) spawnNum(p.x - G.cam.x, p.y - G.cam.y - 52, damage, blocked ? "#90caf9" : "#ff1744");
    push(p.x, p.y - 56, (blocked ? "BLOQUEO " : "-") + damage, blocked ? "#90caf9" : "#ff1744", 1.3);

    playLocalAnim(blocked ? "block" : "hit", () => {
      if (p.hp > 0) playLocalAnim(G.flying ? "fly_combat" : "combat_idle");
    });

    writeCombatAnim(blocked ? "block" : "hit", {
      dmg: damage,
      label: (blocked ? "BLOQUEO " : "-") + damage,
      color: blocked ? "#90caf9" : "#ff1744",
    });

    if (G.online && G.myId) {
      G.db.ref("players/" + G.myId).update({ hp: p.hp, t: Date.now() });
    }

    if (p.hp <= 0 && !koInProgress) {
      koInProgress = true;
      playLocalAnim("knockback");
      writeCombatAnim("knockback", { label: "K.O.", victimName: p.name });
      const winner = hit.fromId;
      finishChallenge(winner, "ko");
      setTimeout(() => {
        p.hp = Math.max(1, Math.floor(p.maxHp * 0.35));
        koInProgress = false;
        if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
      }, 3200);
    }
  }

  // ── Hooks into game.html ─────────────────────────────────────────────

  function hookSendPlayerUpdate() {
    const orig = window.sendPlayerUpdate;
    if (!orig || orig.__pvpHooked) return;
    window.sendPlayerUpdate = function () {
      if (Date.now() < myLockUntil && G.online && G.myId && G.player) {
        const p = G.player;
        G.db.ref("players/" + G.myId).update({
          x: Math.floor(p.x),
          y: Math.floor(p.y),
          facing: p.facing,
          animAction: myLockAnim,
          combatMode: true,
          flying: G.flying,
          hp: p.hp,
          map: G.map,
          t: Date.now(),
        });
        return;
      }
      return orig.apply(this, arguments);
    };
    window.sendPlayerUpdate.__pvpHooked = true;
  }

  function exportApi() {
    window.PvpSystem = {
      isPartyMember,
      isFighter,
      isSpectator,
      isInDuel: () => !!(activeChallenge && activeChallenge.status === "active"),
      isAnimLocked: () => Date.now() < myLockUntil,
      getLockedAnim: () => (Date.now() < myLockUntil ? myLockAnim : null),
      performPvpAction,
      releaseBlock,
      togglePartyPanel,
      getPcSkillsHtml,
      getMobileActionsHtml,
      update: updatePvp,
    };
    window.isPartyMember = isPartyMember;
    window.performPvpAction = performPvpAction;
    window.releasePvpBlock = releaseBlock;
  }

  function getPcSkillsHtml() {
    return [
      `<div class="skill-btn" onclick="performPvpAction('light')" title="Ligero [Z]"><span class="skill-icon">🥊</span><span class="skill-key">Z</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('heavy')" title="Pesado [Q]"><span class="skill-icon">💥</span><span class="skill-key">Q</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('special')" title="Especial [E]"><span class="skill-icon">🔵</span><span class="skill-key">E</span></div>`,
      `<div class="skill-btn" onmousedown="performPvpAction('block')" onmouseup="releasePvpBlock()" title="Bloqueo [R]"><span class="skill-icon">🛡️</span><span class="skill-key">R</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('dash')" title="Dash [F]"><span class="skill-icon">💨</span><span class="skill-key">F</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('jump')" title="Salto [C]"><span class="skill-icon">⬆️</span><span class="skill-key">C</span></div>`,
      `<div class="skill-btn" onclick="requestMutualEnd()" title="Fin pactado"><span class="skill-icon">🤝</span><span class="skill-key">END</span></div>`,
    ].join("");
  }

  function getMobileActionsHtml() {
    return [
      makeMob("🥊", "LIGERO", "performPvpAction('light')"),
      makeMob("💥", "PESADO", "performPvpAction('heavy')"),
      makeMob("🔵", "ESPECIAL", "performPvpAction('special')"),
      makeMob("🛡️", "BLOQUEO", "performPvpAction('block')"),
      makeMob("💨", "DASH", "performPvpAction('dash')"),
      makeMob("⬆️", "SALTO", "performPvpAction('jump')"),
      `<div class="action-btn btn-run" onclick="requestMutualEnd()" style="grid-column:span 2"><span class="btn-icon">🤝</span><span class="btn-label">TERMINAR</span></div>`,
    ].join("");
  }

  function makeMob(icon, label, action) {
    return `<div class="action-btn btn-emote" onclick="${action}"><span class="btn-icon">${icon}</span><span class="btn-label">${label}</span></div>`;
  }

  function updatePvp(dt) {
    patchRemoteAnimators();
    if (activeChallenge?.status === "active" && activeChallenge.endVotes) {
      checkMutualEnd(activeChallenge.endVotes);
    }
    if (isSpectator() && G.player) {
      const ch = activeChallenge;
      if (ch?.arenaX != null) {
        const d = dist(G.player.x, G.player.y, ch.arenaX, ch.arenaY);
        if (d < 60) {
          const ang = Math.atan2(G.player.y - ch.arenaY, G.player.x - ch.arenaX);
          G.player.x = ch.arenaX + Math.cos(ang) * 100;
          G.player.y = ch.arenaY + Math.sin(ang) * 100;
        }
      }
    }
  }

  window.requestMutualEnd = requestMutualEnd;

  function main() {
    injectUI();
    listenParty();
    listenInvites();
    listenChallenges();
    initCombatAnimsListener();
    initHitListener();
    hookSendPlayerUpdate();
    exportApi();
    setInterval(patchRemoteAnimators, 1500);
    console.log("[pvp-system] Party + PvP challenge listo");
  }

  waitForGame(main);
})();
