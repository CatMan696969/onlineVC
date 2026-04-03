const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ---------------- STATE ----------------
let waitingQueue = [];
let usersByUsername = {}; // { "Name": "SocketID" }

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  socket.partnerId = null;
  socket.userName = null;

  // 1. REGISTER (For Direct Calls)
  socket.on("register_user", (name) => {
    if (!name) return;
    socket.userName = name;
    usersByUsername[name] = socket.id;
    console.log(`User ${name} registered.`);
  });

  // 2. RANDOM MATCHING
  socket.on("find", (meta) => {
    socket.meta = meta || {};
    socket.meta.app = socket.meta.app || "original";
    
    // Clean up existing states
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    
    let matchIndex = waitingQueue.findIndex(other => {
      if (other.id === socket.id) return false;
      if (other.meta.app !== socket.meta.app) return false;
      
      // Gender Preference Logic
      const prefA = socket.meta.preference;
      const prefB = other.meta.preference;
      const genA = socket.meta.gender;
      const genB = other.meta.gender;

      return (!prefA || prefA === genB) && (!prefB || prefB === genA);
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

  // 3. PRIVATE CALL LOGIC (The "Device A/B/C" Fix)
  socket.on("private_call_request", (data) => {
    const targetId = usersByUsername[data.targetName];
    if (targetId && targetId !== socket.id) {
      io.to(targetId).emit("incoming_private_call", {
        senderName: data.senderName,
        callerId: socket.id
      });
    } else {
      socket.emit("private_call_rejected", "User is offline or busy.");
    }
  });

  socket.on("private_call_accepted", (data) => {
    const caller = io.sockets.sockets.get(data.callerId);
    if (!caller) return;

    // --- SIGNALING ISOLATION ---
    // Force disconnect anyone they are currently talking to
    [socket, caller].forEach(s => {
      if (s.partnerId) {
        io.to(s.partnerId).emit("partner_left");
        const oldPartner = io.sockets.sockets.get(s.partnerId);
        if (oldPartner) oldPartner.partnerId = null;
        s.partnerId = null; 
      }
    });

    // Bridge the new pair
    socket.partnerId = caller.id;
    caller.partnerId = socket.id;

    socket.emit("matched", { offerer: false, partner: caller.meta || { name: caller.userName } });
    caller.emit("matched", { offerer: true, partner: socket.meta || { name: socket.userName } });
  });

  socket.on("private_call_declined", (data) => {
    io.to(data.callerId).emit("private_call_rejected", "Call declined.");
  });

  // 4. WEBRTC SIGNALING & CHAT
  socket.on("signal", (data) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("signal", data);
  });

  socket.on("chat", (msg) => {
    if (socket.partnerId) io.to(socket.partnerId).emit("chat", msg);
  });

  // 5. CLEANUP
  const disconnectPair = () => {
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
      const p = io.sockets.sockets.get(socket.partnerId);
      if (p) p.partnerId = null;
    }
    socket.partnerId = null;
  };

  socket.on("next", disconnectPair);
  socket.on("disconnect", () => {
    if (socket.userName) delete usersByUsername[socket.userName];
    disconnectPair();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
