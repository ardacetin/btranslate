import asyncio
import os
import websockets
import json

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

async def test():
    url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "OpenAI-Beta": "realtime=v1"
    }
    async with websockets.connect(url, additional_headers=headers) as ws:
        # Update session
        await ws.send(json.dumps({
            "type": "session.update",
            "session": {
                "modalities": ["audio", "text"],
                "instructions": "Translate to Turkish.",
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {"type": "server_vad"}
            }
        }))
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            print(data["type"])
            if data["type"] == "error":
                print(data)
                break
            if data["type"] == "session.updated":
                break

asyncio.run(test())
