"""
PRIVAGENT — Context Schemas
Pydantic data models for the sanitized context received from the browser agent.
"""

from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field


class ViewportInfo(BaseModel):
    width: int = 1280
    height: int = 800
    scrollX: int = 0
    scrollY: int = 0
    pageWidth: Optional[int] = None
    pageHeight: Optional[int] = None


class PageMetadata(BaseModel):
    url: str
    title: str = ""
    viewport: Optional[ViewportInfo] = None


class ElementDescriptor(BaseModel):
    id: Optional[str] = None
    type: str = "unknown"
    tag: str = "div"
    bbox: List[int] = Field(default_factory=lambda: [0, 0, 0, 0])
    depth: Optional[int] = None
    inViewport: Optional[bool] = True
    text: Optional[str] = None
    inputType: Optional[str] = None
    value: Optional[str] = None
    placeholder: Optional[str] = None
    autocomplete: Optional[str] = None
    name: Optional[str] = None
    label: Optional[str] = None
    ariaLabel: Optional[str] = None
    ariaDescription: Optional[str] = None
    role: Optional[str] = None
    selector: Optional[str] = None
    options: Optional[List[Dict[str, Any]]] = None
    
    # Privacy annotations added by content/service worker
    is_redacted: Optional[bool] = Field(default=False, alias="_redacted")
    redaction_mode: Optional[str] = Field(default=None, alias="_redactionMode")
    pii_category: Optional[str] = Field(default=None, alias="_piiCategory")
    privacy_level: Optional[int] = Field(default=None, alias="_privacyLevel")

    class Config:
        populate_by_name = True


class PrivacyMetadata(BaseModel):
    totalRedactions: int = 0
    categoryCounts: Dict[str, int] = Field(default_factory=dict)
    policyMode: str = "BALANCED"
    rawDataSent: bool = False
    sanitized: bool = True


class PlanRequest(BaseModel):
    """
    POST /agent/plan request body.
    Contains ONLY sanitized context — raw screen context is blocked at client gate.
    """
    task: str
    page: PageMetadata
    elements: List[ElementDescriptor] = Field(default_factory=list)
    privacy_metadata: Optional[PrivacyMetadata] = None
    sanitized_image: Optional[str] = None  # Base64 data URL (with bboxes masked/blurred)


class PrivacyValidateRequest(BaseModel):
    """
    POST /privacy/validate request body for verifying client sanitization.
    """
    elements: List[ElementDescriptor] = Field(default_factory=list)
    privacy_metadata: Optional[PrivacyMetadata] = None
