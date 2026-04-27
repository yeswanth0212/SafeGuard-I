---
title: SafeGuard AI
emoji: 🛡️
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
app_port: 7860
---

# SafeGuard AI - Emergency Safety System

SafeGuard AI is a high-end emergency safety platform designed to provide real-time situational awareness and emergency assistance.

## Features
- **Real-time SOS tracking** with Leaflet.js maps.
- **Live Camera Streaming** simulation for emergency verification.
- **Admin Command Center** for multi-user monitoring.
- **Modern Glassmorphism UI** with dark mode aesthetics.

## Deployment on Hugging Face Spaces
This space runs a FastAPI backend with a static frontend served via Docker.

### Local Development
To run this project locally:
1. Clone the repository.
2. Install dependencies: `pip install -r requirements.txt`
3. Run the backend: `python backend/main.py`
4. Open `http://localhost:8000` in your browser.
