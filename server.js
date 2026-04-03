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

// ---------------- DATA ----------------
let waitingQueue = [];
let usersByUsername = {}; // Name -> Socket ID

// ---------------- CONNECTION ----------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.partnerId = null;
  socket.meta = {};

  // ---------------- REGISTRATION ----------------
  socket.on("register_user", (username) => {
    socket.userName = username;
    usersByUsername[username] = socket.id;
    console.log(`Registered: ${username}`);
  });

  // ---------------- FIND MATCH (RANDOM) ----------------
  socket.on("find", (meta) => {
    socket.meta = meta || {};
    socket.meta.app = socket.meta.app || "original"; 

    // Remove from queue if they were already in it to prevent duplicates
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);

    let matchIndex = waitingQueue.findIndex(other => {
      if (other.id === socket.id) return false;
      if (other.meta.app !== socket.meta.app) return false;

      const prefA = socket.meta.preference;
      const prefB = other.meta.preference;
      const genderA = socket.meta.gender;
      const genderB = other.meta.gender;

      const matchA = !prefA || prefA === genderB;
      const matchB = !prefB || prefB === genderA;

      return matchA && matchB;
    });

    if (matchIndex !== -1) {
      const partner = waitingQueue.splice(matchIndex, 1)[0];
      socket.partnerId = partner.id;
      partner.partnerId = socket.id;

      socket.emit("matched", { offerer: true, partner: partner.meta });
      partner.emit("matched", { offerer: false, partner: socket.meta });
    } else {
      waitingQueue.push(socket);
    }
  });

  // ---------------- PRIVATE CALL HANDSHAKE ----------------
  socket.on("private_call_request", (data) => {
    const targetSocketId = usersByUsername[data.targetName];
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("incoming_private_call", {
        senderName: data.senderName,
        callerId: socket.id
      });
    } else {
      socket.emit("private_call_rejected", "User is offline or not found.");
    }
  });

  socket.on("private_call_accepted", (data) => {
    const caller = io.sockets.sockets.get(data.callerId);
    if (caller) {
      // CLEAR OLD CONNECTIONS FOR BOTH
      [socket, caller].forEach(s => {
        if (s.partnerId) {
          io.to(s.partnerId).emit("partner_left");
          const oldPartner = io.sockets.sockets.get(s.partnerId);
          if (oldPartner) oldPartner.partnerId = null;
        }
      });

      socket.partnerId = caller.id;
      caller.partnerId = socket.id;

      socket.emit("matched", { offerer: false, partner: caller.meta || { name: caller.userName } });
      caller.emit("matched", { offerer: true, partner: socket.meta || { name: socket.userName } });
    }
  });

  socket.on("private_call_declined", (data) => {
    io.to(data.callerId).emit("private_call_rejected", "User declined the call.");
  });

  // ---------------- CORE LOGIC ----------------
  socket.on("signal", (data) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("signal", data);
  });

  socket.on("chat", (msg) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("chat", msg);
  });

  socket.on("typing", (isTyping) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("typing", isTyping);
  });

  const leave = () => {
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
      const partner = io.sockets.sockets.get(socket.partnerId);
      if (partner) partner.partnerId = null;
    }
    socket.partnerId = null;
  };

  socket.on("next", leave);
  socket.on("disconnect", () => {
    if (socket.userName) delete usersByUsername[socket.userName];
    leave();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
