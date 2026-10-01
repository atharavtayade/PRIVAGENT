"""
PRIVAGENT — Health & Metrics Endpoints
"""

import time
from typing import Dict, Any
from fastapi import APIRouter

router = APIRouter(tags=["Health & Telemetry"])

SERVER_START_TIME = time.time()
REQUEST_METRICS = {
    "total_requests": 0,
    "total_actions_generated": 0,
    "total_latency_ms": 0.0,
    "last_request_time": None
}


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    GET /health
    Verifies server availability for the extension agent loop.
    """
    uptime_sec = round(time.time() - SERVER_START_TIME, 1)
    return {
        "status": "healthy",
        "service": "PRIVAGENT Reasoning Server",
        "version": "0.1.0",
        "uptime_seconds": uptime_sec,
        "privacy_gate": "ENFORCED"
    }


@router.get("/metrics")
async def get_metrics() -> Dict[str, Any]:
    """
    GET /metrics
    Benchmark endpoint for SIH evaluation dimensions (Section 22 of blueprint).
    """
    total = REQUEST_METRICS["total_requests"]
    avg_latency = round(REQUEST_METRICS["total_latency_ms"] / total, 2) if total > 0 else 0.0

    return {
        "total_inference_requests": total,
        "total_actions_generated": REQUEST_METRICS["total_actions_generated"],
        "average_server_latency_ms": avg_latency,
        "last_request_timestamp": REQUEST_METRICS["last_request_time"]
    }
