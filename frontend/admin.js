let map = null;
let markers = {}; // user_id -> marker
let activeUsers = {}; // user_id -> user_data
let currentStreamingUser = null;
// peerConnections is already declared in app.js

function initAdmin() {
    if (!map) {
        map = L.map('map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    fetchActiveUsers();
}

async function fetchActiveUsers() {
    try {
        const res = await fetch(`${API_URL}/active-users`);
        const users = await res.json();
        users.forEach(u => {
            addUserToDashboard(u);
        });
    } catch (err) {
        console.error("Failed to fetch active users", err);
    }
}

function handleAdminWSMessage(msg) {
    if (msg.type === "sos_start") {
        addUserToDashboard(msg.user);
    } else if (msg.type === "sos_stop") {
        removeUserFromDashboard(msg.user_id);
    } else if (msg.type === "location_update") {
        updateUserLocation(msg.user_id, msg.lat, msg.lng);
    } else if (msg.type === "webrtc_answer") {
        const pc = peerConnections[msg.from];
        if (pc) pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
    } else if (msg.type === "webrtc_candidate") {
        const pc = peerConnections[msg.from];
        if (pc) pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
}

function addUserToDashboard(user) {
    if (activeUsers[user.id]) return;
    
    activeUsers[user.id] = user;
    
    const list = document.getElementById("active-users-list");
    const existingPlaceholder = list.querySelector("p");
    if (existingPlaceholder) existingPlaceholder.remove();
    
    const card = document.createElement("div");
    card.id = `user-card-${user.id}`;
    card.className = "user-card glass";
    card.innerHTML = `
        <div class="user-info">
            <img src="${user.profile_photo || 'https://via.placeholder.com/56'}" class="profile-img">
            <div>
                <div style="font-weight: bold;">${user.full_name}</div>
                <div style="font-size: 12px; color: var(--text-dim);">Age: ${user.age}</div>
                <div style="font-size: 11px; color: var(--primary); margin-top: 4px; font-weight: 800;">ACTIVE SOS</div>
            </div>
        </div>
    `;
    card.onclick = () => {
        document.querySelectorAll('.user-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        if (user.lat && user.lng) {
            map.setView([user.lat, user.lng], 16);
            markers[user.id].openPopup();
        }
        openVideo(user);
    };
    list.appendChild(card);
    
    if (user.lat && user.lng) {
        updateUserLocation(user.id, user.lat, user.lng);
    }
}

function updateUserLocation(userId, lat, lng) {
    if (!map) return;
    
    if (markers[userId]) {
        markers[userId].setLatLng([lat, lng]);
    } else {
        const user = activeUsers[userId];
        const marker = L.marker([lat, lng]).addTo(map)
            .bindPopup(`
                <div style="color:white; min-width:120px;">
                    <b style="font-size:1.1rem; color:var(--primary);">${user.full_name}</b><br>
                    <span style="font-size:0.9rem; opacity:0.8;">Age: ${user.age}</span><br>
                    <button onclick="startVideoRequest(${userId})" class="btn btn-primary" style="padding:6px 12px; font-size:12px; width:100%; margin-top:10px;">VIEW LIVE FEED</button>
                </div>
            `);
        markers[userId] = marker;
        marker.on('click', () => {
            openVideo(user);
        });
    }
    
    if (Object.keys(markers).length === 1) {
        map.setView([lat, lng], 15);
    }
}

function openVideo(user) {
    document.getElementById("floating-video-panel").classList.remove("hidden");
    document.getElementById("active-user-name").innerText = user.full_name;
    startVideoRequest(user.id);
}

function closeVideo() {
    document.getElementById("floating-video-panel").classList.add("hidden");
    if (currentStreamingUser && peerConnections[currentStreamingUser]) {
        peerConnections[currentStreamingUser].close();
        delete peerConnections[currentStreamingUser];
    }
    document.getElementById("admin-video-large").srcObject = null;
    currentStreamingUser = null;
}

function removeUserFromDashboard(userId) {
    if (markers[userId]) {
        map.removeLayer(markers[userId]);
        delete markers[userId];
    }
    
    const card = document.getElementById(`user-card-${userId}`);
    if (card) card.remove();
    
    if (currentStreamingUser == userId) {
        closeVideo();
    }
    
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    
    delete activeUsers[userId];
    
    if (Object.keys(activeUsers).length === 0) {
        document.getElementById("active-users-list").innerHTML = 
            '<p style="color: var(--text-dim); text-align: center; margin-top: 40px;">No active SOS signals</p>';
    }
}

async function startVideoRequest(userId) {
    if (currentStreamingUser == userId) return;
    
    if (currentStreamingUser && peerConnections[currentStreamingUser]) {
        peerConnections[currentStreamingUser].close();
        delete peerConnections[currentStreamingUser];
    }
    
    currentStreamingUser = userId;
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peerConnections[userId] = pc;
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({ type: "webrtc_candidate", to: userId, from: "admin", candidate: event.candidate }));
        }
    };
    pc.ontrack = (event) => {
        document.getElementById("admin-video-large").srcObject = event.streams[0];
    };
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({ type: "webrtc_offer", to: userId, from: "admin", offer: offer }));
}

