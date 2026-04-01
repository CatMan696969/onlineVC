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

let waiting = null;

// ---------------- CONNECTION ----------------
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.meta = {};
  socket.partnerId = null;

  // ---------------- FIND MATCH ----------------
  socket.on("find", (meta) => {
    socket.meta = meta || {};

    console.log("find:", socket.id, socket.meta);

    if (!waiting) {
      waiting = socket;
      return;
    }

    if (waiting.id === socket.id) return;

    const partner = waiting;
    waiting = null;

    socket.partnerId = partner.id;
    partner.partnerId = socket.id;

    console.log("MATCH:", socket.id, partner.id);

    // send match info
    socket.emit("matched", {
      offerer: true,
      partnerMeta: partner.meta
    });

    partner.emit("matched", {
      offerer: false,
      partnerMeta: socket.meta
    });
  });

  // ---------------- SIGNALING (WEBRTC) ----------------
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

    console.log("next:", socket.id);

    if (waiting && waiting.id === socket.id) {
      waiting = null;
    }
  });

  // ---------------- DISCONNECT ----------------
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);

    if (waiting && waiting.id === socket.id) {
      waiting = null;
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
