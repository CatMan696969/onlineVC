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
let usersByUsername = {}; // Name -> Socket ID mapping

// ---------------- CONNECTION ----------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  socket.partnerId = null;

  // ---------------- REGISTRATION ----------------
  // This is called by the Dating Edition to make the user "searchable"
  socket.on("register_user", (username) => {
    socket.userName = username;
    usersByUsername[username] = socket.id;
    console.log(`Registered: ${username} as ${socket.id}`);
  });

  // ---------------- FIND MATCH (RANDOM) ----------------
  socket.on("find", (meta) => {
    socket.meta = meta || {};
    // Default to 'original' if no app type is specified
    socket.meta.app = socket.meta.app || "original"; 

    console.log(`Find request from ${socket.id} for app: ${socket.meta.app}`);

    // Logic: Only match users on the SAME app
    let matchIndex = waitingQueue.findIndex(other => {
      if (other.id === socket.id) return false;
      
      // 1. Must be the same app (Dating vs Original)
      if (other.meta.app !== socket.meta.app) return false;

      // 2. Preference match (Gender logic)
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
      // Avoid double-adding to queue
      if (!waitingQueue.find(s => s.id === socket.id)) {
        waitingQueue.push(socket);
      }
    }
  });

  // ---------------- CALL BY NAME (PRIVATE) ----------------
  socket.on("private_call_request", (data) => {
    const targetSocketId = usersByUsername[data.targetName];
    
    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("incoming_private_call", {
        senderName: data.senderName,
        callerId: socket.id
      });
    } else {
      socket.emit("private_call_rejected", "User is offline or does not exist.");
    }
  });

  socket.on("private_call_accepted", (data) => {
    const caller = io.sockets.sockets.get(data.callerId);
    if (caller) {
      // Disconnect them from any current random matches first
      if (socket.partnerId) io.to(socket.partnerId).emit("partner_left");
      if (caller.partnerId) io.to(caller.partnerId).emit("partner_left");

      socket.partnerId = caller.id;
      caller.partnerId = socket.id;

      // Bridge the WebRTC connection
      socket.emit("matched", { offerer: false, partner: caller.meta || { name: caller.userName } });
      caller.emit("matched", { offerer: true, partner: socket.meta || { name: socket.userName } });
    }
  });

  socket.on("private_call_declined", (data) => {
    io.to(data.callerId).emit("private_call_rejected", "User declined the call.");
  });

  // ---------------- CORE SIGNALING ----------------
  socket.on("signal", (data) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("signal", data);
  });

  socket.on("chat", (msg) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("chat", msg);
  });

  socket.on("typing", (isTyping) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("typing", isTyping);
  });

  // ---------------- CLEANUP ----------------
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
