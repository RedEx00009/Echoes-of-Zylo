/**
 * DRAGON WORLD Z — Party + PvP Challenge + Real-time Combat
 * Firebase: parties/, partyInvites/, pvpChallenge/, combatAnims/
 */
(function () {
  "use strict";

  const HIT_RANGE = 92;
  const ATK_COOLDOWN_MS = 380;
  const BLOCK_REDUCE = 0.22;
  const MUTUAL_END_NEEDED = 2;
  const KNOCKBACK_GRAVITY = 900;  // px/s² - del game.html
  const SPARRING_RANGE = 92;      // px - rango de ataque

  const ATTACKS = {
    light:   { anim: "light_combo",  ki: 0,  dmgBase: 0.06, dmgVar: 0.02, label: "GOLPE LIGERO", color: "#f5c400", knockback: 0.0 },
    heavy:   { anim: "heavy_combo",  ki: 8,  dmgBase: 0.11, dmgVar: 0.03, label: "GOLPE PESADO", color: "#ff7043", knockback: 1.0 },
    special: { anim: "special",      ki: 18, dmgBase: 0.15, dmgVar: 0.04, label: "ESPECIAL",     color: "#00e5ff", knockback: 1.35, chargeable: true },
    ultimate:{ anim: "ultimate",     ki: 40, dmgBase: 0.30, dmgVar: 0.07, label: "💥 ULTIMATE",  color: "#ff6a00", knockback: 2.5,  chargeable: true },
    dash:    { anim: "dash_rush",    ki: 4,  dmgBase: 0,    dmgVar: 0,    label: "DASH",         color: "#b0bec5", move: 72 },
    jump:    { anim: "dash_rush",    ki: 3,  dmgBase: 0,    dmgVar: 0,    label: "SALTO",        color: "#c8cfe8", move: 0, jump: 38 },
  };

  const ANIM_DUR = {
    light_combo: 750, heavy_combo: 550, special: 800, block: 400,
    hit: 850, knockback: 900, dash_rush: 500, recovery: 600, fly_combat: 300, combat_idle: 200,
    ultimate: 333, ultimate_2: 500,
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
  let knockbackState = {};  // Track knockback velocity for remote players: { playerId: { vx, vy, active } }

  // ── Charge state (special & ultimate) ────────────────────────────────
  let _pvpChargeAction = null;
  let _pvpChargeStart  = 0;
  let _pvpChargeRaf    = null;

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
    // Similar a game.html: dmg = max(1, floor(str × mult - def × 0.3 + random(±5)))
    const multiplier = {
      light: 1.0,
      heavy: 1.6,
      special: 2.2,
    }[atkType] || 1.0;
    const variance = Math.random() * 10 - 5; // ±5
    const damage = Math.max(1, Math.floor(atkStr * multiplier - defDef * 0.3 + variance));
    return damage;
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
      #partyInviteToast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;display:none;flex-direction:column;background:rgba(8,9,15,.97);border:1px solid #00e5ff;border-radius:12px;backdrop-filter:blur(14px);font-family:Rajdhani,sans-serif;color:#e8eaf6;width:min(300px,90vw);overflow:hidden;box-shadow:0 0 30px rgba(0,229,255,.2)}
      #partyInviteToast.open{display:flex}
      .pit-header{background:linear-gradient(135deg,rgba(0,229,255,.15),rgba(41,121,255,.1));padding:14px 16px 10px;border-bottom:1px solid rgba(0,229,255,.2)}
      .pit-title{font-family:Orbitron,monospace;font-size:10px;letter-spacing:2px;color:#00e5ff;margin-bottom:4px}
      .pit-msg{font-size:13px;color:#c8cfe8;line-height:1.4}
      .pit-btns{display:flex;gap:8px;padding:12px 16px}
      .pit-btn{flex:1;padding:10px;border-radius:8px;border:none;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer;transition:all .15s}
      .pit-btn-accept{background:linear-gradient(135deg,rgba(0,229,255,.25),rgba(41,121,255,.2));border:1px solid rgba(0,229,255,.5)!important;color:#00e5ff}
      .pit-btn-reject{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15)!important;color:#8892b0}
      #playerContextMenu{position:fixed;z-index:155;display:none;flex-direction:column;background:rgba(8,9,15,.97);border:1px solid #2a3560;border-radius:10px;backdrop-filter:blur(12px);font-family:Rajdhani,sans-serif;min-width:180px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.6)}
      #playerContextMenu.open{display:flex}
      .pcm-header{padding:10px 14px 8px;border-bottom:1px solid #2a3560;background:rgba(245,196,0,.06)}
      .pcm-name{font-family:Orbitron,monospace;font-size:10px;letter-spacing:1.5px;color:#f5c400}
      .pcm-tag{font-size:10px;color:#4a5880;margin-top:2px}
      .pcm-btn{padding:10px 14px;font-size:12px;color:#c8cfe8;cursor:pointer;border:none;background:none;text-align:left;width:100%;transition:background .12s}
      .pcm-btn:hover{background:rgba(255,255,255,.06);color:#fff}
      .pcm-btn.hi{color:#00e5ff}.pcm-btn.danger-c{color:#ff5252}
      .pvp-tp-btn{border-color:rgba(0,229,255,.4)!important;background:rgba(0,229,255,.1)!important;color:#00e5ff!important}
      #playerListModal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;display:none;flex-direction:column;background:rgba(8,9,15,.97);border:1px solid #00e5ff;border-radius:12px;backdrop-filter:blur(16px);font-family:Rajdhani,sans-serif;color:#e8eaf6;width:min(320px,94vw);max-height:80vh;overflow:hidden;box-shadow:0 0 40px rgba(0,229,255,.2)}
      #playerListModal.open{display:flex}
      #plmSearch{width:100%;box-sizing:border-box;padding:9px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(0,229,255,.25);border-radius:6px;color:#e8eaf6;font-family:Rajdhani,sans-serif;font-size:13px;outline:none;margin-bottom:8px}
      #plmSearch::placeholder{color:#3a4a70}
      #plmList{overflow-y:auto;flex:1;padding:0 12px 12px}
      .plm-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border:1px solid rgba(255,255,255,.07);border-radius:7px;margin-bottom:6px;transition:border-color .12s}
      .plm-item:hover{border-color:rgba(0,229,255,.35);background:rgba(0,229,255,.04)}
      .plm-avatar{width:32px;height:32px;border-radius:50%;background:rgba(0,229,255,.15);border:1px solid rgba(0,229,255,.3);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
      .plm-info{flex:1;min-width:0}
      .plm-name{font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;color:#c8cfe8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .plm-sub{font-size:10px;color:#3a5080;margin-top:1px}
      .plm-btn{padding:6px 11px;border-radius:5px;border:1px solid rgba(0,229,255,.4);background:rgba(0,229,255,.1);color:#00e5ff;font-family:Orbitron,monospace;font-size:8px;letter-spacing:.5px;cursor:pointer;white-space:nowrap;transition:all .12s;flex-shrink:0}
      .plm-btn:hover{background:rgba(0,229,255,.22)}
      .plm-btn.already{border-color:rgba(255,255,255,.15);background:none;color:#3a5080;cursor:default;pointer-events:none}
      .plm-empty{text-align:center;color:#3a5080;font-size:12px;padding:30px 0}
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
        <button class="pvp-btn primary" type="button" id="partyInviteListBtn">📋 LISTA DE JUGADORES</button>
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

    // ── Toast de invitación a party (reemplaza confirm()) ──
    const invToast = document.createElement("div");
    invToast.id = "partyInviteToast";
    invToast.innerHTML = `
      <div class="pit-header">
        <div class="pit-title">👥 INVITACIÓN A PARTY</div>
        <div class="pit-msg" id="pitMsg">Te invita a su party</div>
      </div>
      <div class="pit-btns">
        <button class="pit-btn pit-btn-accept" id="pitAccept">✔ ACEPTAR</button>
        <button class="pit-btn pit-btn-reject" id="pitReject">✕ RECHAZAR</button>
      </div>`;
    document.body.appendChild(invToast);

    // ── Menú contextual al hacer clic en jugador ──
    const pcm = document.createElement("div");
    pcm.id = "playerContextMenu";
    pcm.innerHTML = `
      <div class="pcm-header">
        <div class="pcm-name" id="pcmPlayerName">Jugador</div>
        <div class="pcm-tag" id="pcmPlayerTag"></div>
      </div>
      <button class="pcm-btn hi" id="pcmInviteParty">👥 Invitar a Party</button>
      <button class="pcm-btn" id="pcmChallenge">⚔️ Desafiar a Combate</button>
      <button class="pcm-btn" id="pcmTpTo">🌀 Teleportarme aquí</button>
    `;
    document.body.appendChild(pcm);

    // Cerrar PCM al clicar fuera
    document.addEventListener("pointerdown", (e) => {
      if (!document.getElementById("playerContextMenu").contains(e.target)) {
        closePlayerContextMenu();
      }
    });

    // ── Modal lista de jugadores ──
    const plm = document.createElement("div");
    plm.id = "playerListModal";
    plm.innerHTML = `
      <div class="pvp-hdr">
        <span class="pvp-hdr-t">👥 JUGADORES EN EL SERVIDOR</span>
        <button class="pvp-close" type="button" id="plmClose">✕</button>
      </div>
      <div style="padding:12px 12px 4px">
        <input id="plmSearch" type="text" placeholder="Buscar jugador..." autocomplete="off" spellcheck="false">
      </div>
      <div id="plmList"></div>
    `;
    document.body.appendChild(plm);
    document.getElementById("plmClose").onclick = closePlayerListModal;
    document.addEventListener("pointerdown", (e) => {
      const modal = document.getElementById("playerListModal");
      if (modal && modal.classList.contains("open") && !modal.contains(e.target)) {
        closePlayerListModal();
      }
    });
    document.getElementById("plmSearch").addEventListener("input", () => renderPlayerList());

    document.getElementById("partyPanelClose").onclick = () => panel.classList.remove("open");
    document.getElementById("pvpModalClose").onclick = closeChallengeModal;
    document.getElementById("partyInviteBtn").onclick = inviteNearestPlayer;
    document.getElementById("partyInviteListBtn").onclick = openPlayerListModal;
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
    const iAmLeader = amILeader();
    const leaderMark = iAmLeader ? " 👑" : "";
    let html = `<div class="pvp-member"><span class="pvp-member-name">🟢 ${me?.name || "Tú"}${leaderMark} (tú)</span></div>`;
    getPartyMemberIds().forEach((id) => {
      const m = partyMembers[id];
      const name = m?.name || G.others[id]?.name || id.slice(0, 10);
      const sel = selectedMemberId === id ? " sel" : "";
      const isLeaderMember = myPartyId && myPartyId === "party_" + id;
      const memberTag = isLeaderMember ? " 👑" : "";
      html += `<div class="pvp-member${sel}" data-id="${id}">
        <span class="pvp-member-name">${name}${memberTag}</span>
        <button class="pvp-btn pvp-tp-btn" style="width:auto;padding:4px 8px;margin:0;font-size:8px" data-tp="${id}">🌀 TP</button>
        ${iAmLeader ? `<button class="pvp-btn" style="width:auto;padding:4px 8px;margin:0;font-size:8px;border-color:rgba(255,152,0,.5);background:rgba(255,152,0,.12);color:#ffa726" data-leader-tp="${id}">📡 LLAMAR</button>` : ""}
      </div>`;
    });
    if (!getPartyMemberIds().length) {
      html += `<div style="font-size:12px;color:#4a5880;text-align:center;padding:8px">Sin miembros — invitá a alguien cercano</div>`;
    }
    list.innerHTML = html;
    list.querySelectorAll(".pvp-member[data-id]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.dataset.tp) return; // no seleccionar al clickear TP
        if (e.target.dataset.leaderTp) return;
        selectedMemberId = el.getAttribute("data-id");
        renderPartyList();
      });
    });
    list.querySelectorAll("[data-tp]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); tpToPartyMember(btn.dataset.tp); };
    });
    list.querySelectorAll("[data-leader-tp]").forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); leaderTpMemberToMe(btn.dataset.leaderTp); };
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
      showPartyInviteToast(inv, snap.ref);
    });
  }

  function showPartyInviteToast(inv, ref) {
    const toast = document.getElementById("partyInviteToast");
    const msg = document.getElementById("pitMsg");
    const accept = document.getElementById("pitAccept");
    const reject = document.getElementById("pitReject");
    if (!toast) return;
    msg.textContent = `${inv.fromName || "Alguien"} te invita a su party`;
    toast.classList.add("open");
    const cleanup = () => {
      toast.classList.remove("open");
      accept.onclick = null;
      reject.onclick = null;
      ref.remove();
    };
    accept.onclick = () => {
      joinParty(inv.partyId, inv.fromId);
      cleanup();
    };
    reject.onclick = cleanup;
  }

  function openPlayerListModal() {
    renderPlayerList();
    document.getElementById("playerListModal")?.classList.add("open");
    setTimeout(() => document.getElementById("plmSearch")?.focus(), 80);
  }

  function closePlayerListModal() {
    document.getElementById("playerListModal")?.classList.remove("open");
  }

  function renderPlayerList() {
    const list = document.getElementById("plmList");
    if (!list) return;
    const query = (document.getElementById("plmSearch")?.value || "").toLowerCase().trim();
    const others = G.others;
    const myMap  = G.map;

    const players = Object.entries(others)
      .filter(([id, p]) => {
        if (id === G.myId) return false;
        if (p.fusionHidden) return false;
        // same map preferably, but show all connected
        const name = (p.name || "").toLowerCase();
        return !query || name.includes(query);
      })
      .sort((a, b) => {
        // Same map first
        const aMap = a[1].map === myMap ? 0 : 1;
        const bMap = b[1].map === myMap ? 0 : 1;
        if (aMap !== bMap) return aMap - bMap;
        return (a[1].name || "").localeCompare(b[1].name || "");
      });

    if (players.length === 0) {
      list.innerHTML = `<div class="plm-empty">No hay jugadores conectados</div>`;
      return;
    }

    const partyIds = new Set(getPartyMemberIds());
    const partyFull = (getPartyMemberIds().length + 1) >= 4; // +1 = yo

    list.innerHTML = players.map(([id, p]) => {
      const name   = p.name || id.slice(0, 10);
      const level  = p.level ? `Lv.${p.level}` : "";
      const sameMap = p.map === myMap || !p.map;
      const status = sameMap ? "🟢 En este mapa" : "🔵 Otro mapa";
      const inParty = partyIds.has(id);
      const btnClass = inParty ? "plm-btn already" : "plm-btn";
      const btnLabel = inParty ? "✓ En tu party" : "Invitar";
      const disabled = inParty ? "" : (partyFull ? 'disabled title="Party llena (máx 4)"' : "");
      const aura = p.appearance?.auraColor || p.charColor || "#00e5ff";
      return `
        <div class="plm-item">
          <div class="plm-avatar" style="border-color:${aura}30;color:${aura}">👤</div>
          <div class="plm-info">
            <div class="plm-name" style="color:${aura}">${name}${level ? " · " + level : ""}</div>
            <div class="plm-sub">${status}</div>
          </div>
          <button class="${btnClass}" ${disabled} onclick="window.PvpSystem._inviteFromList('${id}')">${btnLabel}</button>
        </div>`;
    }).join("");
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
    G.db.ref("partyInvites/" + best.id).remove().then(() => {
      G.db.ref("partyInvites/" + best.id).set({
        partyId,
        fromId: G.myId,
        fromName: p.name,
        t: Date.now(),
      });
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

  // ── Leader tracking ──────────────────────────────────────────────────
  let partyLeaderId = null;

  // listenParty ya carga los members; extender para trackear leaderId
  const _origListenParty = listenParty;

  // ── Player Context Menu ──────────────────────────────────────────────
  let _pcmTargetId = null;

  function openPlayerContextMenu(id, screenX, screenY) {
    const op = G.others[id];
    if (!op) return;
    _pcmTargetId = id;
    const menu = document.getElementById("playerContextMenu");
    const nameEl = document.getElementById("pcmPlayerName");
    const tagEl = document.getElementById("pcmPlayerTag");
    const tpBtn = document.getElementById("pcmTpTo");

    const name = op.name || id.slice(0, 10);
    const lvl = op.level ? ` Lv.${op.level}` : "";
    nameEl.textContent = name + lvl;
    tagEl.textContent = isPartyMember(id) ? "🟢 En tu party" : "👤 Jugador";

    // TP a ese jugador solo si es party member
    tpBtn.style.display = isPartyMember(id) ? "block" : "none";

    // Posicionar el menú
    const vw = window.innerWidth, vh = window.innerHeight;
    const mw = 190, mh = 160;
    let x = screenX + 10, y = screenY - 20;
    if (x + mw > vw) x = screenX - mw - 10;
    if (y + mh > vh) y = vh - mh - 10;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.classList.add("open");

    document.getElementById("pcmInviteParty").onclick = () => {
      invitePlayerById(id);
      closePlayerContextMenu();
    };
    document.getElementById("pcmChallenge").onclick = () => {
      selectedMemberId = id;
      sendChallengeToSelected();
      closePlayerContextMenu();
    };
    tpBtn.onclick = () => {
      tpToPartyMember(id);
      closePlayerContextMenu();
    };
  }

  function closePlayerContextMenu() {
    document.getElementById("playerContextMenu")?.classList.remove("open");
    _pcmTargetId = null;
  }

  function invitePlayerById(targetId) {
    if (!G.online || !G.myId) return toast("Conectate al servidor primero", "dmg");
    const op = G.others[targetId];
    if (!op) return toast("Jugador no encontrado", "dmg");
    const partyId = ensurePartyId();
    const p = G.player;
    const members = { [G.myId]: { name: p.name, t: Date.now() } };
    G.db.ref("parties/" + partyId).transaction((cur) => {
      if (!cur) return { leaderId: G.myId, members, createdAt: Date.now() };
      cur.members = cur.members || {};
      cur.members[G.myId] = { name: p.name, t: Date.now() };
      return cur;
    });
    // Limpiar primero para forzar disparo del on("value") del receptor
    // aunque ya hubiera un nodo previo (Firebase no dispara si el valor no cambia)
    G.db.ref("partyInvites/" + targetId).remove().then(() => {
      G.db.ref("partyInvites/" + targetId).set({
        partyId,
        fromId: G.myId,
        fromName: p.name,
        t: Date.now(),
      });
    });
    toast(`Invitación enviada a ${op.name || targetId.slice(0,8)}`, "info");
  }

  // ── Party Teleport ────────────────────────────────────────────────────
  // Cualquier miembro puede TP a otro miembro de la party.
  // Solo el líder puede forzar a un miembro a teleportarse hacia él.

  function amILeader() {
    if (!myPartyId) return false;
    // El partyId es "party_<leaderId>" por convención
    return myPartyId === "party_" + G.myId;
  }

  function tpToPartyMember(targetId) {
    const op = G.others[targetId];
    if (!op) return toast("Jugador no visible", "dmg");
    if (!isPartyMember(targetId)) return toast("Solo podés TP a party members", "dmg");
    const p = G.player;
    if (op.map && op.map !== G.map) {
      toast("Ese jugador está en otro mapa. Viajá primero.", "dmg");
      return;
    }
    p.x = op.x + 36;
    p.y = op.y;
    if (typeof window.sendPlayerUpdate === "function") window.sendPlayerUpdate();
    toast("🌀 Teleportado a " + (op.name || "party member"), "info");
  }

  function leaderTpMemberToMe(targetId) {
    if (!amILeader()) return toast("Solo el líder puede hacer TP forzado", "dmg");
    if (!isPartyMember(targetId)) return toast("No es miembro de la party", "dmg");
    const p = G.player;
    // Escribir un comando de TP en Firebase que el miembro va a leer
    G.db.ref("partyTp/" + targetId).set({
      fromId: G.myId,
      fromName: p.name,
      x: Math.floor(p.x),
      y: Math.floor(p.y),
      map: G.map,
      t: Date.now(),
    });
    toast("🌀 TP enviado a " + (G.others[targetId]?.name || targetId.slice(0,8)), "info");
  }

  function listenPartyTp() {
    if (!G.db || !G.myId) return;
    G.db.ref("partyTp/" + G.myId).on("value", (snap) => {
      const cmd = snap.val();
      if (!cmd || !cmd.x || Date.now() - cmd.t > 8000) return;
      const p = G.player;
      if (cmd.map && cmd.map !== G.map) {
        toast(`El líder ${cmd.fromName} te llama pero estás en otro mapa`, "dmg");
        snap.ref.remove();
        return;
      }
      p.x = cmd.x + 40;
      p.y = cmd.y;
      if (typeof window.sendPlayerUpdate === "function") window.sendPlayerUpdate();
      toast(`🌀 Teleportado por el líder ${cmd.fromName}`, "info");
      snap.ref.remove();
    });
  }

  // ── Hook canvas click for player interaction ─────────────────────────
  function hookCanvasClick() {
    const canvas = document.getElementById("gameCanvas");
    if (!canvas || canvas._pvpClickHooked) return;
    canvas._pvpClickHooked = true;
    canvas.addEventListener("pointerup", (e) => {
      if (window.gameState !== "playing") return;
      const cam = window.cam;
      if (!cam) return;
      const rect = canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
      const z = cam.zoom || 1;
      const wx = ((sx - canvas.width / 2) / z) + canvas.width / 2 + cam.x;
      const wy = ((sy - canvas.height / 2) / z) + canvas.height / 2 + cam.y;

      // Buscar jugador remoto en esa posición
      const SPRITE_W = 120, SPRITE_H = 148;
      let hit = null, bestD = Infinity;
      for (const [id, op] of Object.entries(G.others)) {
        if (op.map && op.map !== G.map) continue;
        if (op.inTrailerDrive) continue;
        const d = Math.hypot(wx - op.x, wy - (op.y - SPRITE_H / 2));
        if (d < SPRITE_W * 0.55 && d < bestD) { hit = id; bestD = d; }
      }
      if (!hit) return;
      openPlayerContextMenu(hit, e.clientX, e.clientY);
    });
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
    const dur = ANIM_DUR[animName] || 800;
    anim.play(animName, () => {
      const finish = () => {
        if (cb) cb();
        else anim.play(G.flying ? "fly" : "combat_idle");
      };
      // Esperar a que se complete myLockUntil
      setTimeout(finish, Math.max(0, myLockUntil - Date.now()));
    });
    myLockUntil = Date.now() + dur + 200;  // Lockear después de la animación
    myLockAnim = animName;
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
    
    // Reproducir efecto de impacto para ataques
    if (data.anim && data.anim.includes("combo") && rp && typeof window.triggerAttackWorldDamage === "function") {
      const attackType = animName === "light_combo" ? "combo1" : "combo2";
      window.triggerAttackWorldDamage(attackType, rp.x, rp.y - 24);
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

  // ── Hold-to-charge: special & ultimate ───────────────────────────────
  function beginPvpCharge(actionId) {
    if (!isFighter() || !activeChallenge || koInProgress) return;
    const atk = ATTACKS[actionId];
    if (!atk?.chargeable) { performPvpAction(actionId); return; }
    if (Date.now() < atkCooldownUntil) return;
    if (atk.ki && G.player.ki < atk.ki) { toast("Ki insuficiente", "dmg"); return; }
    _pvpChargeAction = actionId;
    _pvpChargeStart  = Date.now();
    // Congelar animator en primer frame
    const anim = G.myAnim;
    if (anim) {
      if (anim.setBattleMode) anim.setBattleMode(true);
      anim.action  = atk.anim;
      anim.frame   = 0;
      anim.elapsed = 0;
      anim._freezeFrame = true;
      writeCombatAnim(atk.anim);
    }
  }

  function releasePvpCharge(actionId) {
    if (_pvpChargeAction !== actionId) return;
    _pvpChargeAction = null;
    cancelAnimationFrame(_pvpChargeRaf);
    _pvpChargeRaf = null;
    const anim = G.myAnim;
    if (anim) anim._freezeFrame = false;
    // Disparar el ataque
    _firePvpChargeable(actionId);
  }

  function _firePvpChargeable(actionId) {
    if (!isFighter() || !activeChallenge || koInProgress) return;
    const now = Date.now();
    if (now < atkCooldownUntil) return;
    const p   = G.player;
    const atk = ATTACKS[actionId];
    if (!atk) return;
    if (atk.ki && p.ki < atk.ki) { toast("Ki insuficiente", "dmg"); return; }
    if (atk.ki) p.ki -= atk.ki;
    isBlocking = false;

    const oid = opponentId();
    const op  = G.others[oid];
    if (!op) { toast("Rival no visible", "dmg"); return; }

    const facingTarget = (p.facing > 0 && op.x > p.x) || (p.facing < 0 && op.x < p.x);
    if (!facingTarget) { toast("Girá hacia el rival", "dmg"); return; }

    const d = dist(p.x, p.y, op.x, op.y);
    const range = HIT_RANGE * (actionId === "ultimate" ? 1.6 : 1.2);
    if (d > range) {
      push(p.x + p.facing * 20, p.y - 44, "FALLÓ", "#8892b0", 0.7);
      atkCooldownUntil = now + ATK_COOLDOWN_MS;
      return;
    }

    const defMax = op.maxHp || activeChallenge.maxHealth?.[oid] || 100;
    const defDef = op.defense || 80;
    const damage = calcDamage(actionId === "ultimate" ? "special" : actionId, p.strength || 80, defDef, defMax);

    // Reproducir anim completa → freeze en último frame → idle
    const lockMs = ANIM_DUR[atk.anim] || 800;
    const holdMs = actionId === "ultimate" ? 900 : 600;
    atkCooldownUntil = now + ATK_COOLDOWN_MS + holdMs;
    myLockUntil = now + lockMs + holdMs;
    myLockAnim  = atk.anim;
    const animRef = G.myAnim;
    if (animRef) {
      if (animRef.setBattleMode) animRef.setBattleMode(true);
      animRef._freezeFrame = false;
      animRef.play(atk.anim, () => {
        animRef._freezeFrame = true;
        setTimeout(() => {
          animRef._freezeFrame = false;
          animRef.play(G.flying ? "fly" : "combat_idle");
        }, holdMs);
      });
    }
    writeCombatAnim(atk.anim);

    push(p.x + p.facing * 24, p.y - 48, atk.label, atk.color, 1.0);
    if (typeof window.triggerAttackWorldDamage === "function") {
      window.triggerAttackWorldDamage(actionId === "ultimate" ? "special2" : "special1", p.x + p.facing * 90, p.y - 24);
    }

    const seq = (activeChallenge.lastHitSeq || 0) + 1;
    G.db.ref("pvpChallenge/" + activeChallenge.id).update({ lastHitSeq: seq, t: Date.now() });
    G.db.ref("pvpChallenge/" + activeChallenge.id + "/hits").push({
      seq, fromId: G.myId, toId: oid, action: actionId, damage,
      blocked: false, knockbackPower: atk.knockback || 0, fromName: p.name, t: Date.now(),
    });
  }

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
    if (typeof window.triggerAttackWorldDamage === "function") {
      window.triggerAttackWorldDamage(actionId === "special" ? "special1" : actionId === "heavy" ? "combo2" : "combo1", p.x + p.facing * 72, p.y - 24);
    }

    G.db.ref("pvpChallenge/" + activeChallenge.id).update({ lastHitSeq: seq, t: Date.now() });
    G.db.ref("pvpChallenge/" + activeChallenge.id + "/hits").push({
      seq,
      fromId: G.myId,
      toId: oid,
      action: actionId,
      damage,
      blocked: false,
      knockbackPower: atk.knockback || 0,  // Incluir poder de knockback
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

  const SPECIAL_BLOCK_KI_COST = 18;  // mismo costo que lanzar un especial
  const SPECIAL_BLOCK_WINDOW_MS = 1400; // tiempo para reaccionar (como game.html)
  let _pendingSpecialBlock = null;

  function showSpecialBlockPrompt(onBlock, onTake) {
    // Crear/reusar el prompt de bloqueo especial
    let el = document.getElementById("pvpSpecialBlockPrompt");
    if (!el) {
      el = document.createElement("div");
      el.id = "pvpSpecialBlockPrompt";
      el.style.cssText = `
        position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
        z-index:200;background:rgba(8,9,15,.96);border:2px solid #00e5ff;
        border-radius:12px;padding:16px 24px;text-align:center;pointer-events:auto;
        font-family:Orbitron,monospace;color:#fff;min-width:260px;
        box-shadow:0 0 30px rgba(0,229,255,.5);
      `;
      document.body.appendChild(el);
    }
    const p = window.player;
    const canBlock = p && p.ki >= SPECIAL_BLOCK_KI_COST;
    el.innerHTML = `
      <div style="font-size:11px;letter-spacing:2px;color:#00e5ff;margin-bottom:8px">⚠️ ¡ATAQUE ESPECIAL ENTRANTE!</div>
      <div style="font-size:12px;color:#c8cfe8;margin-bottom:14px">${canBlock ? `Podés bloquear (-${SPECIAL_BLOCK_KI_COST} Ki)` : 'Ki insuficiente para bloquear'}</div>
      <div style="display:flex;gap:10px;justify-content:center">
        ${canBlock ? `<button id="pvpSBBlock" style="padding:10px 18px;background:rgba(0,229,255,.2);border:1px solid #00e5ff;border-radius:6px;color:#00e5ff;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer">🛡️ BLOQUEAR</button>` : ''}
        <button id="pvpSBTake" style="padding:10px 18px;background:rgba(255,23,68,.2);border:1px solid #ff5252;border-radius:6px;color:#ff5252;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1px;cursor:pointer">💢 RECIBIR</button>
      </div>`;
    el.style.display = "block";
    const timer = setTimeout(() => { hideSpecialBlockPrompt(); onTake(); }, SPECIAL_BLOCK_WINDOW_MS);
    const blockBtn = document.getElementById("pvpSBBlock");
    const takeBtn = document.getElementById("pvpSBTake");
    if (blockBtn) blockBtn.onclick = () => { clearTimeout(timer); hideSpecialBlockPrompt(); onBlock(); };
    if (takeBtn) takeBtn.onclick = () => { clearTimeout(timer); hideSpecialBlockPrompt(); onTake(); };
    _pendingSpecialBlock = { timer };
  }

  function hideSpecialBlockPrompt() {
    const el = document.getElementById("pvpSpecialBlockPrompt");
    if (el) el.style.display = "none";
    if (_pendingSpecialBlock?.timer) clearTimeout(_pendingSpecialBlock.timer);
    _pendingSpecialBlock = null;
  }

  function processIncomingHit(hit, challengeId) {
    if (!isFighter() || koInProgress) return;

    // ── Ataque especial / ultimate: dar ventana de bloqueo reactivo ─────
    if (hit.action === "special" || hit.action === "ultimate") {
      const kiCost = hit.action === "ultimate" ? SPECIAL_BLOCK_KI_COST * 2 : SPECIAL_BLOCK_KI_COST;
      showSpecialBlockPrompt(
        () => {
          const p = G.player;
          p.ki = Math.max(0, p.ki - kiCost);
          const reducedDmg = Math.max(1, Math.round((hit.damage || 0) * BLOCK_REDUCE));
          _applyHit({ ...hit, damage: reducedDmg, knockbackPower: 0 }, challengeId, true);
          if (typeof window.updatePlayerHud === "function") window.updatePlayerHud();
        },
        () => { _applyHit(hit, challengeId, false); }
      );
      return;
    }

    // Para ataques normales, permitir bloqueo pasivo si está en posición
    _applyHit(hit, challengeId, false);
  }

  function _applyHit(hit, challengeId, forceBlocked) {
    const p = G.player;

    // ── Dodge activo en PvP: reemplazar animación hit por dash, sin daño ni knockback ──
    if (window._dodgeActive) {
      playLocalAnim("dash");
      return;
    }

    // ── Invulnerabilidad activa: sin daño ni efectos ──
    if (window._invulActive) {
      if (typeof window.showHudToast === "function") window.showHudToast("✨ Daño bloqueado (INVUL)", "info");
      return;
    }

    let damage = hit.damage || 0;
    let blocked = forceBlocked;

    if (!blocked && isBlocking && facingAttacker(p.facing, p.x, G.others[hit.fromId]?.x ?? p.x)) {
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
      if (p.hp > 0) playLocalAnim(G.flying ? "fly" : "combat_idle");
    });

    writeCombatAnim(blocked ? "block" : "hit", {
      dmg: damage,
      label: (blocked ? "BLOQUEO " : "-") + damage,
      color: blocked ? "#90caf9" : "#ff1744",
    });

    // Aplicar knockback si no está bloqueado (como en game.html)
    if (!blocked && hit.knockbackPower != null && hit.knockbackPower > 0) {
      const direction = (G.others[hit.fromId]?.x ?? p.x) > p.x ? 1 : -1;
      const knockVx = direction * (260 + 70 * hit.knockbackPower);
      const knockVy = 420 + 80 * hit.knockbackPower;
      knockbackState[G.myId] = { vx: knockVx, vy: knockVy, active: true, startTime: Date.now() };
      playLocalAnim("knockback_fly");
    }

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
      beginCharge: beginPvpCharge,
      releaseCharge: releasePvpCharge,
      releaseBlock,
      togglePartyPanel,
      getPcSkillsHtml,
      getMobileActionsHtml,
      update: updatePvp,
      getPartyMemberIds,
    };
    window.isPartyMember = isPartyMember;
    window.performPvpAction = performPvpAction;
    window.releasePvpBlock = releaseBlock;
    window._pvpOpponentId = opponentId;
    // Exponer para que player-interact.js pueda delegar el menú contextual
    window._pvpOpenPlayerContextMenu = openPlayerContextMenu;
    window.PvpSystem.sendPartyInvite = invitePlayerById;
    window.PvpSystem.sendChallenge   = (id) => { selectedMemberId = id; sendChallengeToSelected(); };
    window.PvpSystem._ensurePartyId  = ensurePartyId;
    window.PvpSystem._openPlayerListModal = openPlayerListModal;
    window.PvpSystem._inviteFromList = (id) => {
      invitePlayerById(id);
      renderPlayerList(); // refresh button state
      toast("Invitación enviada", "info");
    };
    window.PvpSystem._handlesPartyInvites = true;

    // Teclas hold para special [E] y ultimate [T] en modo PvP
    const _pvpHeld = {};
    document.addEventListener("keydown", e => {
      if (!isFighter()) return;
      if (e.code === "KeyE" && !_pvpHeld.special)  { e.preventDefault(); _pvpHeld.special  = true; beginPvpCharge("special");  }
      if (e.code === "KeyT" && !_pvpHeld.ultimate) { e.preventDefault(); _pvpHeld.ultimate = true; beginPvpCharge("ultimate"); }
    });
    document.addEventListener("keyup", e => {
      if (e.code === "KeyE" && _pvpHeld.special)  { _pvpHeld.special  = false; releasePvpCharge("special");  }
      if (e.code === "KeyT" && _pvpHeld.ultimate) { _pvpHeld.ultimate = false; releasePvpCharge("ultimate"); }
    });
  }

  function getPcSkillsHtml() {
    const hld = (id) => `onmousedown="window.PvpSystem.beginCharge('${id}')" onmouseup="window.PvpSystem.releaseCharge('${id}')" onmouseleave="window.PvpSystem.releaseCharge('${id}')"`;
    return [
      `<div class="skill-btn" onclick="performPvpAction('light')" title="Ligero [Z]"><span class="skill-icon">🥊</span><span class="skill-key">Z</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('heavy')" title="Pesado [Q]"><span class="skill-icon">💥</span><span class="skill-key">Q</span></div>`,
      `<div class="skill-btn chargeable" ${hld("special")} title="Especial — mantener para cargar [E]"><span class="skill-icon">🔵</span><span class="skill-key">E</span></div>`,
      `<div class="skill-btn chargeable ult-btn" ${hld("ultimate")} title="ULTIMATE — mantener para cargar [T]"><span class="skill-icon">🌋</span><span class="skill-key">T</span></div>`,
      `<div class="skill-btn" onmousedown="performPvpAction('block')" onmouseup="releasePvpBlock()" title="Bloqueo [R]"><span class="skill-icon">🛡️</span><span class="skill-key">R</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('dash')" title="Dash [F]"><span class="skill-icon">💨</span><span class="skill-key">F</span></div>`,
      `<div class="skill-btn" onclick="performPvpAction('jump')" title="Salto [C]"><span class="skill-icon">⬆️</span><span class="skill-key">C</span></div>`,
      `<div class="skill-btn" onclick="requestMutualEnd()" title="Fin pactado"><span class="skill-icon">🤝</span><span class="skill-key">END</span></div>`,
    ].join("");
  }

  function getMobileActionsHtml() {
    const hld = (id) => `ontouchstart="event.preventDefault();window.PvpSystem.beginCharge('${id}')" ontouchend="event.preventDefault();window.PvpSystem.releaseCharge('${id}')" ontouchcancel="event.preventDefault();window.PvpSystem.releaseCharge('${id}')" onmousedown="window.PvpSystem.beginCharge('${id}')" onmouseup="window.PvpSystem.releaseCharge('${id}')" onmouseleave="window.PvpSystem.releaseCharge('${id}')"`;
    return [
      makeMob("🥊", "LIGERO",   "performPvpAction('light')"),
      makeMob("💥", "PESADO",   "performPvpAction('heavy')"),
      `<div class="action-btn btn-interact chargeable" ${hld("special")}><span class="btn-icon">🔵</span><span class="btn-label">ESPECIAL</span></div>`,
      `<div class="action-btn btn-interact chargeable ult-btn" ${hld("ultimate")}><span class="btn-icon">🌋</span><span class="btn-label">ULTIMATE</span></div>`,
      makeMob("🛡️", "BLOQUEO",  "performPvpAction('block')"),
      makeMob("💨", "DASH",     "performPvpAction('dash')"),
      makeMob("⬆️", "SALTO",    "performPvpAction('jump')"),
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

    // Actualizar física de knockback para jugador local
    if (knockbackState[G.myId]?.active && G.player) {
      const kb = knockbackState[G.myId];
      const elapsedMs = Date.now() - kb.startTime;
      if (elapsedMs < 900) {  // knockback dura ~900ms
        kb.vy += KNOCKBACK_GRAVITY * (dt || 0.016);  // Aplicar gravedad
        G.player.x += kb.vx * (dt || 0.016);
        G.player.y += kb.vy * (dt || 0.016);
        // Limitar para no salir del mapa
        if (typeof window.currentMap === "string") {
          const mapData = window.MAPS?.[window.currentMap];
          if (mapData) {
            G.player.x = Math.max(0, Math.min(mapData.w * 64, G.player.x));
            G.player.y = Math.max(0, Math.min(mapData.h * 64, G.player.y));
          }
        }
      } else {
        knockbackState[G.myId].active = false;
      }
    }
  }

  window.requestMutualEnd = requestMutualEnd;

  function main() {
    injectUI();
    listenParty();
    listenInvites();
    listenChallenges();
    listenPartyTp();
    initCombatAnimsListener();
    initHitListener();
    hookSendPlayerUpdate();
    hookCanvasClick();
    exportApi();
    setInterval(patchRemoteAnimators, 1500);
    console.log("[pvp-system] Party + PvP challenge listo");
  }

  waitForGame(main);
})();