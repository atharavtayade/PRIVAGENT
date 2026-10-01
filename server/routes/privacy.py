"""
PRIVAGENT — Privacy Validation Endpoints
Used during benchmarking, testing, and continuous judging verification to validate
that zero raw PII leaks past the client boundary.
"""

import re
from fastapi import APIRouter
from server.schemas.context import PrivacyValidateRequest
from server.schemas.action import PrivacyValidateResponse

router = APIRouter(prefix="/privacy", tags=["Privacy Verification"])


@router.post("/validate", response_model=PrivacyValidateResponse)
async def validate_sanitization(request: PrivacyValidateRequest) -> PrivacyValidateResponse:
    """
    POST /privacy/validate
    Audits the incoming context to verify no unredacted PII patterns exist.
    """
    leaks = []
    total_redacted = 0

    # Common regex patterns to catch any unredacted leak
    patterns = {
        "UNMASKED_EMAIL": re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'),
        "UNMASKED_AADHAAR": re.compile(r'\b\d{4}\s\d{4}\s\d{4}\b'),
        "UNMASKED_PAN": re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b'),
        "UNMASKED_PHONE": re.compile(r'(?:\+?91[\s-]?)?[6789]\d{9}'),
    }

    for el in request.elements:
        if el.is_redacted:
            total_redacted += 1
            continue

        text_to_check = f"{el.text or ''} {el.value or ''}"
        
        # Check for unmasked password inputs
        if (el.inputType or "").lower() == "password" and (el.value or "") != "[PASSWORD_REDACTED]":
            leaks.append(f"Unredacted password input: {el.selector}")

        for cat, pat in patterns.items():
            if pat.search(text_to_check):
                # Ensure it's not already a placeholder
                if not text_to_check.strip().startswith("[") or not text_to_check.strip().endswith("]"):
                    leaks.append(f"{cat} in element {el.selector}")

    has_leak = len(leaks) > 0
    return PrivacyValidateResponse(
        valid=not has_leak,
        leak_detected=has_leak,
        leaked_categories=leaks,
        total_redacted_elements=total_redacted,
        message="Privacy Gate Passed: Zero unmasked PII detected in transmission context." if not has_leak else "SECURITY ALERT: Leaked sensitive content detected."
    )
