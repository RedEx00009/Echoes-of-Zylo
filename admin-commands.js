/**
 * =============================================
 *  DRAGON WORLD Z — SISTEMA DE ADMIN
 *  Activar panel: Ctrl + Shift + A
 *
 *  ROLES:
 *   owner  → control total
 *   junior → control limitado, no puede afectar al owner
 * =============================================
 */

(function () {

  // ══════════════════════════════════════════
  //  CONFIGURACIÓN — editá solo esto
  // ══════════════════════════════════════════
  const ADMINS = {
    "manuelfernandezf010@gmail.com":      "owner",   // ← tu email
    "Carlosemail@gmail.com":  "junior",  // ← email del Carlos
  };

  // IDs de Firebase de los owners (para protegerlos del /ban del jr)
  // Se rellena automáticamente cuando el owner loguea, pero podés hardcodearlo:
  const OWNER_PLAYER_IDS = new Set(); // se llena solo al loguearse

  // ══════════════════════════════════════════
  //  ESTADO
  // ══════════════════════════════════════════
  let adminRole     = null; // "owner" | "junior" | null
  let adminEmail    = null;

  // ══════════════════════════════════════════
  //  ESTILOS
  // ══════════════════════════════════════════
  const style = document.createElement("style");
  style.textContent = `
    #adminLoginPanel {
      display:none; position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%);
      background:rgba(8,9,15,0.98); border:1px solid #2a3560;
      border-radius:10px; padding:28px 32px; z-index:9999;
      width:310px; box-shadow:0 0 40px rgba(245,196,0,0.18);
      font-family:'Rajdhani',sans-serif;
    }
    #adminLoginPanel h3 {
      font-family:'Orbitron',monospace; color:#f5c400;
      font-size:13px; letter-spacing:3px; margin-bottom:6px; text-align:center;
    }
    #adminRoleLabel {
      text-align:center; font-family:'Orbitron',monospace;
      font-size:9px; letter-spacing:2px; margin-bottom:18px; min-height:14px;
    }
    #adminLoginPanel button {
      width:100%; padding:10px; margin-top:4px; border-radius:6px;
      border:none; font-family:'Orbitron',monospace;
      font-size:11px; letter-spacing:2px; cursor:pointer; transition:opacity .15s;
    }
    #adminLoginBtn {
      display:flex; align-items:center; justify-content:center; gap:10px;
      background:#fff; color:#1a1a2e; font-weight:700;
      font-family:'Orbitron',monospace; font-size:11px; letter-spacing:2px;
      border:none; border-radius:6px; padding:12px; width:100%; cursor:pointer;
      margin-top:4px; transition:opacity .15s;
    }
    #adminLoginBtn:hover { opacity:.88; }
    #adminLoginBtn .g-icon { width:18px; height:18px; flex-shrink:0; }
    #adminCloseBtn { background:transparent; border:1px solid #2a3560 !important; color:#8892b0; margin-top:8px; }
    #adminLoginMsg { font-size:12px; text-align:center; margin-top:10px; min-height:16px; }

    /* Panel de control */
    #adminControlPanel {
      display:none; position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%);
      background:rgba(8,9,15,0.98); border:1px solid #2a3560;
      border-radius:10px; padding:24px 28px; z-index:9999;
      width:340px; max-height:85vh; overflow-y:auto;
      box-shadow:0 0 40px rgba(245,196,0,0.15);
      font-family:'Rajdhani',sans-serif;
    }
    #adminControlPanel h3 {
      font-family:'Orbitron',monospace; color:#f5c400;
      font-size:12px; letter-spacing:3px; margin-bottom:4px; text-align:center;
    }
    #adminControlRoleBadge {
      text-align:center; font-family:'Orbitron',monospace;
      font-size:9px; letter-spacing:2px; margin-bottom:16px;
    }
    .admin-section { margin-bottom:16px; }
    .admin-section-title {
      font-family:'Orbitron',monospace; font-size:8px; letter-spacing:2px;
      color:#8892b0; margin-bottom:8px; border-bottom:1px solid #1a2040; padding-bottom:4px;
    }
    .admin-btn-row { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px; }
    .admin-btn {
      flex:1; min-width:80px; padding:8px 6px; border-radius:6px; border:none;
      font-family:'Orbitron',monospace; font-size:8px; letter-spacing:1px;
      cursor:pointer; transition:opacity .15s; text-align:center;
    }
    .admin-btn:hover { opacity:.8; }
    .admin-btn:active { opacity:.6; }
    .abtn-green  { background:rgba(0,230,118,.15);  border:1px solid #00e676; color:#00e676; }
    .abtn-red    { background:rgba(255,23,68,.15);   border:1px solid #ff1744; color:#ff1744; }
    .abtn-yellow { background:rgba(245,196,0,.15);   border:1px solid #f5c400; color:#f5c400; }
    .abtn-blue   { background:rgba(41,121,255,.15);  border:1px solid #2979ff; color:#2979ff; }
    .abtn-purple { background:rgba(156,136,255,.15); border:1px solid #9c88ff; color:#9c88ff; }
    .abtn-gray   { background:rgba(136,146,176,.1);  border:1px solid #8892b0; color:#8892b0; }
    .admin-input-row { display:flex; gap:6px; margin-bottom:6px; }
    .admin-input-row input, .admin-input-row select {
      flex:1; padding:7px 10px; background:#0d0f1a; border:1px solid #2a3560;
      border-radius:6px; color:#e8eaf6; font-family:'Rajdhani',sans-serif;
      font-size:13px; outline:none; box-sizing:border-box;
    }
    .admin-input-row input:focus, .admin-input-row select:focus { border-color:#f5c400; }
    .admin-input-row select option { background:#0d0f1a; }
    #adminPlayerList {
      max-height:130px; overflow-y:auto; margin-bottom:6px;
      border:1px solid #1a2040; border-radius:6px; padding:4px;
    }
    .admin-player-row {
      display:flex; align-items:center; justify-content:space-between;
      padding:5px 6px; border-radius:4px; margin-bottom:3px;
      background:rgba(255,255,255,0.03); font-size:13px; gap:6px;
    }
    .admin-player-name { flex:1; color:#c8cfe8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .admin-player-id   { font-size:10px; color:#3d4a6b; font-family:monospace; }
    .admin-player-btn  {
      padding:3px 8px; border-radius:4px; border:none; font-size:10px;
      cursor:pointer; font-family:'Orbitron',monospace; letter-spacing:1px;
    }
    .apbtn-kick { background:rgba(255,106,0,.2); color:#ff6a00; border:1px solid #ff6a00; }
    .apbtn-ban  { background:rgba(255,23,68,.2);  color:#ff1744; border:1px solid #ff1744; }
    .apbtn-unban { background:rgba(0,229,255,.2); color:#00e5ff; border:1px solid #00e5ff; }
    #adminBannedList {
      max-height:100px; overflow-y:auto; margin-bottom:6px;
      border:1px solid #1a2040; border-radius:6px; padding:4px;
      font-size:12px; color:#8892b0;
    }
    .admin-close-row { margin-top:12px; }

    /* Badge */
    #adminBadge {
      display:none; position:fixed; bottom:12px; left:12px;
      border-radius:6px; padding:4px 10px;
      font-family:'Orbitron',monospace; font-size:9px; letter-spacing:2px;
      z-index:9998; pointer-events:auto; cursor:pointer;
    }
    #adminBadge.owner  { background:rgba(245,196,0,.12); border:1px solid rgba(245,196,0,.5); color:#f5c400; }
    #adminBadge.junior { background:rgba(0,229,255,.08); border:1px solid rgba(0,229,255,.4); color:#00e5ff; }

    /* Jr heal button */
    #jrHealBtn {
      display:none; position:fixed; bottom:12px; right:72px;
      background:rgba(0,230,118,.15); border:1px solid #00e676;
      border-radius:6px; padding:6px 14px; color:#00e676;
      font-family:'Orbitron',monospace; font-size:9px; letter-spacing:2px;
      z-index:9998; cursor:pointer; transition:opacity .15s;
    }
    #jrHealBtn:hover { opacity:.8; }
  `;
  document.head.appendChild(style);

  // ══════════════════════════════════════════
  //  PANEL DE LOGIN
  // ══════════════════════════════════════════
  const loginPanel = document.createElement("div");
  loginPanel.id = "adminLoginPanel";
  loginPanel.innerHTML = `
    <h3>⚡ ADMIN ACCESS</h3>
    <div id="adminRoleLabel" style="color:#8892b0">Iniciá sesión con tu cuenta de Google</div>
    <button id="adminLoginBtn">
      <svg class="g-icon" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
      INGRESAR CON GOOGLE
    </button>
    <button id="adminCloseBtn">CANCELAR</button>
    <div id="adminLoginMsg"></div>
  `;
  document.body.appendChild(loginPanel);



  // ══════════════════════════════════════════
  //  PANEL DE CONTROL PRINCIPAL
  // ══════════════════════════════════════════
  const controlPanel = document.createElement("div");
  controlPanel.id = "adminControlPanel";
  document.body.appendChild(controlPanel);

  // Badge
  const badge = document.createElement("div");
  badge.id = "adminBadge";
  document.body.appendChild(badge);
  badge.addEventListener("click", openControlPanel);

  // Botón de curación del Jr
  const jrHealBtn = document.createElement("button");
  jrHealBtn.id = "jrHealBtn";
  jrHealBtn.textContent = "💚 CURAR";
  jrHealBtn.addEventListener("click", () => {
    if (typeof player !== "undefined") {
      player.hp = player.maxHp;
      player.ki = player.maxKi;
      showHudToast("💚 HP y KI restaurados", "xp");
    }
  });
  document.body.appendChild(jrHealBtn);

  // ══════════════════════════════════════════
  //  BAN SYSTEM (localStorage por dispositivo)
  // ══════════════════════════════════════════
  const BAN_KEY = "dwz_banned_players";

  function getBannedList() {
    try { return JSON.parse(localStorage.getItem(BAN_KEY) || "{}"); } catch { return {}; }
  }
  function saveBannedList(list) {
    try { localStorage.setItem(BAN_KEY, JSON.stringify(list)); } catch {}
  }
  function banPlayer(playerId, playerName, reason) {
    const list = getBannedList();
    list[playerId] = { name: playerName || playerId, reason: reason || "Ban de admin", t: Date.now() };
    saveBannedList(list);
    // Expulsar del servidor
    if (typeof db !== "undefined") db.ref("players/" + playerId).remove();
    localMsg(`🔨 Baneado: ${playerName || playerId}`, "#ff1744");
  }
  function unbanPlayer(playerId) {
    const list = getBannedList();
    const name = list[playerId]?.name || playerId;
    delete list[playerId];
    saveBannedList(list);
    localMsg(`✅ Desbaneado: ${name}`, "#00e676");
  }
  function isPlayerBanned(playerId) {
    return !!getBannedList()[playerId];
  }

  // ══════════════════════════════════════════
  //  DESTRUIR / REGENERAR MAPAS
  // ══════════════════════════════════════════
  const DESTRUCTIBLE_MAPS = ["earth", "sky", "space", "ocean", "frieza_ship"];

  function adminDestroyMap(mapKey) {
    if (!mapKey || typeof worldMaps === "undefined" || !worldMaps[mapKey]) {
      localMsg("❗ Mapa no disponible: " + mapKey, "#ff1744"); return;
    }
    const map = worldMaps[mapKey];
    const DESTROYED = 30;
    let count = 0;
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < (map[y]?.length || 0); x++) {
        if (map[y][x] !== 3 && map[y][x] !== DESTROYED) {
          map[y][x] = DESTROYED; count++;
        }
      }
    }
    if (typeof worldDamageState !== "undefined") {
      worldDamageState[mapKey] = { destroyed: count, lastHit: Date.now() };
    }
    if (typeof updateWorldIntegrityHud === "function") updateWorldIntegrityHud();
    localMsg(`💥 Mapa "${mapKey}" destruido (${count} tiles)`, "#ff6a00");
    if (typeof showHudToast === "function") showHudToast(`💥 ${mapKey} destruido`, "dmg");
  }

  function adminRegenerateMap(mapKey) {
    if (!mapKey || typeof worldMaps === "undefined") {
      localMsg("❗ worldMaps no disponible", "#ff1744"); return;
    }
    const generators = {
      earth:       typeof generateEarthMap       === "function" ? generateEarthMap       : null,
      sky:         typeof generateSkyMap         === "function" ? generateSkyMap         : null,
      space:       typeof generateSpaceMap       === "function" ? generateSpaceMap       : null,
      ocean:       typeof generateOceanMap       === "function" ? generateOceanMap       : null,
      frieza_ship: typeof generateFriezaShipMap  === "function" ? generateFriezaShipMap  : null,
      lobby:       typeof generateLobbyMap       === "function" ? generateLobbyMap       : null,
    };
    const gen = generators[mapKey];
    if (!gen) { localMsg("❗ No hay función de regeneración para: " + mapKey, "#ff1744"); return; }
    worldMaps[mapKey] = gen();
    if (typeof worldDamageState !== "undefined") {
      worldDamageState[mapKey] = { destroyed: 0, lastHit: 0 };
    }
    if (typeof updateWorldIntegrityHud === "function") updateWorldIntegrityHud();
    if (typeof snapshotDestructibleTiles === "function") snapshotDestructibleTiles(mapKey);
    localMsg(`🔧 Mapa "${mapKey}" regenerado`, "#00e676");
    if (typeof showHudToast === "function") showHudToast(`🔧 ${mapKey} regenerado`, "xp");
  }

  // ══════════════════════════════════════════
  //  CONSTRUIR PANEL DE CONTROL
  // ══════════════════════════════════════════
  function buildControlPanel() {
    const isOwner = adminRole === "owner";
    const color   = isOwner ? "#f5c400" : "#00e5ff";
    const roleStr = isOwner ? "👑 OWNER" : "🔧 JUNIOR ADMIN";

    let html = `
      <h3>⚡ PANEL ADMIN</h3>
      <div id="adminControlRoleBadge" style="color:${color}">${roleStr} — ${adminEmail}</div>
    `;

    // ── SECCIÓN: MI PERSONAJE ────────────────
    html += `<div class="admin-section">
      <div class="admin-section-title">MI PERSONAJE</div>
      <div class="admin-btn-row">
        <button class="admin-btn abtn-green" onclick="adminCmd('heal')">💚 CURAR</button>
        ${isOwner ? `<button class="admin-btn abtn-yellow" onclick="adminCmd('god')">⚡ GOD</button>` : ""}
        ${isOwner ? `<button class="admin-btn abtn-gray"   onclick="adminCmd('ungod')">❌ UNGOD</button>` : ""}
      </div>`;

    if (isOwner) {
      html += `
      <div class="admin-btn-row">
        <button class="admin-btn abtn-blue"   onclick="adminCmd('fly')">🦅 VOLAR</button>
        <button class="admin-btn abtn-purple" onclick="adminCmd('lvlmax')">⬆️ LVL MAX</button>
      </div>
      <div class="admin-input-row">
        <input id="aSpeedVal" type="number" placeholder="Velocidad (def: 4)" min="1" max="30" step="0.5"/>
        <button class="admin-btn abtn-blue" style="flex:0 0 70px" onclick="adminCmd('speed')">SET</button>
      </div>`;
    }

    html += `</div>`;

    // ── SECCIÓN: JUGADORES ONLINE ────────────
    html += `<div class="admin-section">
      <div class="admin-section-title">JUGADORES ONLINE</div>
      <div id="adminPlayerList"><div style="color:#3d4a6b;padding:8px;text-align:center">Cargando...</div></div>
    </div>`;

    // ── SECCIÓN: BANEADOS ────────────────────
    html += `<div class="admin-section">
      <div class="admin-section-title">JUGADORES BANEADOS</div>
      <div id="adminBannedList"></div>
    </div>`;

    // ── SECCIÓN: MAPAS ───────────────────────
    html += `<div class="admin-section">
      <div class="admin-section-title">MAPAS</div>
      <div class="admin-input-row">
        <select id="aMapSelect">
          <option value="earth">🌍 Tierra</option>
          <option value="sky">☁️ Atalaya</option>
          <option value="space">🌌 Espacio</option>
          <option value="ocean">🌊 Océano</option>
          ${isOwner ? `<option value="frieza_ship">🚀 Nave Frieza</option>` : ""}
          ${isOwner ? `<option value="lobby">🏠 Lobby</option>` : ""}
        </select>
      </div>
      <div class="admin-btn-row">
        <button class="admin-btn abtn-red"   onclick="adminCmd('destroyMap')">💥 DESTRUIR</button>
        <button class="admin-btn abtn-green" onclick="adminCmd('regenMap')">🔧 REGENERAR</button>
      </div>
    </div>`;

    // ── SECCIÓN: OWNER EXTRA ─────────────────
    if (isOwner) {
      html += `<div class="admin-section">
        <div class="admin-section-title">OWNER — CONTROLES GLOBALES</div>
        <div class="admin-btn-row">
          <button class="admin-btn abtn-blue"   onclick="adminCmd('regenAll')">🔄 REGEN TODOS</button>
          <button class="admin-btn abtn-red"    onclick="adminCmd('destroyAll')">💣 DESTRUIR TODO</button>
        </div>
        <div class="admin-input-row">
          <input id="aAnnounceText" type="text" placeholder="Anuncio global..." maxlength="100"/>
          <button class="admin-btn abtn-yellow" style="flex:0 0 70px" onclick="adminCmd('announce')">📢</button>
        </div>
        <div class="admin-input-row">
          <input id="aTpMap" type="text" placeholder="Teleport: nombre mapa"/>
          <button class="admin-btn abtn-purple" style="flex:0 0 70px" onclick="adminCmd('tp')">TP</button>
        </div>
        <div class="admin-btn-row">
          <button class="admin-btn abtn-gray" onclick="adminCmd('clearChat')">🧹 LIMPIAR CHAT</button>
          <button class="admin-btn abtn-red"  onclick="adminCmd('logout')">🚪 LOGOUT</button>
        </div>
      </div>`;
    } else {
      html += `<div class="admin-section">
        <div class="admin-btn-row">
          <button class="admin-btn abtn-red" onclick="adminCmd('logout')">🚪 LOGOUT</button>
        </div>
      </div>`;
    }

    html += `<div class="admin-close-row">
      <button class="admin-btn abtn-gray" onclick="closeControlPanel()">✕ CERRAR</button>
    </div>`;

    controlPanel.innerHTML = html;
    refreshPlayerList();
    refreshBannedList();
  }

  // ── Lista de jugadores online ────────────
  function refreshPlayerList() {
    const el = document.getElementById("adminPlayerList");
    if (!el) return;
    if (typeof otherPlayers === "undefined") { el.innerHTML = `<div style="color:#3d4a6b;padding:8px;text-align:center">No disponible</div>`; return; }

    const players = Object.entries(otherPlayers);
    if (!players.length) { el.innerHTML = `<div style="color:#3d4a6b;padding:8px;text-align:center">Nadie más online</div>`; return; }

    el.innerHTML = players.map(([id, p]) => {
      const name = p.name || "???";
      const isOwnerPlayer = OWNER_PLAYER_IDS.has(id);
      const canBan = !isOwnerPlayer || adminRole === "owner";
      return `<div class="admin-player-row">
        <span class="admin-player-name" title="${id}">${name}</span>
        <button class="admin-player-btn apbtn-kick" onclick="adminKick('${id}','${name}')">KICK</button>
        ${canBan ? `<button class="admin-player-btn apbtn-ban" onclick="adminBanUI('${id}','${name}')">BAN</button>` : `<span style="font-size:10px;color:#f5c400">👑</span>`}
      </div>`;
    }).join("");
  }

  // ── Lista de baneados ────────────────────
  function refreshBannedList() {
    const el = document.getElementById("adminBannedList");
    if (!el) return;
    const list = getBannedList();
    const entries = Object.entries(list);
    if (!entries.length) { el.innerHTML = `<div style="padding:8px;text-align:center;color:#3d4a6b">Sin baneados</div>`; return; }
    el.innerHTML = entries.map(([id, data]) =>
      `<div class="admin-player-row">
        <span class="admin-player-name" title="${id}">${data.name}</span>
        <button class="admin-player-btn apbtn-unban" onclick="adminUnbanUI('${id}')">DESBANEAR</button>
      </div>`
    ).join("");
  }

  window.adminKick = function(id, name) {
    if (typeof db !== "undefined") db.ref("players/" + id).remove();
    localMsg(`👟 ${name} kickeado`, "#ff6a00");
    setTimeout(refreshPlayerList, 500);
  };

  window.adminBanUI = function(id, name) {
    // Jr no puede banear al owner
    if (adminRole === "junior" && OWNER_PLAYER_IDS.has(id)) {
      localMsg("⛔ No podés banear al Owner", "#ff1744"); return;
    }
    if (confirm(`¿Banear a ${name}?`)) {
      banPlayer(id, name);
      setTimeout(() => { refreshPlayerList(); refreshBannedList(); }, 500);
    }
  };

  window.adminUnbanUI = function(id) {
    unbanPlayer(id);
    refreshBannedList();
  };

  // ── Comandos del panel ───────────────────
  window.adminCmd = function(cmd) {
    const isOwner = adminRole === "owner";
    switch(cmd) {

      case "heal":
        if (typeof player !== "undefined") { player.hp = player.maxHp; player.ki = player.maxKi; }
        if (typeof showHudToast === "function") showHudToast("💚 HP y KI restaurados", "xp");
        break;

      case "god":
        if (!isOwner) break;
        if (typeof player !== "undefined") {
          player._godMode = true;
          window._godInterval = setInterval(() => {
            if (!player._godMode) { clearInterval(window._godInterval); return; }
            player.hp = player.maxHp; player.ki = player.maxKi;
          }, 200);
        }
        localMsg("⚡ Modo Dios ACTIVADO", "#f5c400");
        break;

      case "ungod":
        if (!isOwner) break;
        if (typeof player !== "undefined") player._godMode = false;
        clearInterval(window._godInterval);
        localMsg("❌ Modo Dios OFF", "#ff6a00");
        break;

      case "fly":
        if (!isOwner) break;
        if (typeof toggleFly === "function") toggleFly();
        break;

      case "lvlmax":
        if (!isOwner) break;
        if (typeof player !== "undefined") { player.level = 99; }
        localMsg("⬆️ Nivel 99", "#f5c400");
        break;

      case "speed": {
        if (!isOwner) break;
        const v = parseFloat(document.getElementById("aSpeedVal")?.value);
        if (!isNaN(v) && typeof player !== "undefined") { player.speed = v; localMsg(`🏃 Velocidad = ${v}`); }
        break;
      }

      case "destroyMap": {
        const mapKey = document.getElementById("aMapSelect")?.value;
        // Jr no puede destruir lobby
        if (adminRole === "junior" && mapKey === "lobby") { localMsg("⛔ No podés destruir el Lobby", "#ff1744"); break; }
        if (confirm(`¿Destruir el mapa "${mapKey}"?`)) adminDestroyMap(mapKey);
        break;
      }

      case "regenMap": {
        const mapKey = document.getElementById("aMapSelect")?.value;
        adminRegenerateMap(mapKey);
        break;
      }

      case "destroyAll":
        if (!isOwner) break;
        if (confirm("¿Destruir TODOS los mapas? (excepto lobby)")) {
          ["earth","sky","space","ocean","frieza_ship"].forEach(adminDestroyMap);
        }
        break;

      case "regenAll":
        if (!isOwner) break;
        ["earth","sky","space","ocean","frieza_ship","lobby"].forEach(adminRegenerateMap);
        break;

      case "announce": {
        if (!isOwner) break;
        const msg = document.getElementById("aAnnounceText")?.value.trim();
        if (!msg) break;
        if (typeof db !== "undefined") {
          db.ref("chat").push().set({ id:"SYSTEM", name:"📢 SISTEMA", text: msg, t: Date.now() });
        }
        document.getElementById("aAnnounceText").value = "";
        localMsg("📢 Anuncio enviado");
        break;
      }

      case "tp": {
        if (!isOwner) break;
        const map = document.getElementById("aTpMap")?.value.trim();
        if (!map) break;
        if (typeof travelTo === "function") travelTo(map);
        localMsg(`🌀 TP → ${map}`);
        break;
      }

      case "clearChat":
        if (!isOwner) break;
        if (typeof chatMessages !== "undefined") { chatMessages.length = 0; }
        if (typeof renderChat === "function") renderChat();
        localMsg("🧹 Chat limpiado");
        break;

      case "logout":
        adminRole = null; adminEmail = null;
        badge.style.display = "none";
        jrHealBtn.style.display = "none";
        controlPanel.style.display = "none";
        // No hacemos signOut(): cerraría la sesión del jugador en el juego.
        document.dispatchEvent(new Event('adminLoggedOut'));
        localMsg("👋 Sesión admin cerrada", "#8892b0");
        break;
    }
  };

  window.closeControlPanel = () => { controlPanel.style.display = "none"; };

  // ══════════════════════════════════════════
  //  ABRIR / CERRAR LOGIN
  // ══════════════════════════════════════════
  function openAdminPanel() {
    if (adminRole) { openControlPanel(); return; }
    loginPanel.style.display = "block";
  }
  function closeAdminPanel() {
    loginPanel.style.display = "none";
    document.getElementById("adminLoginMsg").textContent = "";
    document.getElementById("adminRoleLabel").textContent = "Iniciá sesión con tu cuenta de Google";
    document.getElementById("adminRoleLabel").style.color = "#8892b0";
  }

  function openControlPanel() {
    buildControlPanel();
    controlPanel.style.display = "block";
  }

  document.getElementById("adminCloseBtn").addEventListener("click", closeAdminPanel);

  // ══════════════════════════════════════════
  //  LOGIN
  // ══════════════════════════════════════════
  document.getElementById("adminLoginBtn").addEventListener("click", doLogin);

  function doLogin() {
    const msgEl = document.getElementById("adminLoginMsg");
    msgEl.style.color = "#8892b0";
    msgEl.textContent = "Abriendo Google...";

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const current = firebase.auth().currentUser;
    const authPromise = (current && current.isAnonymous)
      ? current.linkWithPopup(provider).catch(err => {
          // Si esta cuenta de Google ya está vinculada a otro UID anónimo,
          // logueamos directo con esa cuenta (perdemos el UID anónimo viejo).
          if (err.code === "auth/credential-already-in-use" && err.credential) {
            return firebase.auth().signInWithCredential(err.credential);
          }
          throw err;
        })
      : firebase.auth().signInWithPopup(provider);

    authPromise
      .then(cred => {
        const email = cred.user.email;
        const role  = ADMINS[email];
        if (!role) {
          firebase.auth().signOut();
          msgEl.style.color = "#ff1744";
          msgEl.textContent = "Acceso denegado. Esta cuenta no es admin.";
          return;
        }
        adminRole  = role;
        adminEmail = email;
        closeAdminPanel();

        // Registrar el playerId del owner para protegerlo del jr
        if (adminRole === "owner" && typeof window.myPlayerId !== "undefined" && window.myPlayerId) {
          OWNER_PLAYER_IDS.add(window.myPlayerId);
        }

        // Actualizar ownerUid del jugador actual con el UID definitivo (post-link)
        if (typeof window.myPlayerId !== "undefined" && window.myPlayerId && typeof db !== "undefined") {
          db.ref("players/" + window.myPlayerId).update({ ownerUid: cred.user.uid }).catch(()=>{});
        }

        // Badge
        badge.className = ""; badge.classList.add(adminRole);
        badge.textContent = adminRole === "owner" ? "👑 OWNER" : "🔧 JR ADMIN";
        badge.style.display = "block";

        // Botón de curación para Jr
        if (adminRole === "junior") jrHealBtn.style.display = "block";

        document.dispatchEvent(new Event('adminLoggedIn'));
        localMsg(`✅ Logueado como ${adminRole.toUpperCase()}: ${adminEmail}`, adminRole === "owner" ? "#f5c400" : "#00e5ff");
        localMsg("💡 Click en el badge para abrir el panel de control.", "#8892b0");
      })
      .catch(err => {
        msgEl.style.color = "#ff1744";
        if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
          msgEl.textContent = "Ventana cerrada. Intentá de nuevo.";
        } else {
          msgEl.textContent = "Error: " + err.message;
        }
      });
  }

  // ══════════════════════════════════════════
  //  ATAJO DE TECLADO: F8 (no choca con el navegador)
  // ══════════════════════════════════════════
  document.addEventListener("keydown", e => {
    if (e.key === "F8") { e.preventDefault(); openAdminPanel(); }
  });

  // ══════════════════════════════════════════
  //  BOTÓN OCULTO MOBILE — tap largo 1.5s
  //  en esquina superior izquierda (60x60px invisible)
  // ══════════════════════════════════════════
  (function () {
    const zone = document.querySelector("#adminHiddenTapZone");
    if (zone) return;

    const newZone = document.createElement("div");
    newZone.id = "adminHiddenTapZone";
    newZone.style.cssText = `
      position:fixed; top:0; left:0;
      width:60px; height:60px;
      z-index:9997; opacity:0;
      -webkit-tap-highlight-color:transparent;
      touch-action:none;
      pointer-events:none;
      visibility:hidden;
    `;
    document.body.appendChild(newZone);

    let timer = null;
    newZone.addEventListener("touchstart", (e) => {
      if (e.touches && e.touches.length > 1) return;
      timer = setTimeout(() => openAdminPanel(), 1500);
    }, { passive: true });
    newZone.addEventListener("touchend",  () => { clearTimeout(timer); timer = null; });
    newZone.addEventListener("touchmove", () => { clearTimeout(timer); timer = null; });
  })();

  // ══════════════════════════════════════════
  //  CHAT LOCAL
  // ══════════════════════════════════════════
  function localMsg(text, color = "#00e676") {
    if (typeof addChatMsg === "function") addChatMsg("[ADMIN]", text, color);
  }

  // ══════════════════════════════════════════
  //  COMANDOS DE CHAT (solo owner, por /slash)
  // ══════════════════════════════════════════
  function handleChatCommand(raw) {
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    switch(cmd) {
      case "/god":    adminCmd("god"); break;
      case "/ungod":  adminCmd("ungod"); break;
      case "/heal":   adminCmd("heal"); break;
      case "/lvlmax": adminCmd("lvlmax"); break;
      case "/logout": adminCmd("logout"); break;
      case "/tp": {
        const map = args[0];
        if (map && typeof travelTo === "function") { travelTo(map); localMsg(`🌀 TP → ${map}`); }
        break;
      }
      case "/ban": {
        const id = args[0], name = args[1] || id;
        if (id) { banPlayer(id, name); }
        break;
      }
      case "/unban": {
        const id = args[0];
        if (id) unbanPlayer(id);
        break;
      }
      case "/speed": {
        const v = parseFloat(args[0]);
        if (!isNaN(v) && typeof player !== "undefined") { player.speed = v; localMsg(`🏃 Velocidad = ${v}`); }
        break;
      }
      case "/xp": {
        const x = parseInt(args[0]);
        if (!isNaN(x) && typeof player !== "undefined") { player.xp = (player.xp||0)+x; localMsg(`⭐ +${x} XP`); }
        break;
      }
      case "/announce": {
        const msg = args.join(" ");
        if (msg && typeof db !== "undefined") { db.ref("chat").push().set({ id:"SYSTEM", name:"📢 SISTEMA", text:msg, t:Date.now() }); }
        break;
      }
      case "/destroy": adminDestroyMap(args[0] || currentMap); break;
      case "/regen":   adminRegenerateMap(args[0] || "earth"); break;
      case "/clear":
        if (typeof chatMessages !== "undefined") { chatMessages.length = 0; }
        if (typeof renderChat === "function") renderChat();
        localMsg("🧹 Chat limpiado");
        break;
      case "/panel": openControlPanel(); break;
      case "/help":
        localMsg("📋 Owner: /god /ungod /heal /tp /speed /xp /ban /unban /announce /destroy /regen /clear /panel /logout");
        break;
      default:
        localMsg(`❓ Desconocido. Usá /help`, "#ff6a00");
    }
  }

  // ══════════════════════════════════════════
  //  INTERCEPTAR CHAT
  // ══════════════════════════════════════════
  function waitForGame(cb, retries = 40) {
    if (typeof window.sendChatMsg === "function") cb();
    else if (retries > 0) setTimeout(() => waitForGame(cb, retries - 1), 300);
  }

  waitForGame(() => {
    const _orig = window.sendChatMsg;
    window.sendChatMsg = function() {
      const inp = document.getElementById("mpChatInput");
      if (!inp) return;
      const text = inp.value.trim();
      // Solo owner puede usar /comandos en chat
      if (text.startsWith("/") && adminRole === "owner") {
        inp.value = "";
        handleChatCommand(text);
        return;
      }
      _orig.apply(this, arguments);
    };
  });

})();