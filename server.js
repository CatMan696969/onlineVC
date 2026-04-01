// 1. CONFIGURATION
const RENDER_URL = "https://onlinevc-925x.onrender.com"; // Change to your Render URL
const iceConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    iceCandidatePoolSize: 10
};

let pc;
let dataChannel;

// 2. THE WAKE-UP CALL (Fixes Render Free Tier 30s delay)
async function wakeUpServer() {
    try {
        await fetch(`${RENDER_URL}/ping`);
        console.log("Render server is awake!");
    } catch (e) {
        console.log("Waking server...");
    }
}
wakeUpServer();

// 3. THE CORE CONNECTION LOGIC
async function startConnection(isInitiator) {
    pc = new RTCPeerConnection(iceConfig);

    // FIX: TRICKLE ICE (Removes the 40-second hang)
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendToSignaling({ type: 'candidate', candidate: event.candidate });
        }
    };

    if (isInitiator) {
        // Device A creates the channel
        dataChannel = pc.createDataChannel("chat");
        setupDataChannelHandlers();
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendToSignaling({ type: 'offer', sdp: offer });
    } else {
        // Device B waits for the channel
        pc.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannelHandlers();
        };
    }
}

// 4. HANDLING INCOMING SIGNALS (From Render/Socket.io)
async function handleIncomingSignal(message) {
    if (message.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendToSignaling({ type: 'answer', sdp: answer });
    } 
    else if (message.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
    } 
    else if (message.type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
}

// 5. STABILITY FIXES (Other Issues)
function setupDataChannelHandlers() {
    dataChannel.onopen = () => console.log("CONNECTED FAST!");
    
    // Heartbeat: Prevents Netlify/Render from killing the connection
    setInterval(() => {
        if (dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'keep-alive' }));
        }
    }, 15000);

    dataChannel.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type !== 'keep-alive') {
            console.log("New Message:", data);
        }
    };
}

// 6. SIGNALING BRIDGE
// Replace this function with your actual Socket.io emit logic
function sendToSignaling(data) {
    // Example: socket.emit('message', data);
    console.log("Sending signal:", data.type);
}
