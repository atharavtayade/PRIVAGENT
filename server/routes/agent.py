"""
PRIVAGENT — Agent Routing Endpoints
Receives sanitized screen context from the browser extension and returns structured actions.
"""

from fastapi import APIRouter, HTTPException, Depends
from server.schemas.context import PlanRequest
from server.schemas.action import PlanResponse
from server.agents.reasoning_engine import ReasoningEngine

router = APIRouter(prefix="/agent", tags=["Agent Reasoning"])

# Singleton engine instance
engine = ReasoningEngine()


@router.post("/plan", response_model=PlanResponse)
async def generate_action_plan(request: PlanRequest) -> PlanResponse:
    """
    POST /agent/plan
    Primary endpoint called by the PRIVAGENT extension service worker.
    
    SECURITY INVARIANTS:
    1. The payload MUST contain only sanitized context.
    2. Raw visual or personal data is strictly blocked at the client gate.
    3. The response contains a validated, constrained action sequence.
    """
    if not request.task or not request.task.strip():
        raise HTTPException(status_code=400, detail="Task instruction cannot be empty")

    try:
        plan = await engine.plan_action(request)
        return plan
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reasoning failure: {str(e)}")
