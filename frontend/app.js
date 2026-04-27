const API_URL = "";
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const WS_URL = `${protocol}//${window.location.host}/ws`;

let currentUser = null;
let token = null;
let socket = null;
let localStream = null;
let watchId = null;
let peerConnections = {}; // target_id -> RTCPeerConnection

// UI Elements
const screens = ["login-screen", "register-screen", "user-dashboard", "admin-dashboard"];
const nav = document.getElementById("app-nav");

function showScreen(screenId) {
    screens.forEach(id => {
        document.getElementById(id).classList.add("hidden");
    });
    document.getElementById(screenId).classList.remove("hidden");
    
    if (screenId === "login-screen" || screenId === "register-screen") {
        nav.classList.add("hidden");
    } else {
        nav.classList.remove("hidden");
        document.getElementById("nav-username").innerText = currentUser.full_name;
    }
}

function toggleAuth(isReg) {
    showScreen(isReg ? "register-screen" : "login-screen");
}

async function handleLogin() {
    const u = document.getElementById("login-username").value;
    const p = document.getElementById("login-password").value;
    
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
        });
        
        if (!res.ok) throw new Error("Login failed");
        
        const data = await res.json();
        token = data.access_token;
        currentUser = data.user;
        localStorage.setItem("token", token);
        
        initApp();
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister() {
    const u = document.getElementById("reg-username").value;
    const p = document.getElementById("reg-password").value;
    const f = document.getElementById("reg-fullname").value;
    const a = document.getElementById("reg-age").value;
    const r = document.getElementById("reg-role").value;
    const photoFile = document.getElementById("reg-photo").files[0];
    
    let photoBase64 = null;
    if (photoFile) {
        photoBase64 = await toBase64(photoFile);
    }
    
    try {
        const res = await fetch(`${API_URL}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                username: u, 
                password: p, 
                full_name: f, 
                age: parseInt(a), 
                role: r,
                profile_photo: photoBase64
            })
        });
        
        if (!res.ok) throw new Error("Registration failed");
        alert("Registered successfully! Please login.");
        toggleAuth(false);
    } catch (err) {
        alert(err.message);
    }
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function initApp() {
    if (currentUser.role === "admin") {
        showScreen("admin-dashboard");
        initAdmin();
    } else {
        showScreen("user-dashboard");
        document.getElementById("user-welcome").innerText = `Hello, ${currentUser.full_name}`;
    }
    connectWebSocket();
}

function connectWebSocket() {
    const clientId = currentUser.role === "admin" ? "admin" : currentUser.id;
    socket = new WebSocket(`${WS_URL}/${clientId}`);
    
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleWSMessage(msg);
    };
    
    socket.onclose = () => {
        console.log("WebSocket closed. Reconnecting...");
        setTimeout(connectWebSocket, 3000);
    };
}

async function handleWSMessage(msg) {
    if (currentUser.role === "admin") {
        handleAdminWSMessage(msg);
    } else {
        // User side messages (mostly signaling)
        if (msg.type === "webrtc_offer") {
            await handleOffer(msg);
        } else if (msg.type === "webrtc_candidate") {
            const pc = peerConnections[msg.from];
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        }
    }
}

// User Side: SOS
let sosActive = false;

async function toggleSOS() {
    sosActive = !sosActive;
    const btn = document.getElementById("sos-btn");
    const statusVal = document.getElementById("status-val");
    const controls = document.getElementById("sos-active-controls");
    
    if (sosActive) {
        btn.innerText = "SOS ACTIVE";
        btn.classList.add("active");
        statusVal.innerText = "ACTIVE";
        statusVal.className = "status-badge status-active";
        controls.classList.remove("hidden");
        
        // Start Tracking
        startTracking();
        // Start Camera
        await startMedia();
        
        socket.send(JSON.stringify({ type: "sos_start" }));
    } else {
        btn.innerText = "SOS";
        btn.classList.remove("active");
        statusVal.innerText = "INACTIVE";
        statusVal.className = "status-badge status-inactive";
        controls.classList.add("hidden");
        
        stopTracking();
        stopMedia();
        
        socket.send(JSON.stringify({ type: "sos_stop" }));
    }
}

function startTracking() {
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            const { latitude, longitude } = pos.coords;
            socket.send(JSON.stringify({
                type: "location",
                lat: latitude,
                lng: longitude
            }));
        }, (err) => console.error(err), { enableHighAccuracy: true });
    }
}

function stopTracking() {
    if (watchId) navigator.geolocation.clearWatch(watchId);
}

async function startMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("user-preview").srcObject = localStream;
    } catch (err) {
        console.error("Camera access denied", err);
    }
}

function stopMedia() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    // Close peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
}

// WebRTC Signaling for User
async function handleOffer(msg) {
    const pc = createPeerConnection(msg.from);
    await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.send(JSON.stringify({
        type: "webrtc_answer",
        to: msg.from,
        from: currentUser.id,
        answer: answer
    }));
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    
    peerConnections[targetId] = pc;
    
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: "webrtc_candidate",
                to: targetId,
                from: currentUser.id,
                candidate: event.candidate
            }));
        }
    };
    
    return pc;
}

function logout() {
    localStorage.removeItem("token");
    window.location.reload();
}
