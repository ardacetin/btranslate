import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv("backend/.env")

async def test():
    key = os.getenv("DEEPGRAM_API_KEY")
    if not key:
        print("No DEEPGRAM_API_KEY")
        return
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.deepgram.com/v1/projects",
            headers={"Authorization": f"Token {key}"}
        )
        print("Deepgram status:", resp.status_code)
        print("Body:", resp.text)

asyncio.run(test())
