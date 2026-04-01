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

// ---- STATE ----
let waitingUser = null;
const rooms = new Map(); // socket.id -> partner.id

// ---- HEALTH CHECK (fix Render sleep) ----
app.get("/ping", (req, res) => {
  res.send("ok");
});

// ---- SOCKET LOGIC ----
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // FIND MATCH
  socket.on("find", () => {
    console.log("find:", socket.id);

    if (waitingUser && waitingUser.id !== socket.id) {
      const partner = waitingUser;

      const room = socket.id + "#" + partner.id;

      socket.join(room);
      partner.join(room);

      rooms.set(socket.id, partner.id);
      rooms.set(partner.id, socket.id);

      // decide offerer deterministically
      const offerer = socket.id < partner.id;

      io.to(socket.id).emit("matched", {
        offerer,
        partnerId: partner.id
      });

      io.to(partner.id).emit("matched", {
        offerer: !offerer,
        partnerId: socket.id
      });

      waitingUser = null;

      console.log("Matched:", socket.id, partner.id);
    } else {
      waitingUser = socket;
      console.log("Waiting:", socket.id);
    }
  });

  // SIGNAL RELAY
  socket.on("signal", (data) => {
    const partnerId = rooms.get(socket.id);

    if (!partnerId) return;

    io.to(partnerId).emit("signal", data);
  });

  // NEXT / DISCONNECT LOGIC
  socket.on("next", () => {
    const partnerId = rooms.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("partner_left");
      rooms.delete(partnerId);
    }

    rooms.delete(socket.id);

    socket.leaveAll();
    socket.emit("matched", null);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    const partnerId = rooms.get(socket.id);

    if (partnerId) {
      io.to(partnerId).emit("partner_left");
      rooms.delete(partnerId);
    }

    rooms.delete(socket.id);

    if (waitingUser?.id === socket.id) {
      waitingUser = null;
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});
