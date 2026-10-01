"""
PRIVAGENT — Action Protocol Schemas
Defines the constrained action schema returned by the central reasoning server.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class ActionType(str, Enum):
    CLICK = "CLICK"
    SCROLL = "SCROLL"
    NAVIGATE = "NAVIGATE"
    FOCUS = "FOCUS"
    TYPE = "TYPE"
    SELECT = "SELECT"
    WAIT = "WAIT"
    PRESS_KEY = "PRESS_KEY"


class ActionTarget(BaseModel):
    selector: Optional[str] = None
    text: Optional[str] = None
    tag: Optional[str] = None
    bbox: Optional[List[int]] = None
    inputType: Optional[str] = None


class ActionItem(BaseModel):
    type: ActionType
    target: Optional[ActionTarget] = None
    text: Optional[str] = None          # For TYPE action
    clear: Optional[bool] = False       # Clear field before typing
    direction: Optional[str] = "DOWN"   # For SCROLL: UP, DOWN, LEFT, RIGHT
    amount: Optional[int] = 300         # Pixels for SCROLL
    url: Optional[str] = None           # For NAVIGATE
    back: Optional[bool] = None         # For NAVIGATE history back
    forward: Optional[bool] = None      # For NAVIGATE history forward
    value: Optional[str] = None         # For SELECT
    duration: Optional[int] = 1000      # Milliseconds for WAIT
    key: Optional[str] = None           # For PRESS_KEY (e.g. "Enter", "Escape", "Tab")


class PlanResponse(BaseModel):
    """
    Standard structured response from the reasoning server.
    """
    status: str = Field(default="ok", description="'in_progress', 'complete', or 'error'")
    task: str
    thought: str = Field(description="Observable reasoning explanation without leaking private data")
    actions: List[ActionItem] = Field(default_factory=list)
    latency_ms: float = 0.0


class PrivacyValidateResponse(BaseModel):
    valid: bool
    leak_detected: bool = False
    leaked_categories: List[str] = Field(default_factory=list)
    total_redacted_elements: int = 0
    message: str = "Sanitization verified successfully"
