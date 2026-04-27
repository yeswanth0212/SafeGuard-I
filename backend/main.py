from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import os
import sys

# Ensure backend directory is in sys.path for deployment
sys.path.append(os.path.dirname(__file__))

import models, schemas, auth
from typing import List, Dict

SQLALCHEMY_DATABASE_URL = "sqlite:///./safeguard.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="SafeGuard AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {} # user_id -> websocket
        self.admin_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket, user_id: str = None, is_admin: bool = False):
        await websocket.accept()
        if is_admin:
            self.admin_connections.append(websocket)
        elif user_id:
            self.active_connections[user_id] = websocket

    def disconnect(self, websocket: WebSocket, user_id: str = None, is_admin: bool = False):
        if is_admin:
            if websocket in self.admin_connections:
                self.admin_connections.remove(websocket)
        elif user_id:
            if user_id in self.active_connections:
                del self.active_connections[user_id]

    async def broadcast_to_admins(self, message: dict):
        for connection in self.admin_connections:
            await connection.send_json(message)

    async def send_to_user(self, user_id: str, message: dict):
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)

manager = ConnectionManager()

# Auth Routes
@app.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(auth.get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(
        username=user.username,
        hashed_password=hashed_password,
        full_name=user.full_name,
        age=user.age,
        profile_photo=user.profile_photo,
        role=user.role
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.post("/login")
def login(user_data: schemas.UserLogin, db: Session = Depends(auth.get_db)):
    user = db.query(models.User).filter(models.User.username == user_data.username).first()
    if not user or not auth.verify_password(user_data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    
    access_token = auth.create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "user": user}

@app.get("/users/me", response_model=schemas.UserOut)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user

@app.get("/active-users", response_model=List[schemas.UserOut])
def get_active_users(db: Session = Depends(auth.get_db)):
    return db.query(models.User).filter(models.User.status == "ACTIVE").all()

# WebSockets
@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    # client_id can be "admin" or a user_id
    is_admin = client_id == "admin"
    await manager.connect(websocket, user_id=None if is_admin else client_id, is_admin=is_admin)
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Types of messages:
            # 1. location_update: {type: "location", lat: x, lng: y}
            # 2. sos_start: {type: "sos_start"}
            # 3. sos_stop: {type: "sos_stop"}
            # 4. webrtc_offer/answer/candidate: {type: "webrtc_...", to: target_id, ...}
            
            msg_type = message.get("type")
            
            if msg_type == "location":
                # Update DB and broadcast to admins
                db = SessionLocal()
                user = db.query(models.User).filter(models.User.id == int(client_id)).first()
                if user:
                    user.lat = message.get("lat")
                    user.lng = message.get("lng")
                    user.status = "ACTIVE"
                    db.commit()
                    await manager.broadcast_to_admins({
                        "type": "location_update",
                        "user_id": client_id,
                        "lat": user.lat,
                        "lng": user.lng,
                        "full_name": user.full_name
                    })
                db.close()
                
            elif msg_type == "sos_start":
                db = SessionLocal()
                user = db.query(models.User).filter(models.User.id == int(client_id)).first()
                if user:
                    user.status = "ACTIVE"
                    db.commit()
                    await manager.broadcast_to_admins({
                        "type": "sos_start",
                        "user": {
                            "id": user.id,
                            "full_name": user.full_name,
                            "age": user.age,
                            "profile_photo": user.profile_photo,
                            "lat": user.lat,
                            "lng": user.lng
                        }
                    })
                db.close()
                
            elif msg_type == "sos_stop":
                db = SessionLocal()
                user = db.query(models.User).filter(models.User.id == int(client_id)).first()
                if user:
                    user.status = "INACTIVE"
                    db.commit()
                    await manager.broadcast_to_admins({
                        "type": "sos_stop",
                        "user_id": client_id
                    })
                db.close()
            
            elif msg_type.startswith("webrtc_"):
                # Signaling: forward to the target
                target_id = message.get("to")
                if target_id == "admin":
                    await manager.broadcast_to_admins(message)
                else:
                    await manager.send_to_user(str(target_id), message)

    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id=None if is_admin else client_id, is_admin=is_admin)
        if not is_admin:
            # Optionally mark user as inactive if disconnected abruptly
            db = SessionLocal()
            user = db.query(models.User).filter(models.User.id == int(client_id)).first()
            if user:
                user.status = "INACTIVE"
                db.commit()
                await manager.broadcast_to_admins({"type": "sos_stop", "user_id": client_id})
            db.close()

# Serve Frontend - Define this LAST
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_path, "index.html"))

app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
