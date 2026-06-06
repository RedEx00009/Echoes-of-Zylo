/**
 * Dragon World Z — Systems Patch
 * ================================
 * SISTEMA 1: RPG Chat Banner (chat de personaje estilo RPG con portrait, emoción)
 * SISTEMA 2: Vehicle Overlay (PNG sobre/bajo el jugador según tipo de vehículo)
 * SISTEMA 3: World Objects (objetos colocables con colisión, sincronizados por Firebase)
 *
 * INSTALACIÓN en game.html — agregar ANTES de </body>:
 *   <script src="systems-patch.js"></script>
 *
 * Luego en el loop principal de render (donde dice drawPlayerChar / drawNpcs),
 * llamar: WorldObjectsSystem.draw(ctx, cam);
 * Y en drawPlayerChar, después de CS.drawPlayer, llamar: VehicleOverlay.draw(ctx, sx, sy, player);
 *
 * Para el RPG Chat: se inyecta automáticamente un panel en el HUD al cargar.
 */

"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   SISTEMA 1 — RPG CHAT BANNER
   Chat de party estilo RPG: portrait del personaje (row 0 del sprite),
   selector de emoción, banner al estilo JRPG visible para todos en party.
   ═══════════════════════════════════════════════════════════════════════════ */

const RpgChatSystem = (() => {
  // ── Constantes ──────────────────────────────────────────────────────────
  const DB_PATH  = "rpgChat";
  const MAX_MSGS = 30;
  const EMOTIONS = [
    { id:"normal",   icon:"😐", label:"Normal"    },
    { id:"happy",    icon:"😄", label:"Feliz"     },
    { id:"angry",    icon:"😠", label:"Enojado"   },
    { id:"sad",      icon:"😢", label:"Triste"    },
    { id:"serious",  icon:"😤", label:"Serio"     },
    { id:"surprised",icon:"😲", label:"Sorpresa"  },
    { id:"love",     icon:"😍", label:"Amor"      },
    { id:"laugh",    icon:"🤣", label:"Risa"      },
  ];
  // Borde de emoción para el banner
  const EMOTION_COLORS = {
    normal:"#2a3560", happy:"#f5c400", angry:"#ff1744",
    sad:"#2979ff", serious:"#9c88ff", surprised:"#ff6a00",
    love:"#e040fb", laugh:"#00e676"
  };

  // ── Estado interno ───────────────────────────────────────────────────────
  let _open         = false;
  let _emOpen       = false;
  let _currentEm    = "normal";
  let _messages     = [];   // { id, name, text, emotion, portrait, t }
  let _initialized  = false;
  let _dbRef        = null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  function _getDb()   { return typeof db !== "undefined" ? db : null; }
  function _getPlayer(){ return typeof player !== "undefined" ? player : null; }

  /** Captura el frame idle (row 0, col 0) del sprite del personaje como dataURL 64×80 */
  function _capturePortrait() {
    try {
      const CS = window.CharacterSystem;
      if (!CS || !window.csImageMap || !window.csAnimator) return null;
      const c = document.createElement("canvas");
      c.width = 64; c.height = 80;
      const cctx = c.getContext("2d");
      cctx.clearRect(0, 0, 64, 80);
      const sx = 32, sy = 72;
      const scaleX = 64 / (CS.DISPLAY_W || 180);
      const scaleY = 80 / (CS.DISPLAY_H || 220);
      cctx.save();
      cctx.translate(sx, sy);
      cctx.scale(scaleX, scaleY);
      cctx.translate(-sx, -sy);
      CS.drawPlayer(cctx, sx, sy, CS.player, window.csImageMap, window.csAnimator, {
        glovesId: CS.player?.appearance?.glovesId || "gm0",
        auraId: "a0",
        auraColor: CS.player?.appearance?.auraColor || "#fdd835",
        accessoryId: CS.player?.appearance?.accessoryId || "ac_none",
        auraPhase: 0,
        viewKey: null,
        spriteVariantId: null,
      });
      cctx.restore();
      return c.toDataURL("image/png");
    } catch(e) { return null; }
  }

  // ── Render de mensajes ───────────────────────────────────────────────────
  function _renderMessages() {
    const box = document.getElementById("rpgChatMessages");
    if (!box) return;
    box.innerHTML = "";
    _messages.slice(-MAX_MSGS).forEach(msg => {
      const em = EMOTIONS.find(e => e.id === msg.emotion) || EMOTIONS[0];
      const color = EMOTION_COLORS[msg.emotion] || EMOTION_COLORS.normal;
      const el = document.createElement("div");
      el.className = "rpg-msg";
      el.style.cssText = `border-color:${color};`;
      el.innerHTML = `
        <div class="rpg-msg-portrait">
          ${msg.portrait
            ? `<img src="${msg.portrait}" style="width:40px;height:50px;object-fit:cover;image-rendering:pixelated">`
            : `<div class="rpg-msg-avatar">${(msg.name||"?")[0].toUpperCase()}</div>`
          }
          <span class="rpg-msg-em">${em.icon}</span>
        </div>
        <div class="rpg-msg-body">
          <span class="rpg-msg-name" style="color:${color !== "#2a3560" ? color : "#00e5ff"}">${msg.name||"?"}</span>
          <span class="rpg-msg-text">${msg.text}</span>
        </div>`;
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  }

  // ── Enviar mensaje ───────────────────────────────────────────────────────
  function send() {
    const inp = document.getElementById("rpgChatInput");
    if (!inp) return;
    const text = inp.value.trim().slice(0, 100);
    if (!text) return;
    inp.value = "";
    const p = _getPlayer();
    const portrait = _capturePortrait();
    const msg = {
      id:   (typeof myPlayerId !== "undefined" ? myPlayerId : "local"),
      name: p?.name || "Guerrero",
      text,
      emotion:  _currentEm,
      portrait: portrait || "",
      t: Date.now()
    };
    // Local
    _messages.push(msg);
    if (_messages.length > MAX_MSGS) _messages.shift();
    _renderMessages();
    // Firebase
    const database = _getDb();
    if (database && typeof mpConnected !== "undefined" && mpConnected) {
      database.ref(DB_PATH).push().set(msg);
    }
  }

  // ── Inicializar listener Firebase ────────────────────────────────────────
  function _initDb() {
    const database = _getDb();
    if (!database) return;
    database.ref(DB_PATH).limitToLast(MAX_MSGS).on("child_added", snap => {
      const msg = snap.val();
      if (!msg) return;
      // Evitar duplicar mensajes propios (ya insertados localmente)
      const myId = typeof myPlayerId !== "undefined" ? myPlayerId : null;
      if (msg.id === myId) return;
      _messages.push(msg);
      if (_messages.length > MAX_MSGS) _messages.shift();
      _renderMessages();
    });
  }

  // ── Inyectar CSS y HTML ──────────────────────────────────────────────────
  function init() {
    if (_initialized) return;
    _initialized = true;

    // ── CSS ──
    const style = document.createElement("style");
    style.textContent = `
      /* ── RPG Chat Panel ── */
      #rpgChatPanel {
        position:relative; top:auto; left:auto; right:auto; bottom:auto;
        width: clamp(260px, 32vw, 380px);
        height:auto; max-height:52px;
        background:#080a10; border:1px solid #2a3560;
        border-bottom-right-radius:10px; border-top-right-radius:10px; border-bottom:none; border-left:none;
        z-index:30; font-family:Rajdhani,sans-serif; display:flex;
        flex-direction:column;
        transition:max-height .28s cubic-bezier(.4,0,.2,1), left .3s ease;
        pointer-events:auto;
        overflow:hidden;
      }
      #rpgChatPanel.open { max-height: clamp(220px, 38vh, 420px); }
      @media (min-width:1200px) { #rpgChatPanel { width:380px; } #rpgChatPanel.open { max-height:420px; } }
      @media (max-height:500px) { #rpgChatPanel.open { max-height:calc(100vh - 8px); border-radius:0; } #rpgChatPanel { border-radius:0; } }
      @media (max-width:400px)  { #rpgChatPanel { width:100vw; border-radius:0; border-left:1px solid #2a3560; } #rpgChatPanel.open { max-height:clamp(200px,50vh,340px); } }
      #rpgChatToggle {
        display:flex; align-items:center; gap:8px; padding:7px 12px;
        cursor:pointer; touch-action:manipulation;
        border-bottom:1px solid transparent; transition:border-color .2s;
        flex-shrink:0; min-height:52px; box-sizing:border-box;
        -webkit-tap-highlight-color:transparent;
      }
      #rpgChatPanel.open #rpgChatToggle { border-color:#2a3560; }
      .rpg-toggle-portrait {
        width:34px; height:42px; background:#12172e; border:1px solid #2a3560;
        border-radius:4px; overflow:hidden; flex-shrink:0; image-rendering:pixelated;
      }
      .rpg-toggle-portrait img { width:100%; height:100%; object-fit:cover; image-rendering:pixelated; display:block; }
      .rpg-toggle-label { font-family:"Orbitron",monospace; font-size:8px; letter-spacing:2px; color:var(--accent,#f5c400); flex:1; }
      .rpg-toggle-arrow { font-size:13px; color:#8892b0; transition:transform .3s; }
      #rpgChatPanel.open .rpg-toggle-arrow { transform:rotate(180deg); }

      #rpgChatBody {
        display:flex; flex-direction:column; gap:6px;
        padding:8px 10px 6px; flex:1; min-height:0; overflow:hidden;
      }
      #rpgChatMessages {
        flex:1; min-height:0;
        overflow-y:auto; overflow-x:hidden;
        display:flex; flex-direction:column; gap:5px;
        scrollbar-width:thin; scrollbar-color:rgba(245,196,0,.35) transparent;
        overscroll-behavior:contain; padding-right:2px;
      }
      #rpgChatMessages::-webkit-scrollbar { width:4px; }
      #rpgChatMessages::-webkit-scrollbar-track { background:transparent; }
      #rpgChatMessages::-webkit-scrollbar-thumb { background:rgba(245,196,0,.35); border-radius:4px; }
      .rpg-msg {
        display:flex; gap:8px; align-items:flex-start; padding:6px 8px;
        background:rgba(255,255,255,.03); border:1px solid #2a3560;
        border-left-width:3px; border-radius:6px; animation:rpgMsgIn .18s ease; flex-shrink:0;
      }
      @keyframes rpgMsgIn { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:none} }
      .rpg-msg-portrait { position:relative; flex-shrink:0; }
      .rpg-msg-avatar {
        width:38px; height:48px; background:#12172e; border:1px solid #2a3560;
        border-radius:3px; display:flex; align-items:center; justify-content:center;
        font-family:"Orbitron",monospace; font-size:13px; color:#4a5880;
      }
      .rpg-msg-em { position:absolute; bottom:-4px; right:-4px; font-size:13px; background:#08090f; border-radius:50%; padding:1px; line-height:1; }
      .rpg-msg-body { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
      .rpg-msg-name { font-family:"Orbitron",monospace; font-size:8px; letter-spacing:1px; }
      .rpg-msg-text { font-size:13px; color:#c8cfe8; line-height:1.4; word-break:break-word; }

      #rpgInputRow {
        display:flex; gap:6px; align-items:center;
        flex-shrink:0; padding-top:4px;
        border-top:1px solid rgba(42,53,96,.6);
        position:relative;
      }
      #rpgChatInput {
        flex:1; min-width:0; background:#12172e; border:1px solid #2a3560; border-radius:5px;
        padding:7px 8px; color:#e8eaf6; font-family:Rajdhani,sans-serif; font-size:14px;
        outline:none; -webkit-appearance:none;
      }
      #rpgChatInput:focus { border-color:rgba(245,196,0,.5); }
      #rpgEmotionBtn {
        background:rgba(245,196,0,.1); border:1px solid #2a3560; border-radius:5px;
        width:36px; height:36px; cursor:pointer; font-size:17px; display:flex;
        align-items:center; justify-content:center; flex-shrink:0;
        touch-action:manipulation; transition:border-color .15s;
        -webkit-tap-highlight-color:transparent;
      }
      #rpgEmotionBtn:hover,#rpgEmotionBtn:active { border-color:rgba(245,196,0,.6); }
      #rpgSendBtn {
        background:rgba(245,196,0,.15); border:1px solid rgba(245,196,0,.4);
        border-radius:5px; color:var(--accent,#f5c400); font-family:"Orbitron",monospace;
        font-size:9px; padding:0 10px; height:36px; cursor:pointer; flex-shrink:0;
        touch-action:manipulation; -webkit-tap-highlight-color:transparent;
      }
      #rpgSendBtn:active { background:rgba(245,196,0,.3); }
      #rpgEmPicker {
        position:absolute; bottom:calc(100% + 6px); left:0;
        width:min(240px,90vw);
        background:rgba(8,9,15,.97); border:1px solid #2a3560; border-radius:8px;
        display:none; flex-wrap:wrap; gap:4px; padding:8px; z-index:60;
        
        max-height:200px; overflow-y:auto;
        scrollbar-width:thin; scrollbar-color:rgba(245,196,0,.3) transparent;
      }
      #rpgEmPicker.open { display:flex; }
      .rpg-em-opt {
        display:flex; flex-direction:column; align-items:center; gap:2px;
        padding:6px 7px; border:1px solid #2a3560; border-radius:5px;
        cursor:pointer; font-size:18px; background:rgba(255,255,255,.03);
        transition:all .12s; touch-action:manipulation;
        min-width:44px; min-height:44px; justify-content:center;
      }
      .rpg-em-opt:hover,.rpg-em-opt.active { border-color:var(--accent,#f5c400); background:rgba(245,196,0,.08); }
      .rpg-em-opt span { font-family:"Orbitron",monospace; font-size:7px; color:#8892b0; }
      /* Left side action menu (combat + actions) */
      #leftActionMenu { display:flex; align-items:center; gap:8px; padding:8px; border-top:1px solid rgba(42,53,96,.6); margin-top:8px; }
      #leftActionMenu .left-action-combat { width:44px; height:44px; border-radius:6px; background:rgba(170,0,255,.12); border:1px solid #2a3560; color:var(--accent); display:flex; align-items:center; justify-content:center; cursor:pointer; font-size:18px; }
      #leftActionMenu .left-action-rows { display:flex; flex-direction:column; gap:6px; flex:1; }
      .left-action-btn { background:rgba(255,255,255,.03); border:1px solid #2a3560; padding:8px; border-radius:6px; color:#c8cfe8; text-align:center; cursor:pointer; font-family:"Orbitron",monospace; font-size:11px; }
      .left-action-btn:active { background:rgba(170,0,255,.06); }
      #leftPanelStack {
        position:fixed !important;
        left:12px !important;
        bottom:12px !important;
        display:flex !important;
        flex-direction:column !important;
        gap:8px !important;
        width:min(360px,32vw) !important;
        max-width:420px !important;
        z-index:220 !important;
        pointer-events:none !important;
      }
      #leftPanelStack > div {
        position:relative !important;
        width:100% !important;
        left:auto !important;
        right:auto !important;
        top:auto !important;
        bottom:auto !important;
        margin:0 !important;
      }
      #woPanel { order:1 !important; }
      #npcPanel { order:2 !important; }
      #rpgChatPanel { order:3 !important; }
      #woPanel,
      #npcPanel,
      #rpgChatPanel { border-radius:12px !important; }
      #mobileActionCorner { display:none !important; }
      @media (pointer:coarse), (max-width:768px) {
        #mobileActionCorner {
          display:flex !important;
          position:fixed !important;
          top:12px !important;
          right:12px !important;
          flex-direction:column !important;
          gap:8px !important;
          z-index:230 !important;
          pointer-events:auto !important;
        }
        #mobileActionCorner .action-btn {
          width:52px !important;
          height:52px !important;
          min-width:52px !important;
          min-height:52px !important;
          border-radius:18px !important;
          justify-content:center !important;
        }
        .mobile-controls .action-grid { display:none !important; }
      }
      @media (pointer:fine) {
        #mobileActionCorner { display:none !important; }
      }
    `;
    document.head.appendChild(style);

    // ── HTML ──
    const panel = document.createElement("div");
    panel.id = "rpgChatPanel";
    panel.innerHTML = `
      <div id="rpgChatToggle" onclick="RpgChatSystem.toggle()">
        <div class="rpg-toggle-portrait" id="rpgTogglePortrait">
          <img id="rpgToggleImg" src="" onerror="this.style.display='none'">
        </div>
        <span class="rpg-toggle-label">💬 CHAT RPG</span>
        <span class="rpg-toggle-arrow">▲</span>
      </div>
      <div id="rpgChatBody">
        <div id="rpgChatMessages"></div>
        <div id="rpgInputRow" style="position:relative">
          <div id="rpgEmPicker"></div>
          <button id="rpgEmotionBtn" onclick="RpgChatSystem.toggleEmPicker()" title="Emoción">😐</button>
          <input id="rpgChatInput" maxlength="100" placeholder="Habla en el mundo..."
            onkeydown="if(event.key==='Enter')RpgChatSystem.send()">
          <button id="rpgSendBtn" onclick="RpgChatSystem.send()">➤</button>
        </div>
      </div>`;
    const _panelHolder = document.getElementById("leftPanelStack") || document.body;
    _panelHolder.appendChild(panel);

    // Render emotion picker
    const picker = document.getElementById("rpgEmPicker");
    EMOTIONS.forEach(em => {
      const btn = document.createElement("div");
      btn.className = "rpg-em-opt" + (em.id === "normal" ? " active" : "");
      btn.dataset.em = em.id;
      btn.innerHTML = `${em.icon}<span>${em.label}</span>`;
      btn.onclick = () => {
        document.querySelectorAll(".rpg-em-opt").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        _currentEm = em.id;
        document.getElementById("rpgEmotionBtn").textContent = em.icon;
        RpgChatSystem.toggleEmPicker(false);
      };
      picker.appendChild(btn);
    });

    // Actualizar portrait cada 3 s
    setInterval(() => {
      const portrait = _capturePortrait();
      if (portrait) {
        const img = document.getElementById("rpgToggleImg");
        if (img) { img.src = portrait; img.style.display = "block"; }
      }
    }, 3000);

    // Init Firebase listener (con retry si db no está listo todavía)
    const tryDb = setInterval(() => {
      if (typeof db !== "undefined") {
        clearInterval(tryDb);
        _initDb();
      }
    }, 500);
  }

  // ── API Pública ───────────────────────────────────────────────────────────
  return {
    init,
    send,
    toggle(force) {
      const panel = document.getElementById("rpgChatPanel");
      if (!panel) return;
      _open = force !== undefined ? force : !_open;
      panel.classList.toggle("open", _open);
    },
    toggleEmPicker(force) {
      const picker = document.getElementById("rpgEmPicker");
      if (!picker) return;
      _emOpen = force !== undefined ? force : !_emOpen;
      picker.classList.toggle("open", _emOpen);
    }
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SISTEMA 2 — VEHICLE OVERLAY
   Dibuja un PNG por encima del jugador (auto) o por debajo (moto, nube voladora).
   Se llama desde drawPlayerChar DESPUÉS de CS.drawPlayer.

   Uso en game.html:
     // en drawPlayerChar, luego de CS.drawPlayer:
     VehicleOverlay.draw(ctx, sx, sy, player, SPRITE_DRAW_W, SPRITE_DRAW_H);
   ═══════════════════════════════════════════════════════════════════════════ */

const VehicleOverlay = (() => {
  // Config por tipo de vehículo
  // layer: "above" | "below"  (relativo al jugador)
  // offsetX/Y: desplazamiento en px desde el centro del jugador
  // w / h: tamaño de dibujo en px (world units escalados por cam)
  const VEHICLE_CONFIG = {
    drive_moto: {
      layer: "below",
      src: "Vehiculos/moto.png",
      w: 110, h: 68,
      offsetX: 0, offsetY: 24,
    },
    drive_auto: {
      layer: "above",
      src: "Vehiculos/auto.png",
      w: 140, h: 80,
      offsetX: 0, offsetY: 10,
    },
    drive_nube: {
      layer: "below",
      src: "Vehiculos/nube_voladora.png",
      w: 120, h: 56,
      offsetX: 0, offsetY: 30,
    },
    drive_nube_run: {
      layer: "below",
      src: "Vehiculos/nube_voladora.png",
      w: 140, h: 64,
      offsetX: 0, offsetY: 28,
    },
  };

  const _imgs = {};

  function _load(src) {
    if (_imgs[src]) return _imgs[src];
    const img = new Image();
    img.src = src;
    _imgs[src] = img;
    return img;
  }

  // Pre-cargar todas las imágenes al arrancar
  function preload() {
    Object.values(VEHICLE_CONFIG).forEach(cfg => _load(cfg.src));
  }

  /**
   * Llamar DOS VECES desde drawPlayerChar: antes y después de CS.drawPlayer.
   * phase = "below" | "above"
   */
  function draw(ctx, sx, sy, playerObj, spriteW, spriteH, phase) {
    // activeDrive es variable global del juego
    const driveId = typeof activeDrive !== "undefined" ? activeDrive : null;
    if (!driveId) return;
    const cfg = VEHICLE_CONFIG[driveId];
    if (!cfg) return;
    if (cfg.layer !== phase) return;

    const img = _load(cfg.src);
    if (!img.complete || img.naturalWidth === 0) return;

    const facing = playerObj?.facing ?? 1;
    const dx = sx + cfg.offsetX;
    const dy = sy + cfg.offsetY;
    const hw = cfg.w / 2;

    ctx.save();
    if (facing === -1) {
      // Espejo horizontal
      ctx.translate(dx, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -hw, -cfg.h / 2, cfg.w, cfg.h);
    } else {
      ctx.drawImage(img, dx - hw, dy - cfg.h / 2, cfg.w, cfg.h);
    }
    ctx.restore();
  }

  /**
   * Para jugadores remotos. Llamar igual que draw().
   * driveIdOverride: el drive del jugador remoto.
   * Si no se pasa, se intenta inferir desde remotePlayer.animAction
   * (el server ya publica animAction="drive_moto" etc. cuando el jugador conduce).
   */
  function drawRemote(ctx, sx, sy, remotePlayer, driveIdOverride, phase) {
    const driveId = driveIdOverride
      || (remotePlayer?.animAction && VEHICLE_CONFIG[remotePlayer.animAction]
          ? remotePlayer.animAction : null);
    if (!driveId) return;
    const cfg = VEHICLE_CONFIG[driveId];
    if (!cfg || cfg.layer !== phase) return;
    const img = _load(cfg.src);
    if (!img.complete || img.naturalWidth === 0) return;

    const facing = remotePlayer?.facing ?? 1;
    const dx = sx + cfg.offsetX;
    const dy = sy + cfg.offsetY;
    const hw = cfg.w / 2;
    ctx.save();
    if (facing === -1) {
      ctx.translate(dx, dy); ctx.scale(-1, 1);
      ctx.drawImage(img, -hw, -cfg.h / 2, cfg.w, cfg.h);
    } else {
      ctx.drawImage(img, dx - hw, dy - cfg.h / 2, cfg.w, cfg.h);
    }
    ctx.restore();
  }

  return { preload, draw, drawRemote, VEHICLE_CONFIG };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SISTEMA 3 — WORLD OBJECTS (Objetos colocables con colisión)
   Esferas del dragón, sillas, camas, portales decorativos, etc.
   Sincronizados en Firebase Realtime Database bajo "worldObjects/{map}/".

   API:
     WorldObjectsSystem.init()          — llamar una vez al cargar
     WorldObjectsSystem.draw(ctx, cam)  — llamar en el game loop
     WorldObjectsSystem.openPlaceUI()   — abrir menú de colocación
     WorldObjectsSystem.checkCollision(x, y, w, h) → bool  — para movimiento
   ═══════════════════════════════════════════════════════════════════════════ */

const WorldObjectsSystem = (() => {
  // ── Catálogo de objetos colocables ────────────────────────────────────────
  const CATALOG = [
    // Esferas del Dragón
    { id:"db1",   label:"Esfera 1★",    src:"Objetos/esfera1.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db2",   label:"Esfera 2★",    src:"Objetos/esfera2.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db3",   label:"Esfera 3★",    src:"Objetos/esfera3.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db4",   label:"Esfera 4★",    src:"Objetos/esfera4.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db5",   label:"Esfera 5★",    src:"Objetos/esfera5.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db6",   label:"Esfera 6★",    src:"Objetos/esfera6.png",   w:32, h:32, collision:false, category:"dragon" },
    { id:"db7",   label:"Esfera 7★",    src:"Objetos/esfera7.png",   w:32, h:32, collision:false, category:"dragon" },
    // Muebles
    { id:"chair", label:"Silla",        src:"Muebles/silla.png",     w:40, h:48, collision:true,  category:"furniture" },
    { id:"bed",   label:"Cama",         src:"Muebles/cama.png",      w:96, h:56, collision:true,  category:"furniture" },
    { id:"table", label:"Mesa",         src:"Muebles/mesa.png",      w:72, h:48, collision:true,  category:"furniture" },
    // Vehículos estáticos
    { id:"s_moto",label:"Moto (parq.)", src:"Vehiculos/moto.png",    w:110,h:68, collision:true,  category:"vehicle"   },
    { id:"s_auto",label:"Auto (parq.)", src:"Vehiculos/auto.png",    w:140,h:80, collision:true,  category:"vehicle"   },
    // Construcción
    { id:"wall_s",label:"Pared corta",  src:"Construccion/pared_c.png",w:48,h:64,collision:true,  category:"build"     },
    { id:"wall_l",label:"Pared larga",  src:"Construccion/pared_l.png",w:96,h:64,collision:true,  category:"build"     },
    { id:"gate",  label:"Puerta",       src:"Construccion/puerta.png",w:48,h:80, collision:false, category:"build"     },
    // Decoración
    { id:"decor_rock",label:"Roca",     src:"Decoracion/roca.png",   w:64, h:48, collision:true,  category:"deco"      },
    { id:"decor_tree",label:"Árbol",    src:"Decoracion/arbol.png",  w:64, h:80, collision:true,  category:"deco"      },
    { id:"decor_sign",label:"Cartel",   src:"Decoracion/cartel.png", w:48, h:64, collision:false, category:"deco"      },
  ];

  const CATEGORIES = [
    { id:"all",       label:"Todo"        },
    { id:"dragon",    label:"🐉 Esferas"  },
    { id:"furniture", label:"🪑 Muebles"  },
    { id:"vehicle",   label:"🚗 Vehículos"},
    { id:"build",     label:"🧱 Construir"},
    { id:"deco",      label:"🌿 Decoración"},
  ];

  // ── Estado ────────────────────────────────────────────────────────────────
  let _objects    = {};   // { id: { id, catalogId, x, y, map, ownerId, t } }
  let _imgs       = {};
  let _initialized= false;
  let _placing    = null; // catalogId en modo colocación
  let _filterCat  = "all";
  let _dbListeners= {};   // map → listener handle
  let _uiOpen     = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _getDb()  { return typeof db !== "undefined" ? db : null; }
  function _getMap() { return typeof currentMap !== "undefined" ? currentMap : "lobby"; }
  function _getPlayerId() { return typeof myPlayerId !== "undefined" ? myPlayerId : "local"; }
  function _getPlayer()   { return typeof player !== "undefined" ? player : null; }
  function _getCam()      { return typeof cam !== "undefined" ? cam : {x:0,y:0}; }
  function _getCatalog(id){ return CATALOG.find(c => c.id === id); }

  function _loadImg(src) {
    if (_imgs[src]) return _imgs[src];
    const img = new Image();
    img.src = src;
    _imgs[src] = img;
    return img;
  }

  function _genId() {
    return "obj_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }

  // ── Firebase sync ─────────────────────────────────────────────────────────
  function _listenMap(mapKey) {
    const database = _getDb();
    if (!database || _dbListeners[mapKey]) return;
    const ref = database.ref("worldObjects/" + mapKey);
    _dbListeners[mapKey] = ref;
    ref.on("value", snap => {
      const data = snap.val() || {};
      // Merge: keep only objects for this map
      Object.keys(_objects).forEach(id => {
        if (_objects[id].map === mapKey) delete _objects[id];
      });
      Object.entries(data).forEach(([id, obj]) => {
        _objects[id] = obj;
        const cfg = _getCatalog(obj.catalogId);
        if (cfg) _loadImg(cfg.src);
      });
    });
  }

  function _placeOnDb(obj) {
    const database = _getDb();
    if (!database) { _objects[obj.id] = obj; return; }
    database.ref("worldObjects/" + obj.map + "/" + obj.id).set(obj);
  }

  function _removeFromDb(objId, mapKey) {
    delete _objects[objId];
    const database = _getDb();
    if (!database) return;
    database.ref("worldObjects/" + mapKey + "/" + objId).remove();
  }

  // ── Colocar objeto ────────────────────────────────────────────────────────
  function _place(worldX, worldY) {
    if (!_placing) return;
    const cfg = _getCatalog(_placing);
    if (!cfg) return;
    const obj = {
      id:       _genId(),
      catalogId:_placing,
      x:        Math.round(worldX),
      y:        Math.round(worldY),
      map:      _getMap(),
      ownerId:  _getPlayerId(),
      t:        Date.now()
    };
    _placeOnDb(obj);
    _placing = null;
    _updatePlacingCursor();
    if (typeof showHudToast === "function")
      showHudToast("Objeto colocado ✓", "xp");
  }

  // ── Colisión ──────────────────────────────────────────────────────────────
  function checkCollision(px, py, pw, ph) {
    const map = _getMap();
    for (const obj of Object.values(_objects)) {
      if (obj.map !== map) continue;
      const cfg = _getCatalog(obj.catalogId);
      if (!cfg || !cfg.collision) continue;
      const ox = obj.x - cfg.w / 2, oy = obj.y - cfg.h;
      if (px < ox + cfg.w && px + pw > ox &&
          py < oy + cfg.h && py + ph > oy) return true;
    }
    return false;
  }

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw(ctx, camObj) {
    const map = _getMap();
    const c = camObj || _getCam();
    for (const obj of Object.values(_objects)) {
      if (obj.map !== map) continue;
      const cfg = _getCatalog(obj.catalogId);
      if (!cfg) continue;
      const img = _loadImg(cfg.src);
      const sx = obj.x - c.x - cfg.w / 2;
      const sy = obj.y - c.y - cfg.h;
      if (!img.complete || img.naturalWidth === 0) {
        // Placeholder mientras carga
        ctx.save();
        ctx.fillStyle = "rgba(245,196,0,.3)";
        ctx.strokeStyle = "rgba(245,196,0,.6)";
        ctx.lineWidth = 1;
        ctx.fillRect(sx, sy, cfg.w, cfg.h);
        ctx.strokeRect(sx, sy, cfg.w, cfg.h);
        ctx.fillStyle = "#f5c400";
        ctx.font = "9px Orbitron,monospace";
        ctx.textAlign = "center";
        ctx.fillText(cfg.label.slice(0,6), sx + cfg.w/2, sy + cfg.h/2);
        ctx.restore();
      } else {
        ctx.drawImage(img, sx, sy, cfg.w, cfg.h);
      }
      // Indicador del dueño (solo en modo edición)
      if (_uiOpen && obj.ownerId === _getPlayerId()) {
        ctx.save();
        ctx.strokeStyle = "rgba(245,196,0,.8)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(sx - 2, sy - 2, cfg.w + 4, cfg.h + 4);
        ctx.restore();
      }
    }

    // Preview del objeto en colocación
    if (_placing) {
      const p = _getPlayer();
      const c2 = _getCam();
      if (p) {
        const cfg = _getCatalog(_placing);
        const img = _loadImg(cfg.src);
        // Seguir el centro de la pantalla si estamos en móvil, o el cursor
        const tx = _placingTarget.x !== null ? _placingTarget.x : p.x;
        const ty = _placingTarget.y !== null ? _placingTarget.y : p.y + 80;
        const sx2 = tx - c2.x - cfg.w / 2;
        const sy2 = ty - c2.y - cfg.h;
        ctx.save();
        ctx.globalAlpha = 0.6;
        if (img.complete && img.naturalWidth > 0)
          ctx.drawImage(img, sx2, sy2, cfg.w, cfg.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#f5c400";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(sx2 - 1, sy2 - 1, cfg.w + 2, cfg.h + 2);
        ctx.restore();
      }
    }
  }

  // ── Modo colocación: target cursor/touch ──────────────────────────────────
  const _placingTarget = { x: null, y: null };

  function _onMouseMove(e) {
    if (!_placing) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = (typeof cam !== "undefined" ? 1 : 1);
    const c = _getCam();
    _placingTarget.x = (e.clientX - rect.left) + c.x;
    _placingTarget.y = (e.clientY - rect.top)  + c.y;
  }
  function _onMouseDown(e) {
    if (!_placing || e.button !== 0) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    if (e.target !== canvas) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const c = _getCam();
    _place((e.clientX - rect.left) + c.x, (e.clientY - rect.top) + c.y);
  }
  function _onTouchEnd(e) {
    if (!_placing) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const c = _getCam();
    _place((touch.clientX - rect.left) + c.x, (touch.clientY - rect.top) + c.y);
  }

  function _updatePlacingCursor() {
    const canvas = document.getElementById("gameCanvas");
    if (canvas) canvas.style.cursor = _placing ? "crosshair" : "";
    const btn = document.getElementById("woPlaceBtn");
    if (btn) btn.textContent = _placing ? "❌ Cancelar" : "📍 Colocar aquí";
  }

  // ── UI Panel ──────────────────────────────────────────────────────────────
  function _buildUI() {
    const style = document.createElement("style");
    style.textContent = `
      #woPanel {
        position:relative; top:auto; left:auto; right:auto; bottom:auto;
        width: clamp(260px, 32vw, 360px);
        height:auto; max-height:52px;
        background:#080a10; border:1px solid #2a3560;
        border-top-left-radius:10px; border-bottom:none; border-right:none;
        z-index:30; font-family:Rajdhani,sans-serif; display:flex;
        flex-direction:column;
        transition:max-height .28s cubic-bezier(.4,0,.2,1);
        pointer-events:auto;
        overflow:hidden;
      }
      #woPanel.open { max-height: clamp(260px, 45vh, 480px); }
      @media (min-width:1200px) { #woPanel { width:360px; } #woPanel.open { max-height:480px; } }
      @media (max-height:500px) { #woPanel.open { max-height:calc(100vh - 8px); border-radius:0; } #woPanel { border-radius:0; } }
      @media (max-width:400px)  { #woPanel { width:100vw; border-radius:0; border-right:1px solid #2a3560; } #woPanel.open { max-height:clamp(240px,55vh,380px); } }

      #woToggle {
        display:flex; align-items:center; gap:8px; padding:7px 12px;
        cursor:pointer; touch-action:manipulation;
        border-bottom:1px solid transparent; transition:border-color .2s;
        flex-shrink:0; min-height:52px; box-sizing:border-box;
        -webkit-tap-highlight-color:transparent;
      }
      #woPanel.open #woToggle { border-color:#2a3560; }
      .wo-toggle-icon { font-size:18px; }
      .wo-toggle-label { font-family:"Orbitron",monospace; font-size:8px; letter-spacing:2px; color:var(--accent,#f5c400); flex:1; }
      .wo-toggle-arrow { font-size:13px; color:#8892b0; transition:transform .3s; }
      #woPanel.open .wo-toggle-arrow { transform:rotate(180deg); }

      #woBody {
        display:flex; flex-direction:column; gap:6px;
        padding:8px 10px 6px; flex:1; min-height:0; overflow:hidden;
      }
      #woCatRow {
        display:flex; gap:4px; overflow-x:auto; flex-shrink:0;
        padding-bottom:4px; scrollbar-width:none;
      }
      #woCatRow::-webkit-scrollbar { display:none; }
      .wo-cat {
        padding:5px 9px; background:rgba(255,255,255,.04); border:1px solid #2a3560; border-radius:5px;
        font-family:"Orbitron",monospace; font-size:7px; letter-spacing:1px; color:#8892b0;
        cursor:pointer; white-space:nowrap; touch-action:manipulation; transition:all .12s;
        min-height:30px; display:flex; align-items:center; flex-shrink:0;
        -webkit-tap-highlight-color:transparent;
      }
      .wo-cat.active { border-color:var(--accent,#f5c400); color:var(--accent,#f5c400); background:rgba(245,196,0,.08); }
      .wo-cat:active { background:rgba(245,196,0,.12); }

      #woSelectedLabel { font-family:"Orbitron",monospace; font-size:8px; color:#8892b0; text-align:center; flex-shrink:0; padding:2px 0; }

      #woCatalog {
        flex:1; min-height:0;
        overflow-y:auto; overflow-x:hidden;
        display:grid; grid-template-columns:1fr 1fr; gap:6px;
        align-content:start;
        scrollbar-width:thin; scrollbar-color:rgba(245,196,0,.35) transparent;
        overscroll-behavior:contain; padding-right:2px;
      }
      #woCatalog::-webkit-scrollbar { width:4px; }
      #woCatalog::-webkit-scrollbar-track { background:transparent; }
      #woCatalog::-webkit-scrollbar-thumb { background:rgba(245,196,0,.35); border-radius:4px; }
      @media (min-width:900px) { #woCatalog { grid-template-columns:1fr 1fr 1fr; } }

      .wo-item {
        display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 6px;
        background:rgba(255,255,255,.03); border:1px solid #2a3560; border-radius:7px;
        cursor:pointer; touch-action:manipulation; transition:all .12s;
        -webkit-tap-highlight-color:transparent;
      }
      .wo-item:hover,.wo-item.selected { border-color:var(--accent,#f5c400); background:rgba(245,196,0,.08); }
      .wo-item:active { background:rgba(245,196,0,.12); }
      .wo-item img { width:48px; height:36px; object-fit:contain; image-rendering:pixelated; }
      .wo-item-placeholder { width:48px; height:36px; background:#12172e; border:1px solid #2a3560; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#4a5880; }
      .wo-item-label { font-family:"Orbitron",monospace; font-size:7px; letter-spacing:.5px; color:#c8cfe8; text-align:center; }

      #woActionRow { display:flex; gap:6px; flex-shrink:0; padding-top:2px; border-top:1px solid rgba(42,53,96,.6); }
      #woPlaceBtn {
        flex:1; background:rgba(245,196,0,.15); border:1px solid rgba(245,196,0,.4);
        border-radius:5px; color:var(--accent,#f5c400); font-family:"Orbitron",monospace;
        font-size:9px; padding:10px 6px; cursor:pointer; touch-action:manipulation;
        -webkit-tap-highlight-color:transparent; min-height:40px;
      }
      #woPlaceBtn:active { background:rgba(245,196,0,.3); }
      #woRemoveBtn {
        background:rgba(255,23,68,.1); border:1px solid rgba(255,23,68,.3);
        border-radius:5px; color:#ff1744; font-family:"Orbitron",monospace;
        font-size:9px; padding:10px 12px; cursor:pointer; touch-action:manipulation;
        -webkit-tap-highlight-color:transparent; min-height:40px;
      }
      #woRemoveBtn:active { background:rgba(255,23,68,.25); }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "woPanel";
    panel.innerHTML = `
      <div id="woToggle" onclick="WorldObjectsSystem.toggleUI()">
        <span class="wo-toggle-icon">🗺️</span>
        <span class="wo-toggle-label">OBJETOS MUNDO</span>
        <span class="wo-toggle-arrow">▲</span>
      </div>
      <div id="woBody">
        <div id="woCatRow"></div>
        <div id="woSelectedLabel">— ninguno seleccionado —</div>
        <div id="woCatalog"></div>
        <div id="woActionRow">
          <button id="woPlaceBtn" onclick="WorldObjectsSystem.startPlace()">📍 Colocar aquí</button>
          <button id="woRemoveBtn" onclick="WorldObjectsSystem.removeOwned()">🗑️ Borrar</button>
        </div>
      </div>`;
    const _panelHolder = document.getElementById("leftPanelStack") || document.body;
    _panelHolder.appendChild(panel);

    // Categorías
    const catRow = document.getElementById("woCatRow");
    CATEGORIES.forEach(cat => {
      const btn = document.createElement("button");
      btn.className = "wo-cat" + (cat.id === "all" ? " active" : "");
      btn.textContent = cat.label;
      btn.dataset.cat = cat.id;
      btn.onclick = () => {
        document.querySelectorAll(".wo-cat").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        _filterCat = cat.id;
        _renderCatalog();
      };
      catRow.appendChild(btn);
    });

    _renderCatalog();
  }

  let _selectedCatalogId = null;

  function _renderCatalog() {
    const grid = document.getElementById("woCatalog");
    if (!grid) return;
    grid.innerHTML = "";
    const items = _filterCat === "all" ? CATALOG : CATALOG.filter(c => c.category === _filterCat);
    items.forEach(cfg => {
      const el = document.createElement("div");
      el.className = "wo-item" + (cfg.id === _selectedCatalogId ? " selected" : "");
      const img = _loadImg(cfg.src);
      el.innerHTML = `
        <img src="${cfg.src}" onerror="this.style.display='none'" width="48" height="36">
        <span class="wo-item-label">${cfg.label}</span>`;
      el.onclick = () => {
        _selectedCatalogId = cfg.id;
        document.querySelectorAll(".wo-item").forEach(e => e.classList.remove("selected"));
        el.classList.add("selected");
        const lbl = document.getElementById("woSelectedLabel");
        if (lbl) lbl.textContent = "Seleccionado: " + cfg.label;
      };
      grid.appendChild(el);
    });
  }

  // ── API Pública ───────────────────────────────────────────────────────────
  function init() {
    if (_initialized) return;
    _initialized = true;

    _buildUI();

    // Precargar imágenes
    CATALOG.forEach(c => _loadImg(c.src));
    VehicleOverlay.preload();

    // Listeners de canvas
    const canvas = document.getElementById("gameCanvas");
    if (canvas) {
      canvas.addEventListener("mousemove", _onMouseMove);
      canvas.addEventListener("mousedown", _onMouseDown);
      canvas.addEventListener("touchend",  _onTouchEnd, { passive: false });
    }

    // Escuchar cambios de mapa
    let _lastMap = null;
    setInterval(() => {
      const map = _getMap();
      if (map !== _lastMap) {
        _lastMap = map;
        _listenMap(map);
      }
    }, 1000);

    // Intentar conectar Firebase
    const tryDb = setInterval(() => {
      if (typeof db !== "undefined") {
        clearInterval(tryDb);
        _listenMap(_getMap());
      }
    }, 500);
  }

  return {
    init,
    draw,
    checkCollision,
    toggleUI() {
      _uiOpen = !_uiOpen;
      const panel = document.getElementById("woPanel");
      if (panel) panel.classList.toggle("open", _uiOpen);
    },
    openPlaceUI() {
      _uiOpen = true;
      const panel = document.getElementById("woPanel");
      if (panel) panel.classList.add("open");
    },
    startPlace() {
      if (!_selectedCatalogId) {
        if (typeof showHudToast === "function")
          showHudToast("Seleccioná un objeto primero", "warning");
        return;
      }
      _placing = _placing === _selectedCatalogId ? null : _selectedCatalogId;
      _updatePlacingCursor();
      const btn = document.getElementById("woPlaceBtn");
      if (btn) btn.textContent = _placing ? "❌ Cancelar" : "📍 Colocar aquí";
    },
    cancelPlace() {
      _placing = null;
      _updatePlacingCursor();
    },
    /** Borra el objeto más cercano del jugador que le pertenezca */
    removeOwned() {
      const p = _getPlayer();
      if (!p) return;
      const map = _getMap();
      const myId = _getPlayerId();
      let nearest = null, nearDist = Infinity;
      for (const [id, obj] of Object.entries(_objects)) {
        if (obj.map !== map || obj.ownerId !== myId) continue;
        const dx = obj.x - p.x, dy = obj.y - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < nearDist) { nearDist = dist; nearest = id; }
      }
      if (nearest && nearDist < 300) {
        _removeFromDb(nearest, map);
        if (typeof showHudToast === "function")
          showHudToast("Objeto eliminado", "info");
      } else {
        if (typeof showHudToast === "function")
          showHudToast("Acercate al objeto para borrarlo", "warning");
      }
    },
    CATALOG
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   SISTEMA 4 — NPC SYSTEM
   • Catálogo de NPCs por bando (buenos / malos / neutrales)
   • Invocar un NPC en tu mapa actual (Firebase sync)
   • Diálogo interactivo estilo RPG (árbol de opciones)
   • RAIDS: el dueño del mapa lanza una raid; otros jugadores se unen
     como aliados O como refuerzo NPC-enemigo. Estado en Firebase.
   • Panel de gestión de NPCs (invocar, ver raids activas, unirse)
   ═══════════════════════════════════════════════════════════════════════════ */

const NpcSystem = (() => {
  "use strict";

  // ─────────────────────────────────────────────────────────────────────────
  // CATÁLOGO DE NPCs
  // faction: "good" | "evil" | "neutral"
  // dialogue: árbol { id, text, options:[{label, next, action}] }
  // stats: base de combate para raids
  // ─────────────────────────────────────────────────────────────────────────
  // ── SKINS disponibles en carpeta Skins/ ─────────────────────────────────
  const SKIN_CATALOG = [
    { id:"Arcosiano",     label:"Arcosiano",      src:"Skins/Arcosiano.png"     },
    { id:"Darkenezom",    label:"Darkenezom",     src:"Skins/Darkenezom.png"    },
    { id:"DirectorZ",     label:"Director Z",     src:"Skins/DirectorZ.png"     },
    { id:"HumanIdle",     label:"Humano",         src:"Skins/HumanIdle.png"     },
    { id:"HumanKid",      label:"Humano Joven",   src:"Skins/HumanKid.png"      },
    { id:"Kaioshin",      label:"Kaioshin",       src:"Skins/Kaioshin.png"      },
    { id:"KaioshinF",     label:"Kaioshin F",     src:"Skins/KaioshinF.png"     },
    { id:"Mecanica",      label:"Mecánica",       src:"Skins/Mecanica.png"      },
    { id:"MujerIdle",     label:"Mujer",          src:"Skins/MujerIdle.png"     },
    { id:"NamekianIdle",  label:"Namekiano",      src:"Skins/NamekianIdle.png"  },
    { id:"Ozaru",         label:"Ozaru",          src:"Skins/Ozaru.png"         },
    { id:"RobotNPC",      label:"Robot",          src:"Skins/RobotNPC.png"      },
  ];

  // ── PLANTILLAS por bando — sin nombre fijo, el usuario lo configura ──────
  // faction: grupo de invocación (good/evil/neutral)
  // npcFaction: bando real del juego para diálogos
  const NPC_CATALOG = [
    // ── BUENOS / ALIADOS ──────────────────────────────────────────────────────
    {
      id:"tpl_z_warrior",    name:"Guerrero Z",          faction:"good",    npcFaction:"z_warrior",
      emoji:"🔥",             color:"#f5c400",            src:"Skins/HumanIdle.png",
      stats:{ hp:1000, atk:150, def:80 },
      dialogues:{
        ally:{
          start:{ text:"¡Camarada! Qué bueno verte. ¿Entrenamos o hay amenaza?", options:[
            { label:"Entrenar juntos.",    next:null, action:"train_spar" },
            { label:"Hay una amenaza.",    next:"threat" },
            { label:"Todo bien, hasta luego.", next:null },
          ]},
          threat:{ text:"¡Contá conmigo! Los Guerreros Z no dejan que nada pase.", options:[
            { label:"Lanzar RAID defensiva", next:null, action:"raid_defend" },
            { label:"Te aviso cuando sea.", next:null },
          ]},
        },
        neutral:{
          start:{ text:"Hola. No te conozco bien, pero tampoco tengo razones para desconfiar.", options:[
            { label:"¿Podemos entrenar?",  next:"train" },
            { label:"Hasta luego.",        next:null },
          ]},
          train:{ text:"Bien, una ronda de práctica. Sin compromisos.", options:[
            { label:"¡Vamos!", next:null, action:"train_spar" },
            { label:"Mejor otro día.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"Sé de qué lado estás. Alejate de aquí antes de que sea tarde.", options:[
            { label:"No vine a pelear.", next:"warn" },
            { label:"¡Peleemos!",        next:"fight" },
          ]},
          warn:{ text:"Última advertencia.", options:[
            { label:"Me voy.", next:null },
          ]},
          fight:{ text:"¡No me dejás opción!", options:[
            { label:"¡RAID defensiva!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },
    {
      id:"tpl_galactic_patrol", name:"Agente Patrulla",  faction:"good",    npcFaction:"galactic_patrol",
      emoji:"🚔",               color:"#00e5ff",          src:"Skins/DirectorZ.png",
      stats:{ hp:900, atk:130, def:90 },
      dialogues:{
        ally:{
          start:{ text:"¡Agente en servicio! Siempre un placer con un aliado. ¿Novedades?", options:[
            { label:"Quiero entrenar.",    next:null, action:"train_spar" },
            { label:"¿Hay amenazas?",      next:"threat" },
            { label:"Todo tranquilo.",     next:null },
          ]},
          threat:{ text:"Confirmado. Hay movimientos sospechosos del Imperio. Actuamos juntos.", options:[
            { label:"Lanzar RAID conjunta", next:null, action:"raid_defend" },
            { label:"Reportado. Gracias.", next:null },
          ]},
        },
        neutral:{
          start:{ text:"Ciudadano. Podés pasar, pero atenete a las normas galácticas.", options:[
            { label:"¿Puedo entrenar aquí?", next:"train" },
            { label:"Entendido, agente.", next:null },
          ]},
          train:{ text:"Fuera de lo habitual, pero no hay razón para negarlo.", options:[
            { label:"Trato.", next:null, action:"train_spar" },
            { label:"Mejor en otro momento.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"¡ALTO! Tu bando es hostil. Identificate.", options:[
            { label:"No soy una amenaza.", next:"warn" },
            { label:"¡No me mandás!",      next:"fight" },
          ]},
          warn:{ text:"Tenés diez segundos antes de activar el protocolo de fuerza.", options:[
            { label:"Me retiro.", next:null },
            { label:"¡No me voy!", next:"fight" },
          ]},
          fight:{ text:"¡Protocolo activado! ¡Refuerzos!", options:[
            { label:"¡RAID ya!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },
    {
      id:"tpl_hero",          name:"Héroe",              faction:"good",    npcFaction:"heroes",
      emoji:"🦸",              color:"#00e676",           src:"Skins/HumanIdle.png",
      stats:{ hp:1200, atk:200, def:110 },
      dialogues:{
        ally:{
          start:{ text:"¡Otro guerrero del lado correcto! ¿Entrenamos o hay una amenaza?", options:[
            { label:"Entrenar.",           next:null, action:"train_spar" },
            { label:"Hay una amenaza.",    next:"threat" },
            { label:"Solo saludaba.",      next:null },
          ]},
          threat:{ text:"¡Los héroes protegen a los civiles ante todo. Cuenten conmigo!", options:[
            { label:"Lanzar RAID", next:null, action:"raid_defend" },
            { label:"Te aviso.", next:null },
          ]},
        },
        neutral:{
          start:{ text:"Hola. Un héroe no juzga sin pruebas. ¿Qué necesitás?", options:[
            { label:"¿Puedo entrenar con vos?", next:"train" },
            { label:"Gracias, hasta luego.", next:null },
          ]},
          train:{ text:"Bien, quiero ver tu actitud antes de comprometerme a más.", options:[
            { label:"Acepto el reto.", next:null, action:"train_spar" },
            { label:"Quizá otro día.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"Tu bando no tiene buenos antecedentes aquí. ¿Qué buscás?", options:[
            { label:"Vine en paz.", next:"warn" },
            { label:"¿Qué vas a hacer?", next:"fight" },
          ]},
          warn:{ text:"La paz se gana con acciones. Alejate de los civiles.", options:[
            { label:"De acuerdo.", next:null },
          ]},
          fight:{ text:"¡Defiendo este territorio!", options:[
            { label:"¡RAID!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },

    // ── MALOS / IMPERIALES ────────────────────────────────────────────────────
    {
      id:"tpl_imperial",      name:"Soldado Imperial",   faction:"evil",    npcFaction:"intergalactic_empire",
      emoji:"⚔️",              color:"#ff5252",           src:"Skins/Arcosiano.png",
      stats:{ hp:800, atk:130, def:80 },
      dialogues:{
        ally:{
          start:{ text:"¡Camarada del Imperio! El sector necesita guerreros fuertes. ¿Entrenamos?", options:[
            { label:"¡Vamos, soldado!", next:null, action:"train_spar" },
            { label:"¿Hay órdenes?",   next:"orders" },
            { label:"Sigo mi camino.", next:null },
          ]},
          orders:{ text:"El comandante quiere que aseguremos el sector norte. La resistencia es débil.", options:[
            { label:"Lanzar RAID de invasión", next:null, action:"raid_invade" },
            { label:"Esperaré el momento.",   next:null },
          ]},
        },
        neutral:{
          start:{ text:"No sos del Imperio, pero tampoco parecés una amenaza. ¿Qué querés?", options:[
            { label:"Solo entrenar.",   next:"train" },
            { label:"Solo curiosidad.", next:null },
          ]},
          train:{ text:"Está bien, un combate de práctica. Pero no causes problemas.", options:[
            { label:"Trato.", next:null, action:"train_spar" },
            { label:"Quizá después.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"¡Enemigo detectado! ¡Alejate o usaré la fuerza!", options:[
            { label:"No quiero conflicto.", next:"warn" },
            { label:"¡Inténtalo!",          next:"fight" },
          ]},
          warn:{ text:"Última advertencia. El Imperio no muestra piedad dos veces.", options:[
            { label:"Me retiro.", next:null },
            { label:"¡No me asustan!", next:"fight" },
          ]},
          fight:{ text:"¡Error fatal! ¡ATAQUE!", options:[
            { label:"¡Raid defensiva!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },
    {
      id:"tpl_villain",       name:"Villano",             faction:"evil",    npcFaction:"villains",
      emoji:"💀",              color:"#aa00ff",            src:"Skins/Darkenezom.png",
      stats:{ hp:1500, atk:250, def:120 },
      dialogues:{
        ally:{
          start:{ text:"Otro villano. No sos una amenaza para mí, pero sí un entretenimiento.", options:[
            { label:"Entrenar juntos.",   next:null, action:"train_spar" },
            { label:"¿Planeás algo?",     next:"plan" },
            { label:"Solo pasaba.",       next:null },
          ]},
          plan:{ text:"Siempre. El poder es todo. ¿Te unes a la causa?", options:[
            { label:"Lanzar RAID de invasión", next:null, action:"raid_invade" },
            { label:"Lo pienso.",              next:null },
          ]},
        },
        neutral:{
          start:{ text:"Interesante… Sin bando. Eso te hace impredecible. Útil, quizás.", options:[
            { label:"¿Qué propones?", next:"prop" },
            { label:"No me interesa.", next:null },
          ]},
          prop:{ text:"Poder sin compromisos. Si querés demostrarlo, peleá.", options:[
            { label:"¡Acepto!", next:null, action:"train_spar" },
            { label:"Pasaré.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"Un enemigo con valor. Eso es… raro. ¿Viniste a morir?", options:[
            { label:"Retrocedo lentamente…", next:null },
            { label:"¡Peleemos!",             next:"fight" },
          ]},
          fight:{ text:"¡Al fin algo interesante! ¡RAID!", options:[
            { label:"¡RAID defensiva!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },

    // ── NEUTRALES ─────────────────────────────────────────────────────────────
    {
      id:"tpl_neutral_w",     name:"Guerrero Neutral",   faction:"neutral", npcFaction:"neutral",
      emoji:"⚖️",              color:"#b0bec5",           src:"Skins/NamekianIdle.png",
      stats:{ hp:1000, atk:160, def:90 },
      dialogues:{
        ally:{
          start:{ text:"El poder no tiene bando. Pero la actitud sí importa. ¿Qué querés?", options:[
            { label:"Entrenar.",      next:null, action:"train_spar" },
            { label:"Charlar.",       next:"chat" },
            { label:"Nada, me voy.", next:null },
          ]},
          chat:{ text:"Pocas personas valen una conversación. Vos parecés ser una.", options:[
            { label:"¿RAID juntos?", next:null, action:"raid_defend" },
            { label:"Gracias.", next:null },
          ]},
        },
        neutral:{
          start:{ text:"…¿Qué querés? No tengo tiempo para charlas sin propósito.", options:[
            { label:"Entrenar.",        next:"train" },
            { label:"Nada, me voy.",    next:null },
          ]},
          train:{ text:"Bien. Si sos serio con el entrenamiento, no me niego.", options:[
            { label:"¡Vamos!", next:null, action:"train_spar" },
            { label:"Después.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"Sabés que no puedo dejarte hacer lo que querés, ¿verdad?", options:[
            { label:"No vine a pelear.", next:"warn" },
            { label:"¡Peleemos!", next:"fight" },
          ]},
          warn:{ text:"Bien. Pero que sea la última vez.", options:[
            { label:"Entendido.", next:null },
          ]},
          fight:{ text:"…Que así sea.", options:[
            { label:"¡RAID defensiva!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },
    {
      id:"tpl_neutral_m",     name:"Mercenario",          faction:"neutral", npcFaction:"neutral",
      emoji:"🗡️",              color:"#ff6d00",            src:"Skins/RobotNPC.png",
      stats:{ hp:1100, atk:190, def:100 },
      dialogues:{
        ally:{
          start:{ text:"El poder no distingue entre bien y mal. Solo hay fuertes y débiles.", options:[
            { label:"Únete a mi causa.", next:"join" },
            { label:"Hasta luego.",      next:null },
          ]},
          join:{ text:"Bien. Pero si me traicionás, serás el primero en caer.", options:[
            { label:"RAID juntos",  next:null, action:"raid_invade" },
            { label:"Pensándolo.",  next:null },
          ]},
        },
        neutral:{
          start:{ text:"Interesante… sin bando fijo. ¿Buscás pelea o negocio?", options:[
            { label:"Pelea de práctica.", next:"train" },
            { label:"Ni lo uno ni lo otro.", next:null },
          ]},
          train:{ text:"El entrenamiento es buen negocio. Acepto.", options:[
            { label:"¡Vamos!", next:null, action:"train_spar" },
            { label:"Quizá después.", next:null },
          ]},
        },
        enemy:{
          start:{ text:"Así que llegaste hasta acá. ¿Buscás pelea?", options:[
            { label:"No, solo curiosidad.", next:"warn" },
            { label:"Si querés…",           next:"fight" },
          ]},
          warn:{ text:"Entonces alejate. No hay nada para vos aquí.", options:[
            { label:"Me voy.", next:null },
          ]},
          fight:{ text:"Bien. Pero sabrás que no me freno.", options:[
            { label:"¡RAID defensiva!", next:null, action:"raid_defend" },
          ]},
        },
      }
    },
  ];


  // Qué factions de NPC puede invocar cada bando de jugador (por ID real de FACTIONS)
  const FACTION_SUMMON = {
    z_warrior:             ["good","neutral"],
    galactic_patrol:       ["good","neutral"],
    heroes:                ["good","neutral"],
    intergalactic_empire:  ["evil","neutral"],
    villains:              ["evil","neutral"],
    neutral:               ["good","evil","neutral"],
    default:               ["neutral"],
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ESTADO INTERNO
  // ─────────────────────────────────────────────────────────────────────────
  let _initialized   = false;
  let _npcs          = {};     // { id: NpcInstance } activos en mapa actual
  let _imgs          = {};
  let _dialogueState = null;   // { npcId, nodeId, relation, tree }
  let _raidState     = null;
  let _dbListeners   = {};
  let _activeNpcListenKey = null;
  let _activeRaidListenKey = null;
  let _uiOpen        = false;
  let _raidPanelOpen = false;
  let _archivedNpcs  = {};
  let _pendingCustom = null;
  let _customPlaceXY = null;
  let _npcAnimators  = {};     // { npcId: SpriteAnimator }
  let _npcAiState    = {};     // { npcId: { timer, walkDir, state } }
  let _partyNpcs     = {};     // { npcId: true } NPCs que siguen al jugador (party)

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────
  const _getDb       = () => typeof db       !== "undefined" ? db       : null;
  const _getMap      = () => typeof currentMap !== "undefined" ? currentMap : "lobby";
  const _getPid      = () => typeof myPlayerId !== "undefined" ? myPlayerId : "local";
  const _getPlayer   = () => typeof player   !== "undefined" ? player   : null;
  const _getCam      = () => typeof cam      !== "undefined" ? cam      : {x:0,y:0};
  const _toast       = (msg,type) => typeof showHudToast === "function" && showHudToast(msg,type||"info");
  const _getFaction  = () => {
    const p = _getPlayer();
    return p?.faction || p?.factionId || "default";
  };
  const NPC_BEHAVIOR_LABELS = {
    neutral: "RP / diálogo",
    training: "Entrenamiento",
    defender: "Aliado defensor",
    hostile: "Hostil",
  };

  function _loadImg(src) {
    if (_imgs[src]) return _imgs[src];
    const img = new Image(); img.src = src; _imgs[src] = img; return img;
  }

  function _archiveKey() { return "dragonWorldZ_rpNpcArchive_" + _getPid(); }

  function _loadNpcArchive() {
    try {
      const raw = localStorage.getItem(_archiveKey());
      _archivedNpcs = raw ? (JSON.parse(raw) || {}) : {};
    } catch(e) { _archivedNpcs = {}; }
  }

  function _saveNpcArchive() {
    try { localStorage.setItem(_archiveKey(), JSON.stringify(_archivedNpcs)); } catch(e) {}
  }

  function _archiveNpc(npc, reason) {
    if (!npc) return;
    const archived = {
      ...npc,
      archived: true,
      archivedReason: reason || "stored",
      archivedAt: Date.now(),
      hp: npc.maxHp || npc.hp || 1,
      _dead: false,
    };
    _archivedNpcs[npc.id] = archived;
    _saveNpcArchive();
    _npcListHtmlCache = "";
    _scheduleNpcPanelRefresh();
  }

  function _genId() {
    return "npc_" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }

  function _allowedFactions() {
    const f = _getFaction();
    return FACTION_SUMMON[f] || FACTION_SUMMON.default;
  }

  function _detachDbListener(key) {
    const entry = _dbListeners[key];
    if (!entry) return;
    try {
      if (entry.ref && entry.cb) entry.ref.off(entry.event || "value", entry.cb);
      else if (entry.ref && entry.ref.off) entry.ref.off();
    } catch(e) {}
    delete _dbListeners[key];
  }

  function _clearNpcRuntimeCache(npcId) {
    delete _npcAnimators[npcId];
    delete _npcAiState[npcId];
    delete _appCache[npcId];
    delete _npcOC[npcId];
    delete _npcOCCtx[npcId];
    delete _npcOCFrame[npcId];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIREBASE — NPCs en mapa
  // ─────────────────────────────────────────────────────────────────────────
  function _listenNpcs(mapKey) {
    const database = _getDb();
    if (!database) return;
    const key = "npc_" + mapKey;
    if (_activeNpcListenKey === key && _dbListeners[key]) return;
    if (_activeNpcListenKey && _activeNpcListenKey !== key) _detachDbListener(_activeNpcListenKey);
    const ref = database.ref("mapNpcs/" + mapKey);
    const cb = snap => {
      if (_getMap() !== mapKey) return;
      const data = snap.val() || {};
      // clear current map npcs
      Object.keys(_npcs).forEach(id => {
        if (_npcs[id].map === mapKey && !data[id]) {
          delete _npcs[id];
          _clearNpcRuntimeCache(id);
        }
      });
      Object.entries(data).forEach(([id, n]) => {
        // FIX: si el NPC llega de Firebase sin ownerId, recuperarlo del archivo local
        const recoveredOwner = n.ownerId || (_archivedNpcs[id] && _archivedNpcs[id].ownerId) || null;
        _npcs[id] = { ...n, id, map: n.map || mapKey, ...(recoveredOwner ? { ownerId: recoveredOwner } : {}) };
      });
      _npcListDirty = true;
      _npcListHtmlCache = "";
      _scheduleNpcPanelRefresh();
    };
    _dbListeners[key] = { ref, event:"value", cb };
    _activeNpcListenKey = key;
    ref.on("value", cb);
  }

  function _summonNpc(catalogId, worldX, worldY) {
    const cfg = _getCatalog(catalogId);
    if (!cfg) return;
    const allowed = _allowedFactions();
    if (!allowed.includes(cfg.faction)) {
      _toast("Tu bando no puede invocar este tipo de NPC", "dmg");
      return;
    }
    // Guardamos posición y abrimos modal de personalización
    _pendingCustom = catalogId;
    _customPlaceXY = { x: Math.round(worldX), y: Math.round(worldY) };
    _openCustomizeModal(cfg);
    _placing = null;
    _updatePlacingCursor();
  }

  /** Confirma la creación del NPC con los datos del modal */
  function _confirmCustomNpc(customName, skinSrc, customHp, customAtk, customDef, npcFactionOverride, appearanceData, behavior) {
    const cfg = _getCatalog(_pendingCustom);
    if (!cfg || !_customPlaceXY) return;
    const pos = _customPlaceXY;
    _pendingCustom = null;
    _customPlaceXY = null;

    const finalName       = (customName || cfg.name).trim().slice(0, 28) || cfg.name;
    const finalSrc        = skinSrc   || cfg.src;
    const finalHp         = Math.max(1, Math.min(99999, parseInt(customHp)  || cfg.stats.hp));
    const finalAtk        = Math.max(1, Math.min(9999,  parseInt(customAtk) || cfg.stats.atk));
    const finalDef        = Math.max(0, Math.min(9999,  parseInt(customDef) || cfg.stats.def));
    const finalFaction    = npcFactionOverride || cfg.npcFaction;
    const finalAppearance = appearanceData || null;
    const finalBehavior   = behavior || "neutral";

    const npc = {
      id:         _genId(),
      catalogId:  cfg.id,
      name:       finalName,
      faction:    cfg.faction,
      npcFaction: finalFaction,
      skinSrc:    finalSrc,
      appearance: finalAppearance,
      direction:  1,
      x:          pos.x,
      y:          pos.y,
      map:        _getMap(),
      ownerId:    _getPid(),
      hp:         finalHp,
      maxHp:      finalHp,
      atk:        finalAtk,
      def:        finalDef,
      behavior:   finalBehavior,
      combatMode: finalBehavior === "training" || finalBehavior === "hostile" || finalBehavior === "defender",
      combatSide: finalBehavior === "hostile" ? "enemy" : finalBehavior === "defender" ? "ally" : "neutral",
      t:          Date.now(),
    };
    const database = _getDb();
    if (database) {
      database.ref("mapNpcs/" + npc.map + "/" + npc.id).set(npc);
    } else {
      _npcs[npc.id] = npc;
    }
    _toast("✓ " + finalName + " invocado", "xp");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MODAL DE PERSONALIZACIÓN DE NPC
  // ─────────────────────────────────────────────────────────────────────────
  function _openCustomizeModal(cfg) {
    // Quitar modal previo si existe
    const old = document.getElementById("npcCustomModal");
    if (old) old.remove();

    // Obtener slots de personaje del juego
    const charSlots = _getCharSlots();

    // Bandos de NPC disponibles para elegir
    const factionOpts = [
      { id:"z_warrior",            label:"Guerrero Z",            color:"#f5c400" },
      { id:"galactic_patrol",      label:"Patrulla Intergal.",     color:"#00e5ff" },
      { id:"heroes",               label:"Héroes",                color:"#00e676" },
      { id:"intergalactic_empire", label:"Imperio Intergal.",      color:"#ff5252" },
      { id:"villains",             label:"Villanos",               color:"#aa00ff" },
      { id:"neutral",              label:"Neutral",               color:"#b0bec5" },
    ];

    // CSS del modal (inyectar una vez)
    if (!document.getElementById("npcCustomModalStyle")) {
      const st = document.createElement("style");
      st.id = "npcCustomModalStyle";
      st.textContent = `
        #npcCustomModal {
          position:fixed; inset:0; z-index:400;
          background:rgba(0,0,0,.72); display:flex;
          align-items:center; justify-content:center;
          pointer-events:auto; 
        }
        #npcCustomBox {
          width:min(420px,94vw); max-height:86vh;
          background:rgba(8,9,15,.98); border:1px solid #2a3560;
          border-radius:12px; display:flex; flex-direction:column;
          overflow:hidden; font-family:Rajdhani,sans-serif;
          box-shadow:0 20px 60px rgba(0,0,0,.6);
        }
        #npcCustomHeader {
          display:flex; align-items:center; gap:10px; padding:12px 14px;
          border-bottom:1px solid #2a3560; flex-shrink:0;
          background:rgba(170,0,255,.06);
        }
        #npcCustomHeader .ch-icon { font-size:22px; }
        #npcCustomHeader .ch-title {
          font-family:"Orbitron",monospace; font-size:10px;
          letter-spacing:2px; color:#aa00ff; flex:1;
        }
        #npcCustomHeader .ch-close {
          background:none; border:none; color:#8892b0;
          font-size:18px; cursor:pointer; padding:4px 8px;
          touch-action:manipulation;
        }
        #npcCustomBody {
          flex:1; overflow-y:auto; padding:14px; display:flex;
          flex-direction:column; gap:14px;
          scrollbar-width:thin; scrollbar-color:rgba(170,0,255,.35) transparent;
        }
        .ncm-section-label {
          font-family:"Orbitron",monospace; font-size:8px;
          letter-spacing:1.5px; color:#3d4a6b; text-transform:uppercase;
          margin-bottom:4px;
        }
        #npcCustomName {
          width:100%; background:#12172e; border:1px solid #2a3560;
          border-radius:6px; padding:9px 10px; color:#e8eaf6;
          font-family:Rajdhani,sans-serif; font-size:15px; outline:none;
          box-sizing:border-box;
        }
        #npcCustomName:focus { border-color:rgba(170,0,255,.5); }
        .ncm-skin-tabs {
          display:flex; gap:4px; margin-bottom:8px; flex-shrink:0;
        }
        .ncm-skin-tab {
          flex:1; padding:6px; font-family:"Orbitron",monospace; font-size:7px;
          letter-spacing:.5px; background:rgba(255,255,255,.04);
          border:1px solid #2a3560; border-radius:5px; color:#4a5880;
          cursor:pointer; touch-action:manipulation; transition:all .12s;
        }
        .ncm-skin-tab.active { border-color:#aa00ff; color:#aa00ff; background:rgba(170,0,255,.08); }
        .ncm-skin-grid {
          display:grid; grid-template-columns:repeat(auto-fill,minmax(68px,1fr)); gap:7px;
          max-height:200px; overflow-y:auto;
          scrollbar-width:thin; scrollbar-color:rgba(170,0,255,.35) transparent;
        }
        .ncm-skin-option {
          display:flex; flex-direction:column; align-items:center; gap:4px;
          padding:6px 4px; background:rgba(255,255,255,.03); border:1px solid #2a3560;
          border-radius:7px; cursor:pointer; touch-action:manipulation;
          transition:all .12s; -webkit-tap-highlight-color:transparent;
        }
        .ncm-skin-option:hover,.ncm-skin-option.selected {
          border-color:#aa00ff; background:rgba(170,0,255,.1);
        }
        .ncm-skin-option img {
          width:40px; height:52px; object-fit:cover; image-rendering:pixelated;
          border-radius:3px; background:#12172e;
        }
        .ncm-skin-option canvas {
          width:40px; height:52px; image-rendering:pixelated; border-radius:3px;
        }
        .ncm-skin-label {
          font-family:"Orbitron",monospace; font-size:6px; color:#8892b0;
          text-align:center; line-height:1.2; word-break:break-all; max-width:64px;
        }
        .ncm-stats-row {
          display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;
        }
        .ncm-stat-field { display:flex; flex-direction:column; gap:4px; }
        .ncm-stat-label {
          font-family:"Orbitron",monospace; font-size:7px; letter-spacing:1px; color:#4a5880;
        }
        .ncm-stat-input {
          background:#12172e; border:1px solid #2a3560; border-radius:5px;
          padding:7px 8px; color:#e8eaf6; font-family:"Orbitron",monospace;
          font-size:11px; outline:none; width:100%; box-sizing:border-box; text-align:center;
        }
        .ncm-stat-input:focus { border-color:rgba(170,0,255,.5); }
        .ncm-faction-grid {
          display:grid; grid-template-columns:1fr 1fr; gap:6px;
        }
        .ncm-faction-btn {
          padding:7px 8px; border-radius:6px; border:1px solid #2a3560;
          background:rgba(255,255,255,.03); font-family:"Orbitron",monospace;
          font-size:7px; letter-spacing:.5px; cursor:pointer;
          touch-action:manipulation; transition:all .12s; text-align:center;
          color:#8892b0;
        }
        .ncm-faction-btn.selected { background:rgba(170,0,255,.12); }
        #npcCustomFooter {
          display:flex; gap:8px; padding:12px 14px;
          border-top:1px solid #2a3560; flex-shrink:0;
        }
        #npcCustomConfirm {
          flex:1; padding:12px; border-radius:7px;
          background:rgba(170,0,255,.18); border:1px solid rgba(170,0,255,.5);
          color:#cc44ff; font-family:"Orbitron",monospace; font-size:10px;
          letter-spacing:1.5px; cursor:pointer; touch-action:manipulation;
          transition:all .15s;
        }
        #npcCustomConfirm:hover { background:rgba(170,0,255,.32); box-shadow:0 0 14px rgba(170,0,255,.3); }
        #npcCustomCancel {
          padding:12px 16px; border-radius:7px;
          background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.15);
          color:#8892b0; font-family:"Orbitron",monospace; font-size:9px;
          cursor:pointer; touch-action:manipulation;
        }
        .ncm-skin-empty {
          font-family:"Orbitron",monospace; font-size:8px; color:#3d4a6b;
          text-align:center; padding:12px; grid-column:1/-1;
        }
      `;
      document.head.appendChild(st);
    }

    let _selectedSkinSrc = cfg.src;
    let _selectedFaction = cfg.npcFaction;
    let _selectedBehavior = "neutral";
    let _selectedGender = "male";
    let _skinTab = "skins"; // "skins" | "slots"

    const modal = document.createElement("div");
    modal.id = "npcCustomModal";

    function _buildSkinGrid(tab) {
      if (tab === "skins") {
        return SKIN_CATALOG.map(s => `
          <div class="ncm-skin-option${_selectedSkinSrc === s.src ? " selected" : ""}"
               data-src="${s.src}"
               onclick="NpcSystem._modalSelectSkin('${s.src}')">
            <img src="${s.src}" alt="${s.label}" onerror="this.style.opacity='.3'">
            <span class="ncm-skin-label">${s.label}</span>
          </div>`).join("");
      } else {
        // Slots de personaje del jugador
        const slots = _getCharSlots();
        if (!slots.length) return `<div class="ncm-skin-empty">No hay personajes guardados.</div>`;
        return slots.map(s => {
          const preview = s.portrait || "";
          return `
          <div class="ncm-skin-option${_selectedSkinSrc === ("slot:"+s.slot) ? " selected" : ""}"
               data-src="slot:${s.slot}"
               onclick="NpcSystem._modalSelectSkin('slot:${s.slot}')">
            ${preview
              ? `<img src="${preview}" alt="${s.name}">`
              : `<div style="width:40px;height:52px;display:flex;align-items:center;justify-content:center;background:#12172e;border-radius:3px;font-size:14px">👤</div>`}
            <span class="ncm-skin-label">${(s.name||"Slot "+s.slot).slice(0,8)}</span>
          </div>`;
        }).join("");
      }
    }

    function _rebuildModal() {
      const nameInput = document.getElementById("ncmNameInput");
      const curName   = nameInput?.value || "";
      const hpVal     = document.getElementById("ncmHpInput")?.value  || cfg.stats.hp;
      const atkVal    = document.getElementById("ncmAtkInput")?.value || cfg.stats.atk;
      const defVal    = document.getElementById("ncmDefInput")?.value || cfg.stats.def;

      modal.innerHTML = `
        <div id="npcCustomBox">
          <div id="npcCustomHeader">
            <span class="ch-icon">${cfg.emoji}</span>
            <span class="ch-title">CONFIGURAR NPC — ${cfg.name}</span>
            <button class="ch-close" onclick="NpcSystem._modalCancel()">✕</button>
          </div>
          <div id="npcCustomBody">

            <!-- NOMBRE -->
            <div>
              <div class="ncm-section-label">Nombre del NPC</div>
              <input id="ncmNameInput" class="npcCustomName" type="text"
                maxlength="28" placeholder="${cfg.name}"
                value="${curName}"
                style="width:100%;background:#12172e;border:1px solid #2a3560;border-radius:6px;padding:9px 10px;color:#e8eaf6;font-family:Rajdhani,sans-serif;font-size:15px;outline:none;box-sizing:border-box;">
            </div>

            <!-- GÉNERO -->
            <div>
              <div class="ncm-section-label">Género</div>
              <div class="ncm-faction-grid">
                <button class="ncm-faction-btn${_selectedGender==="male"?" selected":""}"
                  style="border-color:${_selectedGender==="male"?"#00e5ff":"#2a3560"};color:${_selectedGender==="male"?"#00e5ff":"#8892b0"}"
                  onclick="NpcSystem._modalSelectGender('male')">♂ Masculino</button>
                <button class="ncm-faction-btn${_selectedGender==="female"?" selected":""}"
                  style="border-color:${_selectedGender==="female"?"#ff80ab":"#2a3560"};color:${_selectedGender==="female"?"#ff80ab":"#8892b0"}"
                  onclick="NpcSystem._modalSelectGender('female')">♀ Femenino</button>
              </div>
            </div>

            <!-- SKIN -->
            <div>
              <div class="ncm-section-label">Skin</div>
              <div class="ncm-skin-tabs">
                <button class="ncm-skin-tab${_skinTab==="skins"?" active":""}"
                  onclick="NpcSystem._modalSkinTab('skins')">🗂 Skins</button>
                <button class="ncm-skin-tab${_skinTab==="slots"?" active":""}"
                  onclick="NpcSystem._modalSkinTab('slots')">👤 Mis Personajes</button>
              </div>
              <div class="ncm-skin-grid" id="ncmSkinGrid">
                ${_buildSkinGrid(_skinTab)}
              </div>
            </div>

            <!-- ESTADÍSTICAS -->
            <div>
              <div class="ncm-section-label">Estadísticas base</div>
              <div class="ncm-stats-row">
                <div class="ncm-stat-field">
                  <span class="ncm-stat-label">❤️ HP</span>
                  <input id="ncmHpInput"  class="ncm-stat-input" type="number" min="1" max="99999" value="${hpVal}">
                </div>
                <div class="ncm-stat-field">
                  <span class="ncm-stat-label">⚔️ ATK</span>
                  <input id="ncmAtkInput" class="ncm-stat-input" type="number" min="1" max="9999"  value="${atkVal}">
                </div>
                <div class="ncm-stat-field">
                  <span class="ncm-stat-label">🛡 DEF</span>
                  <input id="ncmDefInput" class="ncm-stat-input" type="number" min="0" max="9999"  value="${defVal}">
                </div>
              </div>
            </div>

          </div>
          <div id="npcCustomFooter">
            <button id="npcCustomCancel"  onclick="NpcSystem._modalCancel()">Cancelar</button>
            <button id="npcCustomConfirm" onclick="NpcSystem._modalConfirm()">📍 Colocar NPC</button>
          </div>
        </div>`;
    }

    _rebuildModal();
    document.body.appendChild(modal);

    // Guardar referencias para uso externo
    NpcSystem._modalRebuild        = _rebuildModal;
    NpcSystem._modalSkinTabState   = () => _skinTab;
    NpcSystem._modalSetSkinTab     = (t) => { _skinTab = t; };
    NpcSystem._modalGetSkin        = () => _selectedSkinSrc;
    NpcSystem._modalSetSkin        = (s) => { _selectedSkinSrc = s; };
    NpcSystem._modalGetFaction     = () => _selectedFaction;
    NpcSystem._modalSetFaction     = (f) => { _selectedFaction = f; };
    NpcSystem._modalGetBehavior    = () => _selectedBehavior;
    NpcSystem._modalSetBehavior    = (b) => { _selectedBehavior = b; };
    NpcSystem._modalGetGender      = () => _selectedGender;
    NpcSystem._modalSetGender      = (g) => { _selectedGender = g; };
    // Devuelve el appearance construido desde los inputs del modal
    NpcSystem._modalGetAppearance  = () => {
      const CS = (typeof CharacterSystem !== "undefined") ? CharacterSystem : null;
      const gender  = _selectedGender || "male";
      const raceId  = "human";
      const skinC   = "#e8c898";
      const hairC   = "#1a1a1a";
      const auraC   = "#fdd835";
      // Defaults de ropa según raza
      const raceDef = CS?.RACE_CATALOG?.find(r => r.id === raceId);
      const topCat  = CS?.getCatalogFor?.("shirt",  raceId, gender) || [];
      const btmCat  = CS?.getCatalogFor?.("pants",  raceId, gender) || [];
      const topId   = topCat[0]?.id  || "top_gi_tortuga_m";
      const btmId   = btmCat[0]?.id  || "pm1";
      return {
        raceId,
        gender:      raceDef?.genderless ? "male" : gender,
        variantId:   "base",
        faceId:      gender === "female" ? "ff0" : "fm0",
        hairId:      gender === "female" ? "hf1" : "hm1",
        hairColor:   hairC,
        topId,
        bottomId:    btmId,
        shoesId:     gender === "female" ? "shf1" : "shm1",
        glovesId:    gender === "female" ? "gf0"  : "gm0",
        auraId:      "a0",
        auraColor:   auraC,
        skinColor:   skinC,
        eyeColor:    raceDef?.eyeColor || "#3a2a1a",
        accessoryId: "ac_none",
      };
    };
  }

  /** Obtiene los slots de personaje guardados (portrait canvas + nombre) */
  function _getCharSlots() {
    try {
      const slots = [];
      for (let i = 0; i < 5; i++) {
        const raw = localStorage.getItem("dragonWorldZ_slot" + i)
                 || localStorage.getItem("dragonWorldZ_char_" + i)
                 || localStorage.getItem("charSlot_" + i);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (!data) continue;
        slots.push({ slot: i, name: data.name || ("Slot " + i), portrait: data.portrait || "" });
      }
      // Intento alternativo: clave única
      const single = localStorage.getItem("dragonWorldZ_character");
      if (single && !slots.length) {
        const d = JSON.parse(single);
        if (d) slots.push({ slot: 0, name: d.name || "Mi personaje", portrait: d.portrait || "" });
      }
      return slots;
    } catch(e) { return []; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ANIMACIÓN DE NPC — usa CharacterSystem.SpriteAnimator si está disponible
  // ─────────────────────────────────────────────────────────────────────────

  function _getNpcSkinImage(src) {
    if (!src) return null;
    if (_skinImageCache[src]) return _skinImageCache[src];
    const img = new Image();
    img.src = src;
    img.onload = () => { /* cache ready */ };
    img.onerror = () => { _skinImageCache[src] = null; };
    _skinImageCache[src] = img;
    return img;
  }

  /** Obtiene (o crea) el SpriteAnimator para un NPC */
  function _getAnimator(npcOrId) {
    const npcId = typeof npcOrId === "string" ? npcOrId : npcOrId?.id;
    if (!npcId) return null;
    if (_npcAnimators[npcId]) return _npcAnimators[npcId];
    const CS = typeof CharacterSystem !== "undefined" ? CharacterSystem : null;
    const npc = typeof npcOrId === "string" ? _npcs[npcOrId] : npcOrId;
    if (CS && CS.SpriteAnimator) {
      const isCombat = !!npc?.combatMode;
      const anim = new CS.SpriteAnimator(isCombat ? "combat_idle" : "idle", isCombat ? { battleMode: true } : {});
      if (isCombat) anim.play("combat_idle");
      _npcAnimators[npcId] = anim;
      return anim;
    }
    return null;
  }

  /** Construye el objeto appearance para drawPlayer a partir de los datos del NPC.
   *  Intenta leer los datos del slot de personaje si skinSrc empieza con "slot:".
   */
  function _buildAppearance(npc) {
    const key = npc.appearance ? "a" : (npc.skinSrc || "");
    const cached = _appCache[npc.id]; if (cached && cached._k === key) return cached;
    let r;
    if (npc.appearance && npc.appearance.raceId) {
      r = npc.appearance;
    } else if (npc.skinSrc && npc.skinSrc.indexOf("slot:") === 0) {
      try {
        const idx = parseInt(npc.skinSrc.slice(5)) || 0;
        const raw = localStorage.getItem("dragonWorldZ_slot" + idx)
                 || localStorage.getItem("dragonWorldZ_char_" + idx)
                 || localStorage.getItem("charSlot_" + idx);
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.appearance) r = d.appearance;
        }
      } catch (e) {}
    }

    const isCustomSheet = npc.skinSrc && npc.skinSrc.indexOf("slot:") !== 0;
    if (!r) {
      r = {
        raceId:    npc.raceId || "human",
        gender:    npc.gender || "male",
        variantId: "base",
        faceId:    npc.faceId || "fm0",
        faceColor: null,
        hairId:    npc.hairId || "hm1",
        hairColor: npc.hairColor || "#1a1a1a",
        topId:     npc.topId || "top_gi_tortuga_m",
        bottomId:  npc.bottomId || "pm1",
        shoesId:   npc.shoesId || "shm1",
        glovesId:  npc.glovesId || "gm0",
        auraId:    npc.auraId || "a0",
        auraColor: npc.auraColor || "#fdd835",
        skinColor: npc.skinColor || "#e8c898",
        eyeColor:  npc.eyeColor || "#3a2a1a",
        accessoryId: npc.accessoryId || "ac_none",
      };
    }

    if (isCustomSheet) {
      const skinImage = _getNpcSkinImage(npc.skinSrc);
      if (skinImage && skinImage.complete) {
        const variantCustom = { userImage: skinImage, animFrames: 6, rowCount: 37 };
        r.variantCustomizations = { ...(r.variantCustomizations || {}), base: variantCustom };
        // Ensure the sprite uses the imported sheet instead of default catalog layers.
        r.faceId = null; r.hairId = null; r.topId = null; r.bottomId = null;
        r.shoesId = null; r.glovesId = null; r.accessoryId = "ac_none";
      }
    }

    r._k = key;
    return (_appCache[npc.id] = r);
  }

  /** IA de animación: camina libremente o sigue al jugador si está en party */
  function _tickNpcAi(npc, dt) {
    const ai = _npcAiState[npc.id] || (_npcAiState[npc.id] = { timer: 0, walkDir: 1, state: "idle" });
    const anim = _getAnimator(npc);
    const combatNpc = !!npc.combatMode;

    // No mover si está en diálogo
    if (_dialogueState && _dialogueState.npcId === npc.id) {
      if (anim && anim.action !== "idle") anim.play("idle");
      return;
    }

    // Si está en party: seguir al jugador
    if (_partyNpcs[npc.id]) {
      const p = _getPlayer();
      if (p) {
        const dx = p.x - npc.x, dy = p.y - npc.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const FOLLOW_DIST = 90, STOP_DIST = 55;
        if (dist > FOLLOW_DIST) {
          const spd = 85 * dt;
          npc.x += (dx / dist) * spd;
          npc.y += (dy / dist) * spd * 0.5;
          const dir = dx > 0 ? 1 : -1;
          npc._dir = dir;
          if (anim) { anim.direction = dir; if (anim.action !== "run") anim.play("run"); }
        } else if (dist > STOP_DIST) {
          const spd = 45 * dt;
          npc.x += (dx / dist) * spd;
          npc.y += (dy / dist) * spd * 0.5;
          const dir = dx > 0 ? 1 : -1;
          npc._dir = dir;
          if (anim) { anim.direction = dir; if (anim.action !== "walk") anim.play("walk"); }
        } else {
          if (anim && anim.action !== "idle") anim.play("idle");
        }
      }
      return;
    }

    // Libre albedrío: caminar aleatoriamente
    ai.timer -= dt;
    if (ai.timer <= 0) {
      const r = Math.random();
      if (ai.state === "idle") {
        ai.state   = r < 0.6 ? "walk" : "idle";
        ai.walkDir = Math.random() < 0.5 ? 1 : -1;
        ai.timer   = ai.state === "walk" ? 1.5 + Math.random() * 2 : 2 + Math.random() * 3;
      } else {
        ai.state = "idle";
        ai.timer = 2 + Math.random() * 3;
      }
    }

    if (ai.state === "walk" && !combatNpc) {
      npc.x += ai.walkDir * 40 * dt;
      if (anim) { anim.direction = ai.walkDir; if (anim.action !== "walk") anim.play("walk"); }
      if (!npc._dir) npc._dir = 1;
      npc._dir = ai.walkDir;
    } else {
      if (anim && anim.action !== (combatNpc ? "combat_idle" : "idle")) {
        anim.play(combatNpc ? "combat_idle" : "idle");
      }
    }
  }

  /** Reproduce una animación de impacto en el NPC (llamar al recibir daño) */
  function _playNpcHit(npcId) {
    const anim = _getAnimator(npcId);
    if (!anim) return;
    anim.play("hit");
    const ai = _npcAiState[npcId] || (_npcAiState[npcId] = { timer:0, state:"idle" });
    ai.state = "idle"; ai.timer = 1.5;
  }

  // Quita del mapa, guarda en archivo (reutilizable)
  function _removeNpc(npcId) {
    const npc = _npcs[npcId];
    if (!npc) return;
    if (npc.ownerId && npc.ownerId !== _getPid()) { _toast("Solo el invocador puede quitarlo", "dmg"); return; }
    delete _partyNpcs[npcId];
    _archiveNpc(npc, "removed");
    _clearNpcRuntimeCache(npcId);
    delete _npcs[npcId]; // FIX: limpiar localmente siempre, no solo cuando no hay db
    _npcListDirty = true; _npcListHtmlCache = "";
    const database = _getDb();
    if (database) database.ref("mapNpcs/" + npc.map + "/" + npcId).remove();
    _scheduleNpcPanelRefresh();
    _toast((npc.name || "NPC") + " quitado del mapa (guardado)", "info");
  }

  // Borra del mapa Y del archivo para siempre
  function _deleteNpc(npcId) {
    // FIX: buscar en _npcs (activo en mapa) O en _archivedNpcs (guardado)
    const npc = _npcs[npcId] || _archivedNpcs[npcId];
    if (!npc) return;
    if (npc.ownerId && npc.ownerId !== _getPid()) { _toast("Solo el invocador puede borrarlo", "dmg"); return; }
    const name = npc.name || "NPC";
    const map  = npc.map  || _getMap();
    delete _partyNpcs[npcId];
    delete _archivedNpcs[npcId];
    _saveNpcArchive();
    _clearNpcRuntimeCache(npcId);
    delete _npcs[npcId]; // FIX: limpiar mapa local siempre
    _npcListDirty = true; _npcListHtmlCache = "";
    const database = _getDb();
    if (database) database.ref("mapNpcs/" + map + "/" + npcId).remove();
    _scheduleNpcPanelRefresh();
    _toast(name + " borrado permanentemente", "dmg");
  }

  function _markNpcDefeated(npcId) {
    const npc = _npcs[npcId];
    if (!npc) return;
    npc.hp = 0;
    npc._dead = true;
    _archiveNpc(npc, "defeated");
    delete _npcs[npcId]; // FIX: limpiar localmente siempre
    const database = _getDb();
    if (database) database.ref("mapNpcs/" + npc.map + "/" + npcId).remove();
    _clearNpcRuntimeCache(npcId);
    _npcListDirty = true;
    _toast((npc.name || "NPC") + " fue derrotado y guardado", "info");
  }

  function _reviveNpc(npcId) {
    const src = _archivedNpcs[npcId];
    if (!src) return;
    const p = _getPlayer();
    const npc = {
      ...src,
      archived: false,
      _dead: false,
      hp: src.maxHp || src.hp || 1,
      x: Math.round(p?.x || src.x || 400),
      y: Math.round(p?.y || src.y || 300),
      map: _getMap(),
      t: Date.now(),
    };
    delete npc.archivedReason;
    delete npc.archivedAt;
    delete _archivedNpcs[npcId];
    _saveNpcArchive();
    const database = _getDb();
    if (database) database.ref("mapNpcs/" + npc.map + "/" + npc.id).set(npc);
    else _npcs[npc.id] = npc;
    _npcListDirty = true;
    _npcListHtmlCache = "";
    _scheduleNpcPanelRefresh();
    _toast((npc.name || "NPC") + " reutilizado", "xp");
  }

  function _toCombatNpc(npc) {
    const cfg = _getCatalog(npc.catalogId);
    if (!npc || !cfg) return null;
    const skinPath = (npc.skinSrc && !npc.skinSrc.startsWith("slot:")) ? npc.skinSrc : null;

    // Si la skin es un slot de personaje, extraer el appearance del localStorage
    let appearance = npc.appearance || null;
    if (!appearance && npc.skinSrc && npc.skinSrc.startsWith("slot:")) {
      try {
        const idx = parseInt(npc.skinSrc.slice(5)) || 0;
        const raw = localStorage.getItem("dragonWorldZ_slot" + idx)
                 || localStorage.getItem("dragonWorldZ_char_" + idx)
                 || localStorage.getItem("charSlot_" + idx);
        if (raw) {
          const d = JSON.parse(raw);
          if (d?.appearance) appearance = d.appearance;
        }
      } catch(e) {}
    }

    return {
      id: "rp_" + npc.id,
      rpNpcId: npc.id,
      name: npc.name || cfg.name,
      color: cfg.color || "#aa00ff",
      x: npc.x,
      y: npc.y,
      facing: npc.direction || 1,
      combatNpc: true,
      rpNpc: true,
      rpBehavior: npc.behavior || "training",
      npcFaction: npc.npcFaction || cfg.npcFaction || "neutral",
      skinPath,
      appearance,
      // Aplanar appearance para que drawNpcs() lo pueda leer directamente
      raceId:    appearance?.raceId    || npc.raceId    || "human",
      gender:    appearance?.gender    || npc.gender    || "male",
      faceId:    appearance?.faceId    || npc.faceId    || null,
      faceColor: appearance?.faceColor || npc.faceColor || null,
      hairId:    appearance?.hairId    || npc.hairId    || null,
      hairColor: appearance?.hairColor || npc.hairColor || "#1a1a1a",
      topId:     appearance?.topId     || npc.topId     || null,
      bottomId:  appearance?.bottomId  || npc.bottomId  || null,
      shoesId:   appearance?.shoesId   || npc.shoesId   || null,
      skinColor: appearance?.skinColor || npc.skinColor  || "#e8c898",
      eyeColor:  appearance?.eyeColor  || npc.eyeColor   || "#3a2a1a",
      auraColor: appearance?.auraColor || npc.auraColor  || "#fdd835",
      npcMaxHp: npc.maxHp || npc.hp || cfg.stats.hp,
      npcHp: npc.hp || npc.maxHp || cfg.stats.hp,
      npcAtk: npc.atk || cfg.stats.atk,
      npcDef: npc.def || cfg.stats.def,
      npcXp: Math.max(10, Math.floor((npc.atk || cfg.stats.atk) + (npc.maxHp || cfg.stats.hp) / 20)),
      _anim: "combat_idle",
      _animLocked: false,
      _attackTimer: Date.now() + 800,
      _specialTimer: Date.now() + 6000,
    };
  }

  function _startNpcCombat(npcId) {
    const npc = _npcs[npcId];
    const combatNpc = _toCombatNpc(npc);
    if (!combatNpc) return;
    if (npc) {


    }
    if (typeof window.startRpNpcCombat === "function") {
      window.startRpNpcCombat(combatNpc);
      _toast("Combate iniciado contra " + combatNpc.name, "warning");
    } else {
      _toast("El motor de combate aun no esta listo", "dmg");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FIREBASE — RAIDS
  // ─────────────────────────────────────────────────────────────────────────
  function _getRaidSignature(raid) {
    if (!raid) return "";
    const participants = raid.participants || {};
    const parts = Object.keys(participants).sort().map(pid => {
      const p = participants[pid] || {};
      return pid + ":" + (p.side || "");
    }).join("|");
    return [raid.id, raid.type, raid.phase, raid.hostId, parts].join(";");
  }

  function _listenRaids(mapKey) {
    const database = _getDb();
    if (!database) return;
    const key = "raid_" + mapKey;
    if (_activeRaidListenKey === key && _dbListeners[key]) return;
    if (_activeRaidListenKey && _activeRaidListenKey !== key) _detachDbListener(_activeRaidListenKey);
    const ref = database.ref("raids/" + mapKey);
    const cb = snap => {
      if (_getMap() !== mapKey) return;
      const data = snap.val() || {};
      const activeRaids = Object.values(data).filter(r => r.phase !== "ended");
      const nextRaid = activeRaids.length > 0 ? activeRaids[0] : null;
      const nextSig = _getRaidSignature(nextRaid);
      if (nextSig === _raidStateSig) return;
      _raidStateSig = nextSig;
      _raidStatusHtmlCache = "";
      _raidState = nextRaid;
      if (_raidState) {
        _renderRaidBanner();
      } else {
        _hideRaidBanner();
      }
      _scheduleNpcPanelRefresh();
    };
    _dbListeners[key] = { ref, event:"value", cb };
    _activeRaidListenKey = key;
    ref.on("value", cb);
  }

  function _launchRaid(type, npcId) {
    // type: "defend" | "invade"
    const database = _getDb();
    const map = _getMap();
    const pid = _getPid();
    const raidId = "raid_" + Date.now().toString(36);
    const raid = {
      id:          raidId,
      map,
      hostId:      pid,
      type,        // "defend" = defensa del mapa | "invade" = ataque a otro mapa
      npcId:       npcId || null,
      phase:       "open",      // open → active → ended
      participants: { [pid]: { side:"hero", pid, t:Date.now() } },
      startedAt:   Date.now(),
    };
    if (database) {
      database.ref("raids/" + map + "/" + raidId).set(raid);
      _toast("⚔️ ¡RAID lanzada! Otros jugadores pueden unirse", "warning");
    } else {
      _raidState = raid;
      _raidStateSig = _getRaidSignature(raid);
      _raidStatusHtmlCache = "";
      _renderRaidBanner();
      _scheduleNpcPanelRefresh();
    }
  }

  function _joinRaid(raidId, side) {
    // side: "hero" | "villain"
    const database = _getDb();
    if (!database) return;
    const map = _getMap();
    const pid = _getPid();
    database.ref("raids/" + map + "/" + raidId + "/participants/" + pid).set({ side, pid, t: Date.now() });
    _toast("Te uniste a la RAID como " + (side === "hero" ? "🛡️ Defensor" : "💀 Atacante"), "info");
  }

  function _endRaid(raidId) {
    const database = _getDb();
    if (!database) return;
    const map = _getMap();
    database.ref("raids/" + map + "/" + raidId + "/phase").set("ended");
    _toast("RAID finalizada", "xp");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DIÁLOGO
  // ─────────────────────────────────────────────────────────────────────────
  let _placing = null;
  let _placingTarget = { x: null, y: null };

  /** Calcula la relación entre el jugador y el NPC según FACTION_RELATIONS del juego.
   *  Retorna: "ally" | "neutral" | "enemy"
   */
  // ── PERFORMANCE CACHE (declarado una sola vez, dentro del IIFE) ──────────
  const _catalogMap    = new Map(NPC_CATALOG.map(n => [n.id, n]));
  const _relCache      = {};
  const _appCache      = {};
  const _skinImageCache = {};
  const _npcOC         = {};
  const _npcOCCtx      = {};
  const _npcOCFrame    = {};
  const REL_COLOR      = { ally:"#00e676", neutral:"#f5c400", enemy:"#ff1744" };
  const REL_LABEL    = { ally:"ALIADO",  neutral:"NEUTRAL",  enemy:"ENEMIGO" };
  const _STATIC_REL  = {
    z_warrior:            { galactic_patrol:"ally",  heroes:"neutral",  villains:"enemy",   intergalactic_empire:"enemy",   neutral:"neutral" },
    galactic_patrol:      { z_warrior:"ally",        heroes:"neutral",  villains:"enemy",   intergalactic_empire:"enemy",   neutral:"neutral" },
    heroes:               { z_warrior:"ally",   galactic_patrol:"ally", villains:"enemy",   intergalactic_empire:"enemy",   neutral:"neutral" },
    intergalactic_empire: { villains:"neutral",      heroes:"neutral",  galactic_patrol:"enemy", z_warrior:"enemy",         neutral:"neutral" },
    villains:             { z_warrior:"enemy",  galactic_patrol:"enemy",heroes:"enemy",     intergalactic_empire:"enemy",   neutral:"neutral" },
    neutral:              { z_warrior:"neutral",galactic_patrol:"neutral",heroes:"neutral",intergalactic_empire:"neutral",villains:"neutral",neutral:"neutral" },
  };
  const _pLike       = { direction:1, appearance:null, _animator:null };
  let _relCacheFac   = null;
  let _npcList       = [];
  let _npcListMap    = null;
  let _npcListDirty  = false;
  let _CS            = null;
  let _lastDrawMs    = 0;
  let _aiAccumMs     = 0;
  let _aiLastMs      = 0;
  const _AI_MS       = 1000 / 12;
  let _activeNpcTab  = "summon";
  let _catalogRendered = false;
  let _catalogFactionKey = "";
  let _npcListHtmlCache = "";
  let _raidStatusHtmlCache = "";
  let _raidBannerHtmlCache = "";
  let _raidStateSig = "";
  let _npcPanelRaf = 0;

  let _npcPanelEl = null;
  let _npcTabNodes = null;
  let _npcPageNodes = null;
  let _npcTabSummonEl = null;
  let _npcTabActiveEl = null;
  let _npcTabRaidsEl = null;
  let _raidStatusInfoEl = null;
  let _npcRaidBannerEl = null;

  function _getCatalog(id) { return _catalogMap.get(id) || NPC_CATALOG.find(n=>n.id===id); }
  function _getCS()  { if (!_CS && typeof CharacterSystem!=="undefined") _CS=CharacterSystem; return _CS; }
  function _isNpcPanelVisible(tab) { return _uiOpen && (!tab || _activeNpcTab === tab); }
  function _scheduleNpcPanelRefresh() {
    if (!_uiOpen || _npcPanelRaf) return;
    _npcPanelRaf = requestAnimationFrame(() => {
      _npcPanelRaf = 0;
      if (_activeNpcTab === "active") _renderNpcList();
      else if (_activeNpcTab === "raids") _updateRaidStatus();
    });
  }
  function _getNpcList() {
    const map = _getMap();
    if (_npcListMap !== map || _npcListDirty) {
      _npcList = [];
      for (const id in _npcs) { if (_npcs[id].map===map) _npcList.push(_npcs[id]); }
      _npcListMap = map; _npcListDirty = false;
    }
    return _npcList;
  }

  function _getNpcRelation(npcOrFaction) {
    const pf = _getFaction();
    if (pf !== _relCacheFac) { _relCacheFac = pf; for (const k in _relCache) delete _relCache[k]; }
    let npc = null;
    let faction = typeof npcOrFaction === "string" ? npcOrFaction : null;
    if (typeof npcOrFaction !== "string") {
      npc = npcOrFaction;
      faction = npc?.npcFaction || npc?.faction || "neutral";
      if (npc?.behavior === "training" || npc?.behavior === "hostile") return "enemy";
      if (npc?.behavior === "defender") return "ally";
      if (npc?.combatMode && npc?.combatSide) return npc.combatSide === "ally" ? "ally" : "enemy";
    }
    if (_relCache[faction] !== undefined) return _relCache[faction];
    let rel;
    if (typeof window.relationBetweenFactions === "function") {
      const r = window.relationBetweenFactions(pf, faction || "neutral");
      rel = (r === "ally" || r === "enemy") ? r : "neutral";
    } else {
      rel = (_STATIC_REL[pf] || {})[faction] || "neutral";
    }
    return (_relCache[faction] = rel);
  }

  function _openDialogue(npcInstance) {
    const cfg = _getCatalog(npcInstance.catalogId);
    if (!cfg) return;

    // Usar el bando real guardado en la instancia (puede haber sido customizado)
    const relation = _getNpcRelation(npcInstance);

    const dialogueTree = (cfg.dialogues && (cfg.dialogues[relation] || cfg.dialogues.neutral))
                       || cfg.dialogue || null;

    if (!dialogueTree) { _toast("Este NPC no tiene diálogo configurado.", "info"); return; }

    const relLabels = { ally:"🤝 ALIADO", neutral:"⚖️ NEUTRAL", enemy:"⚔️ ENEMIGO" };
    const relColors = { ally:"#00e676",    neutral:"#f5c400",     enemy:"#ff1744" };

    _dialogueState = {
      npcId:        npcInstance.id,
      nodeId:       "start",
      relation,
      tree:         dialogueTree,
      instanceName: npcInstance.name || cfg.name,
      instanceSkin: (npcInstance.skinSrc && !npcInstance.skinSrc.startsWith("slot:"))
                    ? npcInstance.skinSrc : cfg.src,
    };
    _renderDialogue(cfg, "start", dialogueTree, relLabels[relation], relColors[relation]);
    const panel = document.getElementById("npcDialoguePanel");
    if (panel) { panel.style.display = "flex"; panel.classList.add("open"); }
  }

  function _renderDialogue(cfg, nodeId, tree, relLabel, relColor) {
    const useTree = tree || (cfg.dialogues && cfg.dialogues[_dialogueState?.relation || "neutral"]) || cfg.dialogue;
    const node = useTree ? useTree[nodeId] : null;
    if (!node) { _closeDialogue(); return; }

    const nameEl     = document.getElementById("npcDlgName");
    const textEl     = document.getElementById("npcDlgText");
    const optsEl     = document.getElementById("npcDlgOpts");
    const portraitEl = document.getElementById("npcDlgPortrait");
    const relBadge   = document.getElementById("npcDlgRelBadge");
    if (!nameEl) return;

    // Usar nombre e imagen de la instancia guardada (no del catálogo)
    nameEl.textContent = _dialogueState?.instanceName || cfg.name;
    nameEl.style.color = cfg.color;
    textEl.textContent = node.text;

    if (portraitEl) {
      portraitEl.src = _dialogueState?.instanceSkin || cfg.src;
      portraitEl.style.display = "block";
    }

    if (relBadge && relLabel) {
      relBadge.textContent       = relLabel;
      relBadge.style.color       = relColor || "#f5c400";
      relBadge.style.borderColor = relColor || "#f5c400";
      relBadge.style.display     = "inline-block";
    }

    optsEl.innerHTML = "";
    const dialogueNpc = _dialogueState?.npcId ? _npcs[_dialogueState.npcId] : null;
    const disableRaidActions = dialogueNpc && (dialogueNpc.behavior === "training" || dialogueNpc.behavior === "hostile" || dialogueNpc.behavior === "defender");
    const npcId = _dialogueState?.npcId;
    const inParty = npcId && !!_partyNpcs[npcId];

    (node.options || []).forEach(opt => {
      if (disableRaidActions && (opt.action === "raid_defend" || opt.action === "raid_invade")) {
        return;
      }
      const btn = document.createElement("button");
      btn.className = "npc-dlg-opt";
      btn.textContent = opt.label;
      btn.onclick = () => {
        if (opt.action === "raid_defend") { _closeDialogue(); _launchRaid("defend", _dialogueState?.npcId); return; }
        if (opt.action === "raid_invade") { _closeDialogue(); _launchRaid("invade", _dialogueState?.npcId); return; }
        if (opt.action === "train_spar")  {
          _closeDialogue();
          _toast("⚔️ ¡Combate de entrenamiento iniciado!", "xp");
          if (typeof window.spawnWave === "function") window.spawnWave(0);
          return;
        }
        if (!opt.next) { _closeDialogue(); return; }
        _dialogueState.nodeId = opt.next;
        _renderDialogue(cfg, opt.next, useTree, relLabel, relColor);
      };
      optsEl.appendChild(btn);
    });

    // ── Acciones siempre disponibles ────────────────────────────────────────
    // Seguir / Dejar de seguir
    const followBtn = document.createElement("button");
    followBtn.className = "npc-dlg-opt";
    followBtn.style.cssText = inParty
      ? "background:rgba(255,107,0,.1);border-color:rgba(255,107,0,.4);color:#ff6b00"
      : "background:rgba(0,230,118,.08);border-color:rgba(0,230,118,.4);color:#00e676";
    followBtn.textContent = inParty ? "🚶 Dejar de seguirme" : "🤝 Seguirme (unirse a party)";
    followBtn.onclick = () => {
      if (!npcId) return;
      if (inParty) {
        delete _partyNpcs[npcId];
        _toast((dialogueNpc?.name || "NPC") + " dejó tu party", "info");
      } else {
        _partyNpcs[npcId] = true;
        _toast((dialogueNpc?.name || "NPC") + " se unió a tu party", "xp");
      }
      _closeDialogue();
    };
    optsEl.appendChild(followBtn);

    // Pelear
    const fightBtn = document.createElement("button");
    fightBtn.className = "npc-dlg-opt";
    fightBtn.style.cssText = "background:rgba(255,23,68,.08);border-color:rgba(255,23,68,.4);color:#ff5252";
    fightBtn.textContent = "⚔️ ¡Pelear!";
    fightBtn.onclick = () => {
      _closeDialogue();
      if (npcId) {
        delete _partyNpcs[npcId]; // sacar de party si estaba
        _startNpcCombat(npcId);
      }
    };
    optsEl.appendChild(fightBtn);
  }

  function _closeDialogue() {
    _dialogueState = null;
    const panel = document.getElementById("npcDialoguePanel");
    if (panel) { panel.classList.remove("open"); setTimeout(() => { panel.style.display = "none"; }, 320); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HIT / INTERACT — clic sobre un NPC en el canvas
  // ─────────────────────────────────────────────────────────────────────────
  function _tryInteract(worldX, worldY) {
    const map = _getMap();
    for (const npc of Object.values(_npcs)) {
      if (npc.map !== map) continue;
      const cfg = _getCatalog(npc.catalogId);
      if (!cfg) continue;
      const nw = 80, nh = 100;
      if (worldX >= npc.x - nw/2 && worldX <= npc.x + nw/2 &&
          worldY >= npc.y - nh   && worldY <= npc.y + 10) {
        _openDialogue(npc);
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DRAW — NPCs en canvas
  // ─────────────────────────────────────────────────────────────────────────
  function draw(ctx, camObj) {
    const map=_getMap(), c=camObj||_getCam(), CS=_getCS(), now=performance.now();
    const dt=Math.min((now-_lastDrawMs)/1000,0.1); _lastDrawMs=now;
    const NW=CS?CS.DISPLAY_W:80, NH=CS?CS.DISPLAY_H:100, bw=NW*0.85, bh=5;
    const imageMap=CS?(CS.SPRITE_IMAGES||{}):null;
    const cw=ctx.canvas?ctx.canvas.width:900, ch=ctx.canvas?ctx.canvas.height:700;
    const list=_getNpcList();
    if (!list.length && !_placing) return;
    _aiAccumMs+=now-(_aiLastMs||now); _aiLastMs=now;
    const runAi=_aiAccumMs>=_AI_MS; if(runAi)_aiAccumMs-=_AI_MS;
    for(let i=0;i<list.length;i++){
      const npc=list[i];
      if (npc._combatRequested) continue;
      const cfg=_getCatalog(npc.catalogId); if(!cfg)continue;
      const sx=npc.x-c.x, sy=npc.y-c.y;
      if(sx<-NW-200||sx>cw+NW+200||sy<-NH-200||sy>ch+200)continue;
      if(runAi)_tickNpcAi(npc,dt);
      const anim=_getAnimator(npc); if(anim) anim.update(now);
      const npcDir=npc._dir||1, curAction=anim?anim.action:"idle", curFrame=anim?anim.frame:0;
      const last=_npcOCFrame[npc.id];
      if(!last||last.a!==curAction||last.f!==curFrame||last.d!==npcDir){
        let oc=_npcOC[npc.id];
        if(!oc){
          oc=(typeof OffscreenCanvas!=="undefined")?new OffscreenCanvas(NW,NH):document.createElement("canvas");
          oc.width=NW;oc.height=NH;_npcOC[npc.id]=oc;_npcOCCtx[npc.id]=oc.getContext("2d");
        }
        const oCtx=_npcOCCtx[npc.id]; oCtx.clearRect(0,0,NW,NH);
        if(CS&&CS.drawPlayer&&anim){
          _pLike.direction=1;_pLike.appearance=_buildAppearance(npc);_pLike._animator=anim;
          CS.drawPlayer(oCtx,NW/2,NH,_pLike,imageMap,anim,null);
        }else{
          const sk=(npc.skinSrc&&npc.skinSrc.indexOf("slot:")!==0)?npc.skinSrc:cfg.src;
          const img=_loadImg(sk);
          if(img.complete&&img.naturalWidth>0){
            oCtx.imageSmoothingEnabled=false;
            if(img.naturalHeight>img.naturalWidth*2){const fw=(img.naturalWidth/6)|0,fh=(img.naturalHeight/37)|0;oCtx.drawImage(img,(curFrame%2)*fw,fh,fw,fh,0,0,NW,NH);}
            else oCtx.drawImage(img,0,0,NW,NH);
          }
        }
        _npcOCFrame[npc.id]={a:curAction,f:curFrame,d:npcDir};
      }
      const oc2=_npcOC[npc.id];
      if(oc2){ctx.save();if(npcDir===-1){ctx.translate(sx*2,0);ctx.scale(-1,1);}ctx.imageSmoothingEnabled=false;ctx.drawImage(oc2,sx-NW/2,sy-NH);ctx.restore();}
      const hpPct=Math.min(1,Math.max(0,(npc.hp||0)/(npc.maxHp||1)));
      const bx=sx-bw/2,by=sy-NH-12;
      ctx.fillStyle="#000a";ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle=hpPct>0.5?"#00e676":hpPct>0.25?"#f5c400":"#ff1744";ctx.fillRect(bx,by,bw*hpPct,bh);
      ctx.strokeStyle="rgba(255,255,255,.12)";ctx.lineWidth=1;ctx.strokeRect(bx,by,bw,bh);
      const rel=_getNpcRelation(npc.npcFaction||cfg.npcFaction||"neutral");
      ctx.textAlign="center";
      ctx.font="bold 8px Orbitron,monospace";ctx.fillStyle=cfg.color;ctx.fillText(npc.name||cfg.name,sx,by-10);
      ctx.font="bold 7px Orbitron,monospace";ctx.fillStyle=REL_COLOR[rel];ctx.fillText(REL_LABEL[rel],sx,by-1);
    }
    if(_placing){const cfgP=_getCatalog(_placing);if(cfgP){
      const tx=_placingTarget.x??(_getPlayer()?.x??400),ty=_placingTarget.y??(_getPlayer()?.y??300);
      const sx2=tx-c.x,sy2=ty-c.y,img2=_loadImg(cfgP.src);
      ctx.save();ctx.globalAlpha=0.45;
      if(img2.complete&&img2.naturalWidth>0){ctx.imageSmoothingEnabled=false;
        if(img2.naturalHeight>img2.naturalWidth*2){const fw=(img2.naturalWidth/6)|0,fh=(img2.naturalHeight/37)|0;ctx.drawImage(img2,0,fh,fw,fh,sx2-NW/2,sy2-NH,NW,NH);}
        else ctx.drawImage(img2,sx2-NW/2,sy2-NH,NW,NH);
      }else{ctx.font="36px serif";ctx.textAlign="center";ctx.fillStyle="#fff";ctx.fillText(cfgP.emoji,sx2,sy2-NH*0.5);}
      ctx.globalAlpha=1;ctx.strokeStyle="#f5c400";ctx.lineWidth=2;ctx.setLineDash([6,3]);
      ctx.strokeRect(sx2-NW/2-1,sy2-NH-1,NW+2,NH+2);ctx.setLineDash([]);ctx.restore();
    }}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE PLACING CURSOR
  // ─────────────────────────────────────────────────────────────────────────
  function _updatePlacingCursor() {
    const canvas = document.getElementById("gameCanvas");
    if (canvas) canvas.style.cursor = _placing ? "crosshair" : "";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANVAS EVENTS
  // ─────────────────────────────────────────────────────────────────────────
  function _onMouseMove(e) {
    if (!_placing) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const c = _getCam();
    _placingTarget.x = (e.clientX - rect.left) + c.x;
    _placingTarget.y = (e.clientY - rect.top)  + c.y;
  }

  function _onCanvasClick(e) {
    if (e.button !== 0) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas || e.target !== canvas) return;
    const rect = canvas.getBoundingClientRect();
    const c = _getCam();
    const wx = (e.clientX - rect.left) + c.x;
    const wy = (e.clientY - rect.top)  + c.y;

    if (_placing) {
      e.preventDefault();
      _summonNpc(_placing, wx, wy);
      return;
    }
    _tryInteract(wx, wy);
  }

  function _onTouchEnd(e) {
    if (!_placing) return;
    const canvas = document.getElementById("gameCanvas");
    if (!canvas) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const rect = canvas.getBoundingClientRect();
    const c = _getCam();
    _summonNpc(_placing, (touch.clientX - rect.left) + c.x, (touch.clientY - rect.top) + c.y);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RAID BANNER
  // ─────────────────────────────────────────────────────────────────────────
  function _renderRaidBanner() {
    const banner = _npcRaidBannerEl;
    if (!banner || !_raidState) return;
    const r = _raidState;
    const pid = _getPid();
    const isHost = r.hostId === pid;
    const myPart = r.participants?.[pid];
    const heroCount    = Object.values(r.participants||{}).filter(p=>p.side==="hero").length;
    const villainCount = Object.values(r.participants||{}).filter(p=>p.side==="villain").length;
    const nextHtml = `
      <div class="raid-banner-title">⚔️ RAID ${r.type === "defend" ? "DEFENSIVA" : "DE INVASIÓN"}</div>
      <div class="raid-banner-info">
        🛡️ Defensores: <b>${heroCount}</b> &nbsp; 💀 Atacantes: <b>${villainCount}</b>
      </div>
      ${!myPart ? `
        <div class="raid-banner-btns">
          <button class="raid-join-btn hero"   onclick="NpcSystem.joinRaid('${r.id}','hero')">🛡️ Unirme (Defensor)</button>
          <button class="raid-join-btn villain" onclick="NpcSystem.joinRaid('${r.id}','villain')">💀 Unirme (Atacante)</button>
        </div>` : `<div class="raid-banner-joined">✅ Unido como ${myPart.side === "hero" ? "🛡️ Defensor" : "💀 Atacante"}</div>`
      }
      ${isHost ? `<button class="raid-end-btn" onclick="NpcSystem.endRaid('${r.id}')">🏁 Finalizar RAID</button>` : ""}
    `;
    if (nextHtml !== _raidBannerHtmlCache) {
      banner.innerHTML = nextHtml;
      _raidBannerHtmlCache = nextHtml;
    }
    if (banner.style.display !== "flex") banner.style.display = "flex";
  }

  function _hideRaidBanner() {
    _raidBannerHtmlCache = "";
    if (_npcRaidBannerEl) _npcRaidBannerEl.style.display = "none";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER NPC LIST en panel de invocación
  // ─────────────────────────────────────────────────────────────────────────
  let _npcActiveListEl = null;
  function _getNpcActiveList() { return _npcActiveListEl || (_npcActiveListEl = document.getElementById("npcActiveList")); }

  function _ensureSummonCatalogRendered() {
    const allowed = _allowedFactions();
    const allowedKey = allowed.join("|");
    if (_catalogRendered && _catalogFactionKey === allowedKey) return;
    const tab = document.getElementById("npcTabSummon");
    if (!tab) return;

    const factionLabels = { good:"✨ Buenos", evil:"💀 Malos", neutral:"⚖️ Neutrales" };
    const factionColors = { good:"#00e676", evil:"#ff1744", neutral:"#f5c400" };
    const chunks = [];

    ["good","evil","neutral"].forEach(fac => {
      chunks.push(`<div class="npc-faction-label" style="color:${factionColors[fac]}">${factionLabels[fac]}</div>`);
      chunks.push(`<div class="npc-catalog-grid">`);
      NPC_CATALOG.forEach(n => {
        if (n.faction !== fac) return;
        const isLocked = !allowed.includes(n.faction);
        chunks.push(`
          <div class="npc-card${isLocked ? " locked" : ""}" data-npcid="${n.id}"
               onclick="${isLocked ? "" : `NpcSystem.selectNpc('${n.id}')`}">
            <img src="${n.src}" loading="lazy" decoding="async" style="width:34px;height:44px;object-fit:cover;image-rendering:pixelated;border-radius:3px;background:#12172e" onerror="this.style.display='none'">
            <span class="npc-card-name">${n.name}</span>
            <span class="npc-card-fact" style="color:${n.color};font-size:6px">${n.npcFaction.replace(/_/g," ")}</span>
            ${isLocked ? `<span class="npc-card-lock">🔒</span>` : `<span style="font-size:8px;color:#aa00ff;font-family:'Orbitron',monospace;letter-spacing:.5px">+ Config</span>`}
          </div>`);
      });
      chunks.push(`</div>`);
    });

    chunks.push(`
      <button class="npc-summon-btn" id="npcSummonConfirm" onclick="NpcSystem.startPlace()">
        📍 Colocar NPC seleccionado
      </button>`);
    tab.innerHTML = chunks.join("");
    _catalogFactionKey = allowedKey;
    _catalogRendered = true;
  }

  function _renderNpcList() {
    if (!_isNpcPanelVisible("active")) return;
    const listEl = _getNpcActiveList();
    if (!listEl) return;
    const pid = _getPid();
    const myNpcs = _getNpcList();
    const archived = Object.values(_archivedNpcs).filter(n => n.ownerId === pid);
    let nextHtml = "";

    if (!myNpcs.length && !archived.length) {
      nextHtml = '<div class="npc-empty">No hay NPCs invocados en este mapa</div>';
    }

    if (myNpcs.length) {
      nextHtml += myNpcs.map(npc => {
        const cfg = _getCatalog(npc.catalogId);
        if (!cfg) return "";
        const displayName = npc.name || cfg.name;
        const skinSrc = (npc.skinSrc && !npc.skinSrc.startsWith("slot:")) ? npc.skinSrc : cfg.src;
        const rel = _getNpcRelation(npc);
        const relColor = REL_COLOR[rel] || "#f5c400";
        const inParty = !!_partyNpcs[npc.id];
        const partyBadge = inParty ? '<span style="font-family:\'Orbitron\',monospace;font-size:6px;color:#00e676;border:1px solid #00e676;border-radius:3px;padding:1px 5px;margin-left:4px">PARTY</span>' : "";
        const isOwner = !npc.ownerId || npc.ownerId === pid;
        const fightBtn = isOwner
          ? '<button class="npc-row-rm" style="border-color:rgba(255,23,68,.35);color:#ff5252;background:rgba(255,23,68,.08)" title="Pelear" onclick="NpcSystem.startCombat(\'' + npc.id + '\')">⚔</button>' : '';
        const partyBtn = isOwner
          ? (inParty
            ? '<button class="npc-row-rm" style="border-color:rgba(255,107,0,.35);color:#ff6b00;background:rgba(255,107,0,.08)" title="Expulsar de party" onclick="NpcSystem.removeFromParty(\'' + npc.id + '\')">&#x1F6B6;</button>'
            : '<button class="npc-row-rm" style="border-color:rgba(0,230,118,.35);color:#00e676;background:rgba(0,230,118,.08)" title="Agregar a party" onclick="NpcSystem.addToParty(\'' + npc.id + '\')">&#x1F91D;</button>'
          ) : '';
        const rmBtn = '<button class="npc-row-rm"' + (isOwner
          ? ' style="background:rgba(255,165,0,.1);border-color:rgba(255,165,0,.4);color:#ffa500" title="Quitar del mapa (guardar para recolocar)" onclick="NpcSystem.removeNpc(\'' + npc.id + '\')"'
          : ' disabled title="Solo el invocador puede quitarlo"') + '>📦 Quitar</button>';
        // FIX: escapar el nombre para evitar romper el onclick con apóstrofes o comillas
        const _safeDeleteName = (npc.name || 'NPC').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const deleteBtn = '<button class="npc-row-rm"' + (isOwner
          ? ' style="background:rgba(255,23,68,.1);border-color:rgba(255,23,68,.4);color:#ff5252" title="Borrar NPC permanentemente" onclick="if(confirm(\'¿Borrar ' + _safeDeleteName + ' permanentemente?\'))NpcSystem.deleteNpc(\'' + npc.id + '\')"'
          : ' disabled title="Solo el invocador puede borrar este NPC"') + '>🗑 Borrar NPC</button>';
        return '<div class="npc-active-row">' +
          '<div class="npc-row-top">' +
            '<img src="' + skinSrc + '" loading="lazy" decoding="async" style="width:28px;height:36px;object-fit:cover;image-rendering:pixelated;border-radius:3px;background:#12172e" onerror="this.style.display=\'none\'">' +
            '<div style="flex:1;min-width:0">' +
            '<div class="npc-row-name" style="color:' + cfg.color + '">' + displayName + partyBadge + '</div>' +
            '<div style="font-family:&quot;Orbitron&quot;,monospace;font-size:7px;color:' + relColor + ';letter-spacing:.5px;margin-top:1px">' + rel.toUpperCase() + '</div>' +
            '</div>' +
            '<span class="npc-row-hp">HP ' + (npc.hp || 0) + '/' + (npc.maxHp || 1) + '</span>' +
          '</div>' +
          '<div class="npc-row-btns">' + fightBtn + partyBtn + rmBtn + deleteBtn + '</div>' +
        '</div>';
      }).join("");
    }

    if (archived.length) {
      nextHtml += '<div class="npc-faction-label" style="color:#8892b0;margin-top:8px">Guardados / derrotados</div>';
      nextHtml += archived.map(npc => {
        const cfg = _getCatalog(npc.catalogId);
        if (!cfg) return "";
        const skinSrc = (npc.skinSrc && !npc.skinSrc.startsWith("slot:")) ? npc.skinSrc : cfg.src;
        const state = npc.archivedReason === "defeated" ? "DERROTADO" : "GUARDADO";
        return '<div class="npc-active-row" style="opacity:.78">' +
          '<div class="npc-row-top">' +
            '<img src="' + skinSrc + '" loading="lazy" decoding="async" style="width:28px;height:36px;object-fit:cover;image-rendering:pixelated;border-radius:3px;background:#12172e" onerror="this.style.display=\'none\'">' +
            '<div style="flex:1;min-width:0">' +
              '<div class="npc-row-name" style="color:' + cfg.color + '">' + (npc.name || cfg.name) + '</div>' +
              '<div style="font-family:&quot;Orbitron&quot;,monospace;font-size:7px;color:#8892b0;letter-spacing:.5px;margin-top:1px">' + state + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="npc-row-btns">' +
            '<button class="npc-row-rm" style="border-color:rgba(0,230,118,.35);color:#00e676;background:rgba(0,230,118,.08)" onclick="NpcSystem.reviveNpc(\'' + npc.id + '\')">♻ Reusar</button>' +
            '<button class="npc-row-rm" style="border-color:rgba(255,23,68,.35);color:#ff5252;background:rgba(255,23,68,.08)" onclick="if(confirm(\'¿Borrar permanentemente?\'))NpcSystem.deleteArchivedNpc(\'' + npc.id + '\')">🗑 Borrar</button>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    if (nextHtml !== _npcListHtmlCache) {
      listEl.innerHTML = nextHtml;
      _npcListHtmlCache = nextHtml;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BUILD UI
  // ─────────────────────────────────────────────────────────────────────────
  function _buildUI() {
    // ── CSS ──────────────────────────────────────────────────────────────────
    const style = document.createElement("style");
    style.textContent = `
      /* ═══ NPC PANEL ═══ */
      #npcPanel {
        position:relative; top:auto; left:auto; right:auto; bottom:auto;
        width:clamp(260px,32vw,380px);
        height:auto; max-height:52px;
        background:#080a10; border:1px solid #2a3560;
        border-top-right-radius:10px;
        z-index:31; font-family:Rajdhani,sans-serif;
        display:flex; flex-direction:column;
        transition:max-height .28s cubic-bezier(.4,0,.2,1);
        pointer-events:auto;
        overflow:hidden;
      }
      #npcPanel.open { max-height:clamp(300px,50vh,520px); }
      @media (min-width:1200px){ #npcPanel{width:380px;} #npcPanel.open{max-height:520px;} }
      @media (max-width:400px) { #npcPanel{width:100vw;border-radius:0;} #npcPanel.open{max-height:clamp(280px,60vh,440px);} }

      #npcPanelToggle {
        display:flex; align-items:center; gap:8px; padding:7px 12px;
        cursor:pointer; touch-action:manipulation; min-height:52px; flex-shrink:0;
        border-bottom:1px solid transparent; transition:border-color .2s;
        -webkit-tap-highlight-color:transparent;
      }
      #npcPanel.open #npcPanelToggle { border-color:#2a3560; }
      #npcPanelToggle .npc-toggle-icon { font-size:18px; }
      #npcPanelToggle .npc-toggle-label { font-family:"Orbitron",monospace; font-size:8px; letter-spacing:2px; color:#aa00ff; flex:1; }
      #npcPanelToggle .npc-toggle-arrow { font-size:13px; color:#8892b0; transition:transform .3s; }
      #npcPanel.open .npc-toggle-arrow  { transform:rotate(180deg); }

      #npcPanelBody {
        display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden;
      }

      /* Tabs */
      #npcTabs {
        display:flex; gap:0; border-bottom:1px solid #2a3560; flex-shrink:0;
      }
      .npc-tab {
        flex:1; padding:7px 4px; font-family:"Orbitron",monospace; font-size:7px;
        letter-spacing:.5px; color:#4a5880; background:none; border:none;
        cursor:pointer; transition:all .15s; touch-action:manipulation;
        border-bottom:2px solid transparent; -webkit-tap-highlight-color:transparent;
      }
      .npc-tab.active { color:#aa00ff; border-bottom-color:#aa00ff; }
      .npc-tab:active { background:rgba(170,0,255,.08); }

      /* Tab pages */
      .npc-tab-page { display:none; flex:1; min-height:0; overflow-y:auto; padding:8px 10px; flex-direction:column; gap:6px; }
      .npc-tab-page.active { display:flex; content-visibility:auto; contain-intrinsic-size:360px; }
      .npc-tab-page::-webkit-scrollbar { width:4px; }
      .npc-tab-page::-webkit-scrollbar-thumb { background:rgba(170,0,255,.4); border-radius:4px; }

      /* Catálogo de invocación */
      .npc-faction-label {
        font-family:"Orbitron",monospace; font-size:7px; letter-spacing:1.5px;
        text-transform:uppercase; padding:4px 0 2px; margin-top:4px; flex-shrink:0;
      }
      .npc-catalog-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
      @media(min-width:900px){ .npc-catalog-grid{ grid-template-columns:1fr 1fr 1fr; } }
      .npc-card {
        display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 6px;
        background:rgba(255,255,255,.03); border:1px solid #2a3560; border-radius:7px;
        cursor:pointer; touch-action:manipulation; transition:all .12s;
        -webkit-tap-highlight-color:transparent; position:relative;
      }
      .npc-card:hover,.npc-card.selected { border-color:#aa00ff; background:rgba(170,0,255,.07); }
      .npc-card:active { background:rgba(170,0,255,.14); }
      .npc-card.locked { opacity:.38; cursor:not-allowed; }
      .npc-card-em    { font-size:22px; line-height:1; }
      .npc-card-name  { font-family:"Orbitron",monospace; font-size:7px; color:#c8cfe8; text-align:center; letter-spacing:.5px; }
      .npc-card-fact  { font-size:7px; letter-spacing:.5px; font-family:"Orbitron",monospace; }
      .npc-card-lock  { position:absolute; top:4px; right:5px; font-size:9px; color:#3d4a6b; }
      .npc-summon-btn {
        width:100%; padding:11px; margin-top:6px; border-radius:6px;
        background:rgba(170,0,255,.15); border:1px solid rgba(170,0,255,.45);
        color:#cc44ff; font-family:"Orbitron",monospace; font-size:9px; letter-spacing:1px;
        cursor:pointer; touch-action:manipulation; transition:all .15s; flex-shrink:0;
      }
      .npc-summon-btn:active { background:rgba(170,0,255,.3); }

      /* Activos */
      .npc-active-row {
        display:flex; flex-direction:column; gap:5px; padding:8px 10px;
        background:rgba(255,255,255,.03); border:1px solid #2a3560; border-radius:6px;
        flex-shrink:0;
      }
      .npc-row-top  { display:flex; align-items:center; gap:8px; }
      .npc-row-em   { font-size:18px; }
      .npc-row-name { font-family:"Orbitron",monospace; font-size:8px; flex:1; letter-spacing:.5px; }
      .npc-row-hp   { font-size:10px; color:#8892b0; white-space:nowrap; }
      .npc-row-btns { display:flex; gap:5px; flex-wrap:wrap; }
      .npc-row-rm   { border-radius:4px; font-size:10px; padding:4px 8px; cursor:pointer; touch-action:manipulation; flex-shrink:0;
                      background:rgba(255,23,68,.1); border:1px solid rgba(255,23,68,.3); color:#ff5252; }
      .npc-row-rm:disabled { opacity:.45; cursor:not-allowed; }
      .npc-empty    { font-family:"Orbitron",monospace; font-size:8px; color:#3d4a6b; text-align:center; padding:16px; }

      /* RAIDS tab */
      .raid-launch-section { display:flex; flex-direction:column; gap:6px; flex-shrink:0; }
      .raid-launch-title { font-family:"Orbitron",monospace; font-size:8px; letter-spacing:2px; color:#f5c400; padding:2px 0; }
      .raid-type-btn {
        display:flex; align-items:center; gap:10px; padding:12px 10px;
        border-radius:7px; cursor:pointer; transition:all .15s; touch-action:manipulation;
        -webkit-tap-highlight-color:transparent; border:1px solid;
      }
      .raid-type-btn.defend { background:rgba(0,230,118,.08); border-color:rgba(0,230,118,.4); color:#00e676; }
      .raid-type-btn.invade { background:rgba(255,23,68,.08); border-color:rgba(255,23,68,.4); color:#ff5252; }
      .raid-type-btn:active { filter:brightness(1.3); }
      .raid-type-icon { font-size:22px; }
      .raid-type-info { flex:1; }
      .raid-type-name { font-family:"Orbitron",monospace; font-size:9px; letter-spacing:1px; }
      .raid-type-desc { font-size:11px; color:#8892b0; margin-top:2px; line-height:1.3; }
      .raid-status-box {
        background:rgba(245,196,0,.06); border:1px solid rgba(245,196,0,.3); border-radius:7px;
        padding:12px; flex-shrink:0;
      }
      .raid-status-title { font-family:"Orbitron",monospace; font-size:8px; color:#f5c400; margin-bottom:6px; letter-spacing:1.5px; }
      .raid-status-info  { font-size:12px; color:#c8cfe8; line-height:1.5; }

      /* RAID BANNER — barra superior flotante */
      #npcRaidBanner {
        position:fixed; top:0; left:50%; transform:translateX(-50%);
        width:clamp(300px,70vw,640px);
        background:rgba(8,9,15,.97); border:1px solid rgba(245,196,0,.45);
        border-top:none; border-radius:0 0 10px 10px;
        display:none; flex-direction:column; align-items:center; gap:6px;
        padding:8px 14px 10px; z-index:200; 
        pointer-events:auto;
      }
      .raid-banner-title { font-family:"Orbitron",monospace; font-size:10px; letter-spacing:2px; color:#f5c400; }
      .raid-banner-info  { font-size:12px; color:#c8cfe8; }
      .raid-banner-btns  { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
      .raid-join-btn {
        padding:8px 14px; border-radius:6px; font-family:"Orbitron",monospace; font-size:8px;
        letter-spacing:1px; cursor:pointer; touch-action:manipulation; border:1px solid;
      }
      .raid-join-btn.hero    { background:rgba(0,230,118,.15); border-color:#00e676; color:#00e676; }
      .raid-join-btn.villain { background:rgba(255,23,68,.15); border-color:#ff5252; color:#ff5252; }
      .raid-join-btn:active  { filter:brightness(1.3); }
      .raid-banner-joined { font-family:"Orbitron",monospace; font-size:9px; color:#00e5ff; letter-spacing:1px; }
      .raid-end-btn {
        padding:6px 12px; border-radius:5px; font-family:"Orbitron",monospace; font-size:8px;
        background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.2); color:#8892b0;
        cursor:pointer; touch-action:manipulation;
      }

      /* NPC DIALOGUE PANEL */
      #npcDialoguePanel {
        position:fixed; bottom:0; left:50%; transform:translateX(-50%);
        width:clamp(280px,60vw,560px);
        background:rgba(8,9,15,.97); border:1px solid #2a3560;
        border-bottom:none; border-radius:12px 12px 0 0;
        display:none; flex-direction:column; gap:0;
        z-index:190; pointer-events:auto; 
        overflow:hidden;
        animation:dlgSlideUp .3s cubic-bezier(.4,0,.2,1);
      }
      @keyframes dlgSlideUp { from{transform:translateX(-50%) translateY(100%)} to{transform:translateX(-50%) translateY(0)} }
      #npcDialoguePanel.open { display:flex; }
      #npcDlgHeader {
        display:flex; align-items:center; gap:10px; padding:10px 14px;
        border-bottom:1px solid #2a3560; background:rgba(255,255,255,.03);
      }
      #npcDlgPortrait {
        width:48px; height:60px; object-fit:cover; image-rendering:pixelated;
        border:1px solid #2a3560; border-radius:4px; background:#12172e; flex-shrink:0;
      }
      #npcDlgName {
        font-family:"Orbitron",monospace; font-size:11px; letter-spacing:2px; flex:1;
      }
      #npcDlgCloseBtn {
        background:none; border:none; color:#8892b0; font-size:18px; cursor:pointer;
        padding:4px 8px; touch-action:manipulation;
      }
      #npcDlgText {
        font-size:14px; color:#c8cfe8; line-height:1.55; padding:12px 14px;
        min-height:60px; flex-shrink:0;
      }
      #npcDlgOpts {
        display:flex; flex-direction:column; gap:6px; padding:0 14px 14px; overflow-y:auto;
        max-height:200px;
      }
      .npc-dlg-opt {
        padding:10px 12px; border-radius:6px; text-align:left;
        background:rgba(170,0,255,.08); border:1px solid rgba(170,0,255,.3);
        color:#e8eaf6; font-family:Rajdhani,sans-serif; font-size:13px;
        cursor:pointer; touch-action:manipulation; transition:all .12s;
        min-height:44px; display:flex; align-items:center;
        -webkit-tap-highlight-color:transparent;
      }
      .npc-dlg-opt:hover,.npc-dlg-opt:active { background:rgba(170,0,255,.2); border-color:#aa00ff; }
    `;
    document.head.appendChild(style);

    // ── RAID BANNER ──────────────────────────────────────────────────────────
    const raidBanner = document.createElement("div");
    raidBanner.id = "npcRaidBanner";
    document.body.appendChild(raidBanner);

    // ── DIALOGUE PANEL ───────────────────────────────────────────────────────
    const dlgPanel = document.createElement("div");
    dlgPanel.id = "npcDialoguePanel";
    dlgPanel.innerHTML = `
      <div id="npcDlgHeader">
        <img id="npcDlgPortrait" src="" alt="">
        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0">
          <span id="npcDlgName">NPC</span>
          <span id="npcDlgRelBadge" style="display:none;font-family:'Orbitron',monospace;font-size:8px;letter-spacing:1.5px;border:1px solid #f5c400;border-radius:4px;padding:2px 7px;width:max-content;color:#f5c400"></span>
        </div>
        <button id="npcDlgCloseBtn" onclick="NpcSystem.closeDialogue()">✕</button>
      </div>
      <div id="npcDlgText"></div>
      <div id="npcDlgOpts"></div>
    `;
    document.body.appendChild(dlgPanel);

    // ── NPC PANEL ────────────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.id = "npcPanel";

    panel.innerHTML = `
      <div id="npcPanelToggle" onclick="NpcSystem.togglePanel()">
        <span class="npc-toggle-icon">🧬</span>
        <span class="npc-toggle-label">👥 NPCs &amp; RAIDS</span>
        <span class="npc-toggle-arrow">▲</span>
      </div>
      <div id="npcPanelBody">
        <div id="npcTabs">
          <button class="npc-tab active" onclick="NpcSystem.switchTab('summon',this)">⬆ Invocar</button>
          <button class="npc-tab"        onclick="NpcSystem.switchTab('active',this)">🗺 Activos</button>
          <button class="npc-tab"        onclick="NpcSystem.switchTab('raids',this)">⚔️ Raids</button>
        </div>
        <!-- TAB: Invocar -->
        <div id="npcTabSummon" class="npc-tab-page active">
          <div class="npc-empty">Toca para cargar plantillas</div>
        </div>
        <!-- TAB: Activos -->
        <div id="npcTabActive" class="npc-tab-page">
          <div id="npcActiveList"><div class="npc-empty">Cargando…</div></div>
        </div>
        <!-- TAB: Raids -->
        <div id="npcTabRaids" class="npc-tab-page">
          <div class="raid-launch-section">
            <div class="raid-launch-title">⚔️ LANZAR NUEVA RAID</div>
            <div class="raid-type-btn defend" onclick="NpcSystem.launchRaid('defend')">
              <span class="raid-type-icon">🛡️</span>
              <div class="raid-type-info">
                <div class="raid-type-name">DEFENSA DEL MAPA</div>
                <div class="raid-type-desc">Oleadas de enemigos atacan. Otros jugadores pueden ayudarte o atacarte.</div>
              </div>
            </div>
            <div class="raid-type-btn invade" onclick="NpcSystem.launchRaid('invade')">
              <span class="raid-type-icon">💀</span>
              <div class="raid-type-info">
                <div class="raid-type-name">RAID DE INVASIÓN</div>
                <div class="raid-type-desc">Tu bando invade este territorio. Llama refuerzos y somete a los defensores.</div>
              </div>
            </div>
          </div>
          <div class="raid-status-box" id="raidStatusBox">
            <div class="raid-status-title">📡 ESTADO ACTUAL</div>
            <div class="raid-status-info" id="raidStatusInfo">Sin raid activa en este mapa.</div>
          </div>
        </div>
      </div>
    `;
    const _panelHolder = document.getElementById("leftPanelStack") || document.body;
    _panelHolder.appendChild(panel);
    _npcPanelEl = panel;
    _npcTabSummonEl = panel.querySelector("#npcTabSummon");
    _npcTabActiveEl = panel.querySelector("#npcTabActive");
    _npcTabRaidsEl = panel.querySelector("#npcTabRaids");
    _raidStatusInfoEl = panel.querySelector("#raidStatusInfo");
    _npcRaidBannerEl = document.getElementById("npcRaidBanner");

    // Canvas events
    const canvas = document.getElementById("gameCanvas");
    if (canvas) {
      canvas.addEventListener("mousemove",  _onMouseMove);
      canvas.addEventListener("mousedown",  _onCanvasClick);
      canvas.addEventListener("touchend",   _onTouchEnd, { passive:false });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────────────────
  let _selectedNpcId = null;

  function init() {
    if (_initialized) return;
    _initialized = true;
    _loadNpcArchive();
    _buildUI();

    // Watch map changes
    let _lastMap = null;
    setInterval(() => {
      const map = _getMap();
      if (map !== _lastMap) {
        _lastMap = map;
        _listenNpcs(map);
        _listenRaids(map);
        _updateRaidStatus();
      }
    }, 1200);

    // Init Firebase cuando esté listo
    const tryDb = setInterval(() => {
      if (typeof db !== "undefined") {
        clearInterval(tryDb);
        _listenNpcs(_getMap());
        _listenRaids(_getMap());
      }
    }, 500);
  }

  function _updateRaidStatus() {
    if (!_isNpcPanelVisible("raids")) return;
    const el = _raidStatusInfoEl;
    if (!el) return;
    let nextHtml = "";
    if (!_raidState) {
      nextHtml = "Sin raid activa en este mapa.";
      if (nextHtml !== _raidStatusHtmlCache) {
        el.textContent = nextHtml;
        _raidStatusHtmlCache = nextHtml;
      }
      return;
    }
    const r = _raidState;
    const participants = Object.values(r.participants || {});
    const heroCount    = participants.filter(p => p.side === "hero").length;
    const villainCount = participants.filter(p => p.side === "villain").length;
    nextHtml = `Tipo: <b>${r.type === "defend" ? "Defensa" : "Invasion"}</b><br>
      Defensores: ${heroCount} | Atacantes: ${villainCount}<br>
      Fase: <b>${r.phase}</b>`;
    if (nextHtml !== _raidStatusHtmlCache) {
      el.innerHTML = nextHtml;
      _raidStatusHtmlCache = nextHtml;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API PÚBLICA
  // ─────────────────────────────────────────────────────────────────────────
  return {
    init,
    draw,
    togglePanel() {
      _uiOpen = !_uiOpen;
      const panel = document.getElementById("npcPanel");
      if (panel) panel.classList.toggle("open", _uiOpen);
      if (_uiOpen) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (_activeNpcTab === "summon") _ensureSummonCatalogRendered();
          else if (_activeNpcTab === "active") _renderNpcList();
          else if (_activeNpcTab === "raids") _updateRaidStatus();
        }));
      }
    },
    switchTab(tab, btnEl) {
      _activeNpcTab = tab;
      if (!this._tabNodes)  this._tabNodes  = document.querySelectorAll(".npc-tab");
      if (!this._pageNodes) this._pageNodes = document.querySelectorAll(".npc-tab-page");
      this._tabNodes.forEach(b  => b.classList.remove("active"));
      this._pageNodes.forEach(p => p.classList.remove("active"));
      if (btnEl) btnEl.classList.add("active");
      const page = document.getElementById("npcTab" + tab.charAt(0).toUpperCase() + tab.slice(1));
      if (page) page.classList.add("active");
      if (tab === "summon") requestAnimationFrame(_ensureSummonCatalogRendered);
      if (tab === "active") requestAnimationFrame(_renderNpcList);
      if (tab === "raids")  requestAnimationFrame(_updateRaidStatus);
    },
    selectNpc(npcId) {
      _selectedNpcId = npcId;
      const prev = document.querySelector(".npc-card.selected");
      if (prev) prev.classList.remove("selected");
      const card = document.querySelector(`.npc-card[data-npcid="${npcId}"]`);
      if (card) card.classList.add("selected");
      const cfg = _getCatalog(npcId);
      if (cfg) _toast("Plantilla: " + cfg.name + " — presioná 'Colocar' para configurarlo", "info");
    },
    startPlace() {
      if (!_selectedNpcId) { _toast("Seleccioná un tipo de NPC primero", "dmg"); return; }
      _placing = _selectedNpcId;
      _updatePlacingCursor();
      _toast("Hacé clic en el mapa para configurar y colocar el NPC", "info");
    },
    startCombat: _startNpcCombat,
    removeNpc: _removeNpc,
    deleteNpc: _deleteNpc,
    deleteArchivedNpc(npcId) {
      // FIX: reusar _deleteNpc que ya maneja _npcs, _archivedNpcs, Firebase y cache correctamente
      if (!_archivedNpcs[npcId]) return;
      _deleteNpc(npcId);
    },
    addToParty(npcId) {
      const npc = _npcs[npcId];
      if (!npc) return;
      _partyNpcs[npcId] = true;
      _npcListDirty = true; _npcListHtmlCache = ""; _scheduleNpcPanelRefresh();
      _toast((npc.name || "NPC") + " se unió a tu party", "xp");
    },
    removeFromParty(npcId) {
      const npc = _npcs[npcId];
      delete _partyNpcs[npcId];
      _npcListDirty = true; _npcListHtmlCache = ""; _scheduleNpcPanelRefresh();
      _toast((npc?.name || "NPC") + " dejó tu party", "info");
    },
    reviveNpc: _reviveNpc,
    launchRaid(type) { _launchRaid(type, null); },
    joinRaid(raidId, side) { _joinRaid(raidId, side); },
    endRaid(raidId) { _endRaid(raidId); },
    closeDialogue: _closeDialogue,
    tryInteract: _tryInteract,
    getActiveNpcs() { return _npcs; },
    CATALOG: NPC_CATALOG,
    SKINS:   SKIN_CATALOG,

    // ── Métodos públicos del modal de personalización ─────────────────────
    _modalSelectSkin(src) {
      if (typeof NpcSystem._modalSetSkin === "function") NpcSystem._modalSetSkin(src);
      // Actualizar selección visual en el grid
      document.querySelectorAll(".ncm-skin-option").forEach(el => {
        el.classList.toggle("selected", el.dataset.src === src);
      });
    },
    _modalSelectGender(gender) {
      if (typeof NpcSystem._modalSetGender === "function") NpcSystem._modalSetGender(gender);
      if (typeof NpcSystem._modalRebuild === "function") NpcSystem._modalRebuild();
    },
    _modalSelectFaction(factionId) {
      if (typeof NpcSystem._modalSetFaction === "function") NpcSystem._modalSetFaction(factionId);
      if (typeof NpcSystem._modalRebuild === "function") NpcSystem._modalRebuild();
    },
    _modalSelectBehavior(behavior) {
      if (typeof NpcSystem._modalSetBehavior === "function") NpcSystem._modalSetBehavior(behavior);
      if (typeof NpcSystem._modalRebuild === "function") NpcSystem._modalRebuild();
    },
    _modalSkinTab(tab) {
      if (typeof NpcSystem._modalSetSkinTab === "function") NpcSystem._modalSetSkinTab(tab);
      if (typeof NpcSystem._modalRebuild   === "function") NpcSystem._modalRebuild();
    },
    _modalConfirm() {
      const name       = document.getElementById("ncmNameInput")?.value?.trim() || "";
      const skin       = (typeof NpcSystem._modalGetSkin       === "function") ? NpcSystem._modalGetSkin()       : "";
      const faction    = (typeof NpcSystem._modalGetFaction    === "function") ? NpcSystem._modalGetFaction()    : "";
      const behavior   = "neutral"; // siempre libre albedrío
      const gender     = (typeof NpcSystem._modalGetGender     === "function") ? NpcSystem._modalGetGender()     : "male";
      const appearance = (typeof NpcSystem._modalGetAppearance === "function") ? NpcSystem._modalGetAppearance() : null;
      const hp  = document.getElementById("ncmHpInput")?.value;
      const atk = document.getElementById("ncmAtkInput")?.value;
      const def = document.getElementById("ncmDefInput")?.value;
      _confirmCustomNpc(name, skin, hp, atk, def, faction, appearance, behavior);
      const modal = document.getElementById("npcCustomModal");
      if (modal) modal.remove();
    },
    _modalCancel() {
      _pendingCustom = null;
      _customPlaceXY = null;
      const modal = document.getElementById("npcCustomModal");
      if (modal) modal.remove();
      _placing = null;
      _updatePlacingCursor();
    },
    playNpcHit: _playNpcHit,
  };
})();


/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-INIT al cargar el DOM
   ═══════════════════════════════════════════════════════════════════════════ */
window.RpgChatSystem      = RpgChatSystem;
window.VehicleOverlay     = VehicleOverlay;
window.WorldObjectsSystem = WorldObjectsSystem;
window.NpcSystem          = NpcSystem;

function _initSystems() {
  RpgChatSystem.init();
  WorldObjectsSystem.init();
  NpcSystem.init();
  VehicleOverlay.preload();
  console.info("[Systems Patch] RpgChat, VehicleOverlay, WorldObjects y NpcSystem inicializados ✓");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initSystems);
} else {
  setTimeout(_initSystems, 100);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PARCHE DE COMBATE RP — now handled directly in game.html startRpNpcCombat.
   This patch only ensures startRpNpcCombat is not blocked if a wave is active.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _patchRpCombat() {
  // game.html ya expone npcCombatActive y maneja el ataque en performCombatAction.
  // Solo necesitamos asegurarnos de que startRpNpcCombat no sea bloqueado por
  // oleadas previas de mapas de combate.
  const MAX_TRIES = 60;
  let tries = 0;
  function _tryPatch() {
    tries++;
    if (!window.startRpNpcCombat) {
      if (tries < MAX_TRIES) setTimeout(_tryPatch, 300);
      return;
    }
    console.info("[Systems Patch] Parche de combate RP verificado ✓ (lógica en game.html)");
  }
  setTimeout(_tryPatch, 800);
})();

/* ═══════════════════════════════════════════════════════════════════════════
   PARCHE DE SKIN — ahora integrado directamente en startRpNpcCombat de game.html.
   Este parche hace un segundo paso para propagar appearance y skinPath al
   combatEntry (ce) por si acaso el NPC del sistema tiene datos extra.
   ═══════════════════════════════════════════════════════════════════════════ */
(function _patchRpNpcSkin() {
  const MAX_TRIES = 80;
  let tries = 0;

  function _tryPatch() {
    tries++;
    if (!window.startRpNpcCombat) {
      if (tries < MAX_TRIES) setTimeout(_tryPatch, 300);
      return;
    }

    const _origStart = window.startRpNpcCombat;
    window.startRpNpcCombat = function(combatNpc) {
      if (!combatNpc || !combatNpc.rpNpcId) return;
      if (window.npcCombatActive) return;

      // Llamar al original (ya posiciona el NPC, inyecta en npcs y marca _combatRequested)
      _origStart(combatNpc);

      try {
        const we = window.waveEnemies;
        if (!we || !we.length) return;
        const ce = we[0]; // combatEntry

        // Propagar skinPath si falta
        if (!ce.skinPath && combatNpc.skinPath) ce.skinPath = combatNpc.skinPath;

        // Propagar appearance → campos planos que drawNpcs() usa
        const app = combatNpc.appearance || ce.appearance;
        if (app) {
          ce.appearance = app;
          if (!ce.raceId)    ce.raceId    = app.raceId    || "human";
          if (!ce.gender)    ce.gender    = app.gender    || "male";
          if (!ce.faceId)    ce.faceId    = app.faceId    || null;
          if (!ce.faceColor) ce.faceColor = app.faceColor || null;
          if (!ce.hairId)    ce.hairId    = app.hairId    || null;
          if (!ce.hairColor) ce.hairColor = app.hairColor || "#1a1a1a";
          if (!ce.topId)     ce.topId     = app.topId     || null;
          if (!ce.bottomId)  ce.bottomId  = app.bottomId  || null;
          if (!ce.shoesId)   ce.shoesId   = app.shoesId   || null;
          if (!ce.skinColor) ce.skinColor = app.skinColor || "#e8c898";
          if (!ce.eyeColor)  ce.eyeColor  = app.eyeColor  || "#3a2a1a";
          if (!ce.auraColor) ce.auraColor = app.auraColor || "#fdd835";
        }

        // Asegurar que window.npcs tenga el entry actualizado (la referencia es la misma)
        if (!window.npcs || !window.npcs.find(n => n.id === ce.id)) {
          const NPC_DEFS = window.NPC_DEFS || {};
          const curMap   = window.currentMap || "lobby";
          const baseNpcs = (NPC_DEFS[curMap] || []).filter(n => !n.combatNpc);
          window.npcs = [...baseNpcs, ce];
        }

        // Limpiar animator para que getNpcAnimator lo recree en battleMode
        if (window.npcAnimators) delete window.npcAnimators[ce.id];

      } catch(e) {
        console.warn("[SkinPatch] Error propagando skin/appearance:", e);
      }
    };

    console.info("[Systems Patch] Parche de skin de combate RP aplicado ✓");
  }

  // Esperar a que los parches anteriores ya reemplazaron startRpNpcCombat
  setTimeout(_tryPatch, 1400);
})();