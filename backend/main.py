from fastapi import FastAPI, Depends, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session as DBSession
from pydantic import BaseModel
import uuid

from .database import get_db, init_db, EventSession
from .sockets import manager

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
    source_language: str = "auto"

@app.post("/api/sessions")
def create_session(req: CreateSessionRequest, db: DBSession = Depends(get_db)):
    event_code = str(uuid.uuid4())[:8].upper() # e.g. "8A9B2C3D"
    new_session = EventSession(event_code=event_code, source_language=req.source_language)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return {"event_code": new_session.event_code, "source_language": new_session.source_language}

@app.get("/api/sessions/{event_code}")
def get_session(event_code: str, db: DBSession = Depends(get_db)):
    session = db.query(EventSession).filter(EventSession.event_code == event_code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"event_code": session.event_code, "source_language": session.source_language}

@app.websocket("/ws/host/{event_code}")
async def websocket_host(websocket: WebSocket, event_code: str):
    await manager.connect_host(websocket, event_code)
    try:
        while True:
            # Host sends audio chunks as bytes
            audio_bytes = await websocket.receive_bytes()
            # We don't have source_lang easily accessible here without query DB if we want,
            # but manager uses "auto" by default. For MVP, auto is fine.
            await manager.broadcast_translations(event_code, audio_bytes, source_lang="auto")
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
