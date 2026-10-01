"""
PRIVAGENT — Server Launcher
Run with: python run_server.py

Loads environment variables from .env (including GEMINI_API_KEY)
before starting the FastAPI server.
"""

import os
import uvicorn
from dotenv import load_dotenv

# Load .env from project root (where this script lives)
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
load_dotenv(env_path)

if __name__ == "__main__":
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    host = os.getenv("SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("SERVER_PORT", "8000"))

    print("═" * 64)
    print("  PRIVAGENT — Central Reasoning Server (SIH26171)")
    print("  Privacy Boundary: ENFORCED (Accepts only sanitized context)")
    print(f"  Reasoning Engine: Google Gemini ({gemini_model})")
    print(f"  Gemini API Key:   {'✅ Configured' if gemini_key else '❌ Missing (set GEMINI_API_KEY in .env)'}")
    print(f"  Endpoints:        http://{host}:{port}")
    print(f"  API Documentation: http://{host}:{port}/docs")
    print("═" * 64)

    uvicorn.run("server.app:app", host=host, port=port, reload=True)
