const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const MAX_PLAYERS = 50;
const players = {};

app.get("/", (req, res) => {
  res.send("Dragon World Z — Servidor Multijugador Online ✅");
});

io.on("connection", (socket) => {
  console.log(`[+] Jugador conectado: ${socket.id}`);

  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit("server_full");
    socket.disconnect();
    return;
  }

  // Enviar estado actual del mundo al nuevo jugador
  socket.emit("world_state", players);

  socket.on("player_join", (data) => {
    players[socket.id] = {
      id: socket.id,
      name: data.name || "Guerrero Z",
      x: data.x || 0,
      y: data.y || 0,
      facing: data.facing || 1,
      animAction: data.animAction || "idle",
      race: data.race || "human",
      auraColor: data.auraColor || "#fdd835",
      charColor: data.charColor || "#f5c400",
      level: data.level || 1,
      hp: data.hp || 100,
      maxHp: data.maxHp || 100,
    };

    // Avisar a todos los demás
    socket.broadcast.emit("player_joined", players[socket.id]);
    console.log(`[JOIN] ${players[socket.id].name} entró al mundo`);
  });

  socket.on("player_update", (data) => {
    if (!players[socket.id]) return;
    players[socket.id].x = data.x;
    players[socket.id].y = data.y;
    players[socket.id].facing = data.facing;
    players[socket.id].animAction = data.animAction;
    players[socket.id].hp = data.hp;

    // Broadcast a todos menos al emisor
    socket.broadcast.emit("world_state", players);
  });

  socket.on("chat_msg", (text) => {
    if (!players[socket.id]) return;
    if (typeof text !== "string" || text.length > 120) return;
    io.emit("chat_msg", {
      id: socket.id,
      name: players[socket.id].name,
      text: text.trim()
    });
  });

  socket.on("disconnect", () => {
    if (players[socket.id]) {
      console.log(`[-] ${players[socket.id].name} salió`);
      io.emit("player_left", socket.id);
      delete players[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐉 Dragon World Z Server corriendo en puerto ${PORT}`);
});
