const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get("/ping", (req, res) => {
  res.send("ok");
});

// ---------------- DATA ----------------
let waitingQueue = [];
let usersByUsername = {}; // username -> socket

// ---------------- CONNECTION ----------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.meta = {};
  socket.partnerId = null;

  // ---------------- FIND MATCH ----------------
  socket.on("find", (meta) => {
    socket.meta = meta || {};

    const username = socket.meta.username;
    if (username) {
      usersByUsername[username] = socket;
    }

    console.log("find:", socket.id, socket.meta);

    // Try to find match based on preference
    let matchIndex = -1;

    for (let i = 0; i < waitingQueue.length; i++) {
      const other = waitingQueue[i];

      if (!other || other.id === socket.id) continue;

      const prefA = socket.meta.preference;
      const prefB = other.meta.preference;

      const genderA = socket.meta.gender;
      const genderB = other.meta.gender;

      // preference match logic
      const matchA = !prefA || prefA === genderB;
      const matchB = !prefB || prefB === genderA;

      if (matchA && matchB) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex !== -1) {
      const partner = waitingQueue.splice(matchIndex, 1)[0];

      socket.partnerId = partner.id;
      partner.partnerId = socket.id;

      console.log("MATCH:", socket.id, partner.id);

      socket.emit("matched", {
        offerer: true,
        partnerMeta: partner.meta
      });

      partner.emit("matched", {
        offerer: false,
        partnerMeta: socket.meta
      });

      return;
    }

    // No match found → add to queue
    waitingQueue.push(socket);
  });

  // ---------------- DIRECT MESSAGE ----------------
  socket.on("direct_message_request", (targetUsername) => {
    const target = usersByUsername[targetUsername];

    if (!target || target.id === socket.id) {
      socket.emit("chat", "User not found.");
      return;
    }

    // Disconnect both from current partners
    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
    }

    if (target.partnerId) {
      io.to(target.partnerId).emit("partner_left");
    }

    socket.partnerId = target.id;
    target.partnerId = socket.id;

    console.log("DIRECT MATCH:", socket.meta.username, targetUsername);

    socket.emit("matched", {
      offerer: true,
      partnerMeta: target.meta
    });

    target.emit("matched", {
      offerer: false,
      partnerMeta: socket.meta
    });
  });

  // ---------------- SIGNALING ----------------
  socket.on("signal", (data) => {
    if (!socket.partnerId) return;
    io.to(socket.partnerId).emit("signal", data);
  });

  // ---------------- CHAT ----------------
  socket.on("chat", (msg) => {
    if (!socket.partnerId) return;
    io.to(socket.partnerId).emit("chat", msg);
  });

  // ---------------- NEXT ----------------
  socket.on("next", () => {
    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
    }

    socket.partnerId = null;

    // Remove from queue if already in it
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    console.log("next:", socket.id);
  });

  // ---------------- DISCONNECT ----------------
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);

    // remove from queue
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    // remove username mapping
    if (socket.meta.username) {
      delete usersByUsername[socket.meta.username];
    }

    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
