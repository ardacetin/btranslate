from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session as DBSession
from pydantic import BaseModel
from typing import List
import uuid

from database import get_db, init_db, EventSession, User
from sockets import manager, log_activity
from auth import verify_password, create_access_token, get_current_user, check_admin, get_password_hash
from ai_engine import DEEPGRAM_API_KEY

app = FastAPI(title="btranslate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    init_db()
    if DEEPGRAM_API_KEY:
        print("[BOOT] Deepgram API key found — using Nova-3 streaming STT + Aura TTS")
    else:
        print("[BOOT] No Deepgram key — falling back to Whisper chunk-based STT + browser TTS")

# Mount frontend static files
import os
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def read_index():
    return FileResponse(os.path.join(frontend_dir, "index.html"))

@app.get("/host")
def read_host():
    return FileResponse(os.path.join(frontend_dir, "host.html"))

@app.get("/participant")
def read_participant():
    return FileResponse(os.path.join(frontend_dir, "participant.html"))

class CreateSessionRequest(BaseModel):
    event_name: str = "Live Event"
    source_language: str = "auto"

@app.post("/api/auth/login")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: DBSession = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role}

@app.get("/api/auth/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {"status": "ok", "role": current_user.role}

# --- USER MANAGEMENT ENDPOINTS ---

class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    class Config:
        orm_mode = True

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"

@app.get("/api/users", response_model=List[UserResponse])
def get_users(db: DBSession = Depends(get_db), current_user: User = Depends(check_admin)):
    return db.query(User).all()

@app.post("/api/users", response_model=UserResponse)
def create_user(user: UserCreate, db: DBSession = Depends(get_db), current_user: User = Depends(check_admin)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Username already registered")
    db_user = User(
        username=user.username,
        hashed_password=get_password_hash(user.password),
        role=user.role
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: DBSession = Depends(get_db), current_user: User = Depends(check_admin)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    if db_user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db.delete(db_user)
    db.commit()
    return {"detail": "User deleted"}

class UserPasswordUpdate(BaseModel):
    new_password: str

@app.put("/api/users/{user_id}/password")
def update_user_password(user_id: int, data: UserPasswordUpdate, db: DBSession = Depends(get_db), current_user: User = Depends(check_admin)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.hashed_password = get_password_hash(data.new_password)
    db.commit()
    return {"detail": "Password updated successfully"}

@app.get("/api/admin/logs")
def view_system_logs(current_user: User = Depends(check_admin)):
    import os
    if not os.path.exists("usage.log"):
        return {"logs": "Bozuk veya kayit yok."}
    try:
        with open("usage.log", "r", encoding="utf-8") as f:
            lines = f.readlines()
            return {"logs": "".join(lines[-100:])} # return last 100 lines
    except Exception as e:
        return {"error": str(e)}

# --- HOST ENDPOINTS ---

@app.post("/api/sessions")
def create_session(req: CreateSessionRequest, db: DBSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    event_code = str(uuid.uuid4())[:8].upper() # e.g. "8A9B2C3D"
    new_session = EventSession(event_code=event_code, event_name=req.event_name, source_language=req.source_language)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    log_activity(f"EVENT CREATED: {new_session.event_name} ({event_code}) by {current_user.username}")
    return {"event_code": new_session.event_code, "event_name": new_session.event_name, "source_language": new_session.source_language}

@app.get("/api/sessions/{event_code}")
def get_session(event_code: str, db: DBSession = Depends(get_db)):
    session = db.query(EventSession).filter(EventSession.event_code == event_code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"event_code": session.event_code, "event_name": session.event_name, "source_language": session.source_language}

@app.websocket("/ws/host/{event_code}")
async def websocket_host(websocket: WebSocket, event_code: str, rate: int = 16000):
    await manager.connect_host(websocket, event_code)
    try:
        if DEEPGRAM_API_KEY:
            # Tell client to use PCM streaming mode
            await websocket.send_text('{"mode":"deepgram"}')
            # Start Deepgram streaming connection with the exact sample rate
            await manager.start_deepgram_stream(event_code, rate)
            while True:
                audio_bytes = await websocket.receive_bytes()
                if len(audio_bytes) < 10:
                    continue
                await manager.send_audio_to_deepgram(event_code, audio_bytes)
        else:
            # Tell client to use MediaRecorder chunk mode
            await websocket.send_text('{"mode":"whisper"}')
            while True:
                audio_bytes = await websocket.receive_bytes()
                if len(audio_bytes) < 10:
                    continue
                await manager.broadcast_translations_whisper(event_code, audio_bytes, source_lang="auto")
    except WebSocketDisconnect:
        manager.disconnect_host(event_code)
    except Exception as e:
        print(f"Host WS Error: {e}")
        manager.disconnect_host(event_code)

@app.websocket("/ws/participant/{event_code}/{target_lang}")
async def websocket_participant(websocket: WebSocket, event_code: str, target_lang: str):
    await manager.connect_participant(websocket, event_code, target_lang)
    try:
        while True:
            # Keep connection alive, participant only receives
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_participant(websocket, event_code, target_lang)
    except Exception as e:
        print(f"Participant WS Error: {e}")
        manager.disconnect_participant(websocket, event_code, target_lang)
