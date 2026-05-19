"use strict";

(function () {
  const LS_INV_KEY = "dragonWorldZ_inventory";

  const ITEM_DEFS = {
    senzu: {
      id: "senzu", name: "Semilla del ermitaño", icon: "senzu",
      actions: ["eat", "destroy"], healHp: 1.0, healKi: 0.15,
      desc: "Recupera toda la vida y un poco de ki.",
    },
    ramen: {
      id: "ramen", name: "Sopa ramen", icon: "ramen",
      actions: ["eat", "destroy"], healHp: 0.35,
      desc: "Recupera 35% de vida.",
    },
    soda: {
      id: "soda", name: "Soda", icon: "soda",
      actions: ["drink", "destroy"], healKi: 0.4,
      desc: "Recupera 40% de ki.",
    },
    radar: {
      id: "radar", name: "Radar del dragón", icon: "radar",
      actions: ["use_radar", "destroy"],
      desc: "Marca energías en el minimapa por un tiempo.",
    },
    scouter: {
      id: "scouter", name: "Scouter", icon: "scouter",
      actions: ["equip", "destroy"], equipAccessoryId: "ac_scouter",
      desc: "Equípalo como accesorio (visor de poder).",
    },
    ball_1: { id: "ball_1", name: "Esfera 1★", icon: "ball", star: 1, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_2: { id: "ball_2", name: "Esfera 2★", icon: "ball", star: 2, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_3: { id: "ball_3", name: "Esfera 3★", icon: "ball", star: 3, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_4: { id: "ball_4", name: "Esfera 4★", icon: "ball", star: 4, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_5: { id: "ball_5", name: "Esfera 5★", icon: "ball", star: 5, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_6: { id: "ball_6", name: "Esfera 6★", icon: "ball", star: 6, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
    ball_7: { id: "ball_7", name: "Esfera 7★", icon: "ball", star: 7, actions: ["destroy"], isDragonBall: true, desc: "Reúne las 7 para invocar a Shenron." },
  };

  const DRAGON_BALL_IDS = ["ball_1", "ball_2", "ball_3", "ball_4", "ball_5", "ball_6", "ball_7"];

  const ACTION_LABELS = {
    eat: "🍽️ COMER",
    drink: "🥤 BEBER",
    equip: "🔭 EQUIPAR SCOUTER",
    use_radar: "📡 USAR RADAR",
    summon: "🐉 INVOCAR SHENRON",
    destroy: "🗑️ TIRAR",
  };

  const STARTER_INVENTORY = [
    { id: "senzu", qty: 2 },
    { id: "ramen", qty: 1 },
    { id: "soda", qty: 1 },
    { id: "radar", qty: 1 },
    { id: "scouter", qty: 1 },
    { id: "ball_1", qty: 1 },
    { id: "ball_3", qty: 1 },
    { id: "ball_5", qty: 1 },
  ];

  let inventory = [];
  let radarActiveUntil = 0;

  function loadInventory() {
    try {
      const raw = localStorage.getItem(LS_INV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) {
          inventory = parsed.filter((e) => e && ITEM_DEFS[e.id] && e.qty > 0);
          return;
        }
      }
    } catch (e) {}
    inventory = STARTER_INVENTORY.map((e) => ({ ...e }));
    saveInventory();
  }

  function saveInventory() {
    try {
      localStorage.setItem(LS_INV_KEY, JSON.stringify(inventory));
    } catch (e) {}
  }

  function getInventory() {
    return inventory;
  }

  function addItem(itemId, qty = 1) {
    if (!ITEM_DEFS[itemId]) return false;
    const ex = inventory.find((e) => e.id === itemId);
    if (ex) ex.qty += qty;
    else inventory.push({ id: itemId, qty });
    saveInventory();
    return true;
  }

  function removeItem(itemId, qty = 1) {
    const ex = inventory.find((e) => e.id === itemId);
    if (!ex || ex.qty < qty) return false;
    ex.qty -= qty;
    if (ex.qty <= 0) inventory = inventory.filter((e) => e.id !== itemId);
    saveInventory();
    return true;
  }

  function countDragonBalls() {
    return DRAGON_BALL_IDS.reduce((n, id) => {
      const e = inventory.find((x) => x.id === id);
      return n + (e?.qty > 0 ? 1 : 0);
    }, 0);
  }

  function hasAllDragonBalls() {
    return DRAGON_BALL_IDS.every((id) => {
      const e = inventory.find((x) => x.id === id);
      return e && e.qty > 0;
    });
  }

  function isRadarActive() {
    return Date.now() < radarActiveUntil;
  }

  function drawItemSprite(ctx, itemId, cx, cy, size) {
    const def = ITEM_DEFS[itemId];
    if (!def) return;
    const s = size;
    const icon = def.icon;
    ctx.save();
    ctx.translate(cx, cy);

    if (icon === "senzu") {
      ctx.fillStyle = "#7cb342";
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.22, s * 0.32, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#558b2f";
      ctx.beginPath();
      ctx.ellipse(-s * 0.08, s * 0.05, s * 0.1, s * 0.14, -0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === "ramen") {
      ctx.fillStyle = "#ff7043";
      ctx.beginPath();
      ctx.arc(0, s * 0.08, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe0b2";
      ctx.beginPath();
      ctx.arc(0, s * 0.02, s * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f5c400";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(-s * 0.15 + i * s * 0.07, -s * 0.1);
        ctx.lineTo(-s * 0.1 + i * s * 0.07, s * 0.05);
        ctx.stroke();
      }
    } else if (icon === "soda") {
      ctx.fillStyle = "#e53935";
      ctx.fillRect(-s * 0.12, -s * 0.2, s * 0.24, s * 0.38);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-s * 0.1, -s * 0.05, s * 0.2, s * 0.12);
    } else if (icon === "radar") {
      ctx.fillStyle = "#00e5ff";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a2040";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,229,255,0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.22, -0.8, 0.3);
      ctx.stroke();
    } else if (icon === "scouter") {
      ctx.fillStyle = "#43a047";
      ctx.fillRect(-s * 0.28, -s * 0.12, s * 0.56, s * 0.22);
      ctx.fillStyle = "#e040fb";
      ctx.beginPath();
      ctx.arc(s * 0.15, 0, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-s * 0.22, -s * 0.06, s * 0.2, s * 0.08);
    } else if (icon === "ball") {
      const star = def.star || 1;
      const hues = ["#ff8a65", "#ff7043", "#f4511e", "#e64a19", "#d84315", "#bf360c", "#ffab40"];
      ctx.fillStyle = hues[(star - 1) % hues.length];
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f5c400";
      for (let i = 0; i < star; i++) {
        const a = (i / star) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.12, Math.sin(a) * s * 0.12, s * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  function ensureScouterAccessory(CS) {
    if (!CS) return;
    if (!CS.ACCESSORIES_CATALOG.find((a) => a.id === "ac_scouter")) {
      CS.ACCESSORIES_CATALOG.push({
        id: "ac_scouter",
        name: "Scouter",
        type: "scouter",
        slot: "over_shirt",
        color: "#43a047",
        userImage: null,
        dataURL: null,
        isBuiltin: true,
      });
    }
  }

  function useItem(itemId, ctx, action) {
    const def = ITEM_DEFS[itemId];
    if (!def || !ctx) return { ok: false, msg: "Objeto inválido" };
    const entry = inventory.find((e) => e.id === itemId);
    if (!entry || entry.qty < 1) return { ok: false, msg: "No tenés ese objeto" };

    const player = ctx.player;
    const toast = ctx.showToast || (() => {});
    const CS = ctx.CS;
    const act = action || (def.actions && def.actions[0]);

    if (act === "destroy") {
      removeItem(itemId, 1);
      return { ok: true, msg: def.name + " descartado" };
    }

    if (act === "summon") {
      if (!hasAllDragonBalls()) {
        return { ok: false, msg: `Necesitás las 7 esferas (${countDragonBalls()}/7)` };
      }
      DRAGON_BALL_IDS.forEach((id) => removeItem(id, 1));
      if (player) {
        player.hp = player.maxHp;
        player.ki = player.maxKi;
        if (typeof ctx.updateHud === "function") ctx.updateHud();
      }
      if (typeof ctx.onShenron === "function") ctx.onShenron();
      return { ok: true, msg: "¡SHENRON INVOCADO!" };
    }

    if (act === "eat" && def.healHp && player) {
      const amt = def.healHp >= 1 ? player.maxHp : Math.floor(player.maxHp * def.healHp);
      player.hp = Math.min(player.maxHp, player.hp + amt);
      if (def.healKi && player) {
        const kiAmt = Math.floor(player.maxKi * def.healKi);
        player.ki = Math.min(player.maxKi, player.ki + kiAmt);
      }
      if (typeof ctx.updateHud === "function") ctx.updateHud();
      removeItem(itemId, 1);
      return { ok: true, msg: def.name + " consumido" };
    }

    if (act === "drink" && def.healKi && player) {
      const amt = Math.floor(player.maxKi * def.healKi);
      player.ki = Math.min(player.maxKi, player.ki + amt);
      if (typeof ctx.updateHud === "function") ctx.updateHud();
      removeItem(itemId, 1);
      return { ok: true, msg: def.name + " bebido" };
    }

    if (act === "equip" && def.equipAccessoryId && CS) {
      ensureScouterAccessory(CS);
      if (CS.player?.appearance) CS.player.appearance.accessoryId = def.equipAccessoryId;
      if (ctx.savedChar) ctx.savedChar.accessory = def.equipAccessoryId;
      toast("Scouter equipado", "info");
      if (typeof ctx.publishAppearance === "function") ctx.publishAppearance();
      removeItem(itemId, 1);
      return { ok: true, msg: "Scouter equipado" };
    }

    if (act === "use_radar" && itemId === "radar") {
      radarActiveUntil = Date.now() + 45000;
      toast("Radar activo — minimapa", "info");
      removeItem(itemId, 1);
      return { ok: true, msg: "Radar activado" };
    }

    return { ok: false, msg: "Acción no disponible" };
  }

  function getAvailableActions(itemId) {
    const def = ITEM_DEFS[itemId];
    if (!def) return [];
    const actions = [...(def.actions || [])];
    if (hasAllDragonBalls() && !actions.includes("summon")) {
      actions.unshift("summon");
    }
    return actions;
  }

  window.ItemSystem = {
    ITEM_DEFS,
    DRAGON_BALL_IDS,
    ACTION_LABELS,
    loadInventory,
    saveInventory,
    getInventory,
    addItem,
    removeItem,
    countDragonBalls,
    hasAllDragonBalls,
    isRadarActive,
    drawItemSprite,
    useItem,
    getAvailableActions,
    ensureScouterAccessory,
  };
})();
