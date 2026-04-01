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

// health check (VERY IMPORTANT for Render)
app.get("/ping", (req, res) => {
  res.send("pong");
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // FIND MATCH
  socket.on("find", () => {
    console.log("find request:", socket.id);

    if (waitingUser === null) {
      waitingUser = socket;
      console.log("waiting:", socket.id);
    } else {
      const partner = waitingUser;

      if (partner.id === socket.id) return;

      waitingUser = null;

      // store partner info
      socket.partnerId = partner.id;
      partner.partnerId = socket.id;

      console.log("MATCH:", socket.id, partner.id);

      // 🔥 IMPORTANT: ALWAYS send DATA (never undefined)
      socket.emit("matched", {
        offerer: true,
        partnerId: partner.id
      });

      partner.emit("matched", {
        offerer: false,
        partnerId: socket.id
      });
    }
  });

  // SIGNALING (WebRTC exchange)
  socket.on("signal", (data) => {
    if (!socket.partnerId) return;

    io.to(socket.partnerId).emit("signal", data);
  });

  // NEXT USER
  socket.on("next", () => {
    console.log("next:", socket.id);

    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
    }

    socket.partnerId = null;

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    if (socket.partnerId) {
      io.to(socket.partnerId).emit("partner_left");
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
