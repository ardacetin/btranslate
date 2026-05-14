import asyncio
import os
import websockets
import json

from dotenv import load_dotenv
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

async def test():
    if not OPENAI_API_KEY:
        print("No API key!")
        return

    url = "wss://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1"
    }
    print("Connecting...")
    async with websockets.connect(url, extra_headers=headers) as ws:
        print("Connected!")
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "instructions": "Translate to Turkish.",
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {"type": "server_vad"}
            }
        }))
        print("Sent update.")
        
        # Send some dummy audio to trigger something
        import base64
        dummy_audio = b'\x00' * 24000
        await ws.send(json.dumps({
            "type": "input_audio_buffer.append",
            "audio": base64.b64encode(dummy_audio).decode('utf-8')
        }))
        await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
        
        for _ in range(5):
            msg = await ws.recv()
            data = json.loads(msg)
            print(f"Received: {data['type']}")
            if data["type"] == "error":
                print("Error details:", data)
                break

asyncio.run(test())
