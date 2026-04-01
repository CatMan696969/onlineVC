const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// Simple matchmaking queue
let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join matchmaking
  socket.on("find", () => {
    if (waitingUser && waitingUser.id !== socket.id) {
      const room = waitingUser.id + "#" + socket.id;

      socket.join(room);
      waitingUser.join(room);

      socket.room = room;
      waitingUser.room = room;

      io.to(room).emit("matched");

      waitingUser = null;
    } else {
      waitingUser = socket;
    }
  });

  // WebRTC signaling (offer/answer/ICE)
  socket.on("signal", (data) => {
    socket.to(socket.room).emit("signal", data);
  });

  // Next button (disconnect current partner)
  socket.on("next", () => {
    if (socket.room) {
      socket.to(socket.room).emit("partner_left");
      socket.leave(socket.room);
      socket.room = null;
    }

    socket.emit("find"); // auto requeue
  });

  socket.on("disconnect", () => {
    if (waitingUser?.id === socket.id) {
      waitingUser = null;
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
