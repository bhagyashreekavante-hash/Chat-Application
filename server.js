const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static("public"));

const rooms   = { general: [], random: [], tech: [], music: [] };
const users   = {};
const history = {};

Object.keys(rooms).forEach(r => (history[r] = []));

function roomUsers(room) {
  return Object.values(users).filter(u => u.room === room);
}

function pushHistory(room, msg) {
  history[room].push(msg);
  if (history[room].length > 50) history[room].shift();
}

io.on("connection", socket => {
  console.log(`[+] connected  ${socket.id}`);

  socket.on("join", ({ username, avatar, room }) => {
    const prev = users[socket.id];
    if (prev) {
      socket.leave(prev.room);
      io.to(prev.room).emit("user_left", { username: prev.username, users: roomUsers(prev.room) });
    }

    users[socket.id] = { username, avatar, room };
    socket.join(room);
    socket.emit("history", history[room]);

    const joinMsg = {
      id:   Date.now(),
      type: "system",
      text: `${username} joined the room`,
      room,
      ts:   new Date().toISOString()
    };
    pushHistory(room, joinMsg);
    io.to(room).emit("system_msg", joinMsg);
    io.to(room).emit("user_list", roomUsers(room));
    console.log(`  ${username} joined #${room}`);
  });

  socket.on("message", ({ text, replyTo }) => {
    const user = users[socket.id];
    if (!user || !text.trim()) return;

    const msg = {
      id:        `${socket.id}-${Date.now()}`,
      type:      "chat",
      socketId:  socket.id,
      username:  user.username,
      avatar:    user.avatar,
      text:      text.trim(),
      room:      user.room,
      replyTo:   replyTo || null,
      ts:        new Date().toISOString(),
      reactions: {}
    };

    pushHistory(user.room, msg);
    io.to(user.room).emit("message", msg);
  });

  socket.on("typing", ({ isTyping }) => {
    const user = users[socket.id];
    if (!user) return;
    socket.to(user.room).emit("typing", { username: user.username, isTyping });
  });

  socket.on("react", ({ msgId, emoji }) => {
    const user = users[socket.id];
    if (!user) return;
    io.to(user.room).emit("reaction", { msgId, emoji, username: user.username });
  });

  socket.on("switch_room", ({ room }) => {
    const user = users[socket.id];
    if (!user || !history[room]) return;

    socket.leave(user.room);
    io.to(user.room).emit("user_left", { username: user.username, users: roomUsers(user.room) });

    user.room = room;
    socket.join(room);
    socket.emit("history", history[room]);

    const joinMsg = {
      id:   Date.now(),
      type: "system",
      text: `${user.username} joined the room`,
      room,
      ts:   new Date().toISOString()
    };
    pushHistory(room, joinMsg);
    io.to(room).emit("system_msg", joinMsg);
    io.to(room).emit("user_list", roomUsers(room));
  });

  socket.on("disconnect", () => {
    const user = users[socket.id];
    if (user) {
      const leaveMsg = {
        id:   Date.now(),
        type: "system",
        text: `${user.username} left the room`,
        room: user.room,
        ts:   new Date().toISOString()
      };
      pushHistory(user.room, leaveMsg);
      io.to(user.room).emit("system_msg", leaveMsg);
      io.to(user.room).emit("user_list", roomUsers(user.room));
      delete users[socket.id];
    }
    console.log(`[-] disconnected ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});