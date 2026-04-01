const socket = io("https://onlinevc-925x.onrender.com");

let pc;
let localStream;

const localVideo = document.getElementById("local");
const remoteVideo = document.getElementById("remote");
const messages = document.getElementById("messages");

const chatBox = document.getElementById("chatBox");
const chatBtn = document.getElementById("chatBtn");

// ---------------- CHAT UI ----------------

chatBtn.onclick = () => {
  chatBox.style.display = chatBox.style.display === "flex" ? "none" : "flex";
};

function toggleChat() {
  chatBox.style.display = "none";
}

function addMsg(sender, text) {
  const div = document.createElement("div");
  div.textContent = sender + ": " + text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function sendMsg() {
  const input = document.getElementById("msg");
  const text = input.value.trim();
  if (!text) return;

  addMsg("You", text);
  socket.emit("chat_message", { text });
  input.value = "";
}

socket.on("chat_message", (data) => {
  addMsg("Stranger", data.text);
});

// ---------------- CAMERA ----------------

async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  localVideo.srcObject = localStream;
}

// ---------------- WEBRTC ----------------

function createPeer() {
  pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },

    // TURN (critical for speed + reliability)
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ]
});;

  // add tracks
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });

  // receive stream
  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  // FAST ICE (trickle ICE FIX)
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", {
        candidate: e.candidate
      });
    }
  };

  return pc;
}

// ---------------- SIGNALING ----------------

socket.on("matched", async () => {
  pc = createPeer();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("signal", {
    description: pc.localDescription
  });
});

socket.on("signal", async (data) => {
  if (!pc) pc = createPeer();

  // SDP handling
  if (data.description) {
    if (data.description.type === "offer") {
      await pc.setRemoteDescription(data.description);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("signal", {
        description: pc.localDescription
      });
    }

    if (data.description.type === "answer") {
      await pc.setRemoteDescription(data.description);
    }
  }

  // ICE handling (IMPORTANT FIX)
  if (data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (e) {
      console.log("ICE error:", e);
    }
  }
});

// ---------------- CLEANUP ----------------

socket.on("partner_left", () => {
  remoteVideo.srcObject = null;

  if (pc) {
    pc.close();
    pc = null;
  }
});

// ---------------- BUTTONS ----------------

async function start() {
  await startCamera();
  socket.emit("find");
}

function next() {
  socket.emit("next");

  if (pc) {
    pc.close();
    pc = null;
  }

  remoteVideo.srcObject = null;

  socket.emit("find");
}
