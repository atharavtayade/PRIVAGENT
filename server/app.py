"""
PRIVAGENT — Central Reasoning Server
FastAPI entrypoint for on-device browser agent reasoning.
"""

import time
import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from server.dashboard import HTML_DASHBOARD

from server.routes import agent, privacy, health

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("privagent.server")

app = FastAPI(
    title="PRIVAGENT Reasoning Brain",
    description="Central AI reasoning server for lightweight privacy-first browser agents (SIH26171).",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for browser extension origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows chrome-extension:// origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def telemetry_middleware(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # Track metrics for /agent/plan calls
    if request.url.path == "/agent/plan":
        health.REQUEST_METRICS["total_requests"] += 1
        health.REQUEST_METRICS["total_latency_ms"] += elapsed_ms
        health.REQUEST_METRICS["last_request_time"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    response.headers["X-Server-Latency-Ms"] = f"{elapsed_ms:.2f}"
    return response


# Mount Routers
app.include_router(agent.router)
app.include_router(privacy.router)
app.include_router(health.router)


@app.get("/")
async def root(request: Request):
    accept_header = request.headers.get("accept", "").lower()
    format_param = request.query_params.get("format", "").lower()

    if "application/json" in accept_header or format_param == "json":
        return {
            "service": "PRIVAGENT Central Reasoning Server",
            "status": "online",
            "documentation": "/docs",
            "privacy_boundary": "ENFORCED (Sanitized payloads only)"
        }

    return HTMLResponse(content=HTML_DASHBOARD)


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting PRIVAGENT Reasoning Server on http://localhost:8000")
    uvicorn.run("server.app:app", host="0.0.0.0", port=8000, reload=True)
