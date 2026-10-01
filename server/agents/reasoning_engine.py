"""
PRIVAGENT — Central Reasoning Engine (Gemini-Powered)
Processes sanitized screen context and generates structured action plans
using Google Gemini API for intent-driven navigation reasoning.

Architecture:
  1. PRIMARY: Google Gemini API (gemini-2.0-flash) for intelligent action planning
  2. FALLBACK: Deterministic perception planner (100% offline, keyword-based matching)
  3. OPTIONAL: OpenAI-compatible endpoint (Ollama, vLLM, etc.) as secondary fallback

Privacy Invariant:
  - Only sanitized context (with PII redacted to placeholders) reaches this engine.
  - The Gemini prompt explicitly forbids inferring/unmasking redacted values.
"""

import os
import re
import time
import json
import logging
from typing import List, Optional

import httpx

from server.schemas.context import PlanRequest, ElementDescriptor
from server.schemas.action import PlanResponse, ActionItem, ActionType, ActionTarget
from server.agents.prompts import SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger("privagent.reasoning")


class ReasoningEngine:
    """
    Multi-tier reasoning engine with Gemini as the primary brain.
    
    Tier 1: Google Gemini API — intelligent, context-aware action planning
    Tier 2: OpenAI-compatible fallback (optional, for local Ollama/vLLM)
    Tier 3: Deterministic perception planner — zero-network, keyword-matching
    """

    def __init__(self):
        # ─── Gemini Configuration ────────────────────────────────────
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
        self.has_gemini = bool(self.gemini_api_key)

        # ─── OpenAI-Compatible Fallback Configuration ────────────────
        self.llm_api_base = os.getenv("LLM_API_BASE", "").strip()
        self.llm_api_key = os.getenv("LLM_API_KEY", "").strip()
        self.llm_model = os.getenv("LLM_MODEL", "qwen2.5-coder:7b")
        self.has_external_llm = bool(self.llm_api_base)

        # ─── Gemini Client (google-genai SDK) ────────────────────────
        self._gemini_client = None
        if self.has_gemini:
            try:
                from google import genai
                self._gemini_client = genai.Client(api_key=self.gemini_api_key)
                logger.info(f"✅ Gemini API client initialized (model: {self.gemini_model})")
            except ImportError:
                logger.warning("google-genai package not installed. Run: pip install google-genai")
                self.has_gemini = False
            except Exception as e:
                logger.error(f"Failed to initialize Gemini client: {e}")
                self.has_gemini = False
        else:
            logger.info("No GEMINI_API_KEY set — Gemini reasoning disabled. Using deterministic fallback.")

    async def plan_action(self, request: PlanRequest) -> PlanResponse:
        """
        Main entry point: tries Gemini → OpenAI-compatible → deterministic fallback.
        """
        t0 = time.perf_counter()

        # ── Tier 1: Google Gemini API ────────────────────────────────
        if self.has_gemini and self._gemini_client:
            try:
                response = await self._query_gemini(request)
                if response:
                    response.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
                    logger.info(f"Gemini plan generated in {response.latency_ms}ms — {len(response.actions)} action(s)")
                    return response
            except Exception as e:
                logger.warning(f"Gemini API failed, trying fallback: {e}")

        # ── Tier 2: OpenAI-Compatible Endpoint (Ollama / vLLM) ──────
        if self.has_external_llm:
            try:
                response = await self._query_external_llm(request)
                if response:
                    response.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
                    return response
            except Exception as e:
                logger.warning(f"External LLM failed, falling back to deterministic engine: {e}")

        # ── Tier 3: Deterministic Perception-Action Engine (offline) ─
        response = self._deterministic_perception_planner(request)
        response.latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        return response

    # ═══════════════════════════════════════════════════════════════
    # Tier 1: Google Gemini API
    # ═══════════════════════════════════════════════════════════════

    async def _query_gemini(self, request: PlanRequest) -> Optional[PlanResponse]:
        """
        Query Google Gemini API using the google-genai SDK.
        Uses structured JSON output prompting for reliable action parsing.
        """
        from google.genai import types as genai_types
        import asyncio

        summary = self._summarize_elements(request.elements)
        user_prompt = build_user_prompt(
            task=request.task,
            page_title=request.page.title,
            page_url=request.page.url,
            elements_summary=summary,
            redaction_count=request.privacy_metadata.totalRedactions if request.privacy_metadata else 0
        )

        # Build the full prompt with JSON schema instruction
        json_schema_instruction = """
Respond with a valid JSON object matching this exact schema:
{
  "status": "in_progress" | "complete" | "error",
  "task": "<the original task>",
  "thought": "<your reasoning explanation without leaking any private data>",
  "actions": [
    {
      "type": "CLICK" | "SCROLL" | "TYPE" | "PRESS_KEY" | "FOCUS" | "SELECT" | "NAVIGATE" | "WAIT",
      "target": { "selector": "<CSS selector>", "text": "<element text>", "tag": "<HTML tag>", "bbox": [x, y, w, h] },
      "text": "<text to type (for TYPE action only — NEVER include 'and press enter' or submission instructions in this string)>",
      "key": "<key name for PRESS_KEY, e.g. 'Enter', 'Escape', 'Tab'>",
      "clear": true | false,
      "direction": "UP" | "DOWN" | "LEFT" | "RIGHT",
      "amount": <pixels for scroll>,
      "url": "<URL for NAVIGATE>",
      "value": "<value for SELECT>",
      "duration": <milliseconds for WAIT>
    }
  ]
}

Only include fields relevant to each action type. Ensure the JSON is valid.
Remember: TYPE text must be PURE typed characters only. Use a separate PRESS_KEY action for Enter/submit.
"""

        full_user_message = f"{user_prompt}\n\n{json_schema_instruction}"

        # Use the google-genai SDK (synchronous generate, wrapped in asyncio)
        def _call_gemini():
            response = self._gemini_client.models.generate_content(
                model=self.gemini_model,
                contents=[full_user_message],
                config=genai_types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    temperature=0.1,
                    max_output_tokens=2048,
                    response_mime_type="application/json",
                ),
            )
            return response

        # Run the synchronous SDK call in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        gemini_response = await loop.run_in_executor(None, _call_gemini)

        # Parse the response
        if gemini_response and gemini_response.text:
            raw_text = gemini_response.text.strip()
            logger.debug(f"Gemini raw response: {raw_text[:500]}")

            # Extract JSON from the response (handle markdown code blocks)
            json_text = self._extract_json(raw_text)
            parsed = json.loads(json_text)

            # Validate and construct PlanResponse
            return self._parse_plan_response(parsed, request.task)

        return None

    def _extract_json(self, text: str) -> str:
        """Extract JSON from response text, handling markdown code fences."""
        # Try to extract from ```json ... ``` blocks
        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
        if json_match:
            return json_match.group(1).strip()
        # Already raw JSON
        return text.strip()

    def _parse_plan_response(self, parsed: dict, fallback_task: str) -> PlanResponse:
        """Safely convert a parsed JSON dict into a PlanResponse."""
        actions = []
        for raw_action in parsed.get("actions", []):
            action_type_str = raw_action.get("type", "WAIT").upper()

            # Validate action type
            try:
                action_type = ActionType(action_type_str)
            except ValueError:
                logger.warning(f"Unknown action type from Gemini: {action_type_str}, skipping")
                continue

            # ── TYPE Action Sanitization & Multi-Step Splitting ──
            action_text = raw_action.get("text")
            has_enter_instruction = False
            if action_type == ActionType.TYPE and action_text:
                target_data = raw_action.get("target", {})
                selector = target_data.get("selector", "")
                
                # Block typing into password/OTP/payment fields
                sensitive_patterns = ["password", "otp", "cvv", "pin", "ssn", "aadhaar", "card"]
                if any(pat in selector.lower() for pat in sensitive_patterns):
                    logger.warning(f"BLOCKED: Gemini attempted TYPE into sensitive field: {selector}")
                    continue
                if any(pat in action_text.lower() for pat in ["[password_redacted]", "[otp_redacted]", "[redacted]"]):
                    logger.warning(f"BLOCKED: Gemini attempted to type redacted placeholder text")
                    continue

                # Strip out instruction phrases like "and press enter"
                if re.search(r'\s*(?:and\s+press\s+enter|and\s+hit\s+enter|and\s+press\s+return|\\n|\n)\s*', action_text, re.IGNORECASE):
                    has_enter_instruction = True
                    action_text = re.sub(r'\s*(?:and\s+press\s+enter|and\s+hit\s+enter|and\s+press\s+return|\\n|\n)\s*', '', action_text, flags=re.IGNORECASE).strip()

            # Build target
            target = None
            if "target" in raw_action and raw_action["target"]:
                target_data = raw_action["target"]
                target = ActionTarget(
                    selector=target_data.get("selector"),
                    text=target_data.get("text"),
                    tag=target_data.get("tag"),
                    bbox=target_data.get("bbox"),
                    inputType=target_data.get("inputType"),
                )

            actions.append(ActionItem(
                type=action_type,
                target=target,
                text=action_text,
                clear=raw_action.get("clear", False),
                direction=raw_action.get("direction", "DOWN"),
                amount=raw_action.get("amount", 300),
                url=raw_action.get("url"),
                value=raw_action.get("value"),
                duration=raw_action.get("duration", 1000),
                key=raw_action.get("key"),
            ))

            # If an enter instruction was present in the text, append a separate PRESS_KEY action
            if has_enter_instruction:
                logger.info(f"Split instruction phrase from TYPE text: emitting separate PRESS_KEY (Enter) and WAIT actions")
                actions.append(ActionItem(
                    type=ActionType.PRESS_KEY,
                    target=target,
                    key="Enter"
                ))
                actions.append(ActionItem(
                    type=ActionType.WAIT,
                    duration=2000
                ))

        return PlanResponse(
            status=parsed.get("status", "in_progress"),
            task=parsed.get("task", fallback_task),
            thought=parsed.get("thought", "Action plan generated by Gemini."),
            actions=actions,
        )

    # ═══════════════════════════════════════════════════════════════
    # Tier 2: OpenAI-Compatible Endpoint (Ollama / vLLM)
    # ═══════════════════════════════════════════════════════════════

    async def _query_external_llm(self, request: PlanRequest) -> Optional[PlanResponse]:
        """Query OpenAI-compatible or Ollama endpoint."""
        summary = self._summarize_elements(request.elements)
        user_prompt = build_user_prompt(
            task=request.task,
            page_title=request.page.title,
            page_url=request.page.url,
            elements_summary=summary,
            redaction_count=request.privacy_metadata.totalRedactions if request.privacy_metadata else 0
        )

        headers = {"Content-Type": "application/json"}
        if self.llm_api_key:
            headers["Authorization"] = f"Bearer {self.llm_api_key}"

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ]

        payload = {
            "model": self.llm_model,
            "messages": messages,
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{self.llm_api_base}/v1/chat/completions", headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                return self._parse_plan_response(parsed, request.task)
        return None

    # ═══════════════════════════════════════════════════════════════
    # Tier 3: Deterministic Perception-Action Engine (100% offline)
    # ═══════════════════════════════════════════════════════════════

    def _deterministic_perception_planner(self, request: PlanRequest) -> PlanResponse:
        """
        Autonomous Perception Engine:
        Analyzes task intent and safely matches safe buttons, inputs, links, and forms.
        """
        task_lower = request.task.lower().strip()
        elements = request.elements
        redacted_count = request.privacy_metadata.totalRedactions if request.privacy_metadata else 0

        # Safe candidates (non-redacted elements)
        interactive_elements = [
            el for el in elements 
            if not el.is_redacted and el.type in ["button", "link", "input", "select"]
        ]

        # ─── Strategy 1: Receipt / Bill Viewing Intent ─────────────────
        if any(w in task_lower for w in ["receipt", "bill", "invoice", "statement"]):
            target = self._find_best_match(interactive_elements, [
                "view receipt", "download receipt", "receipt", "view bill", 
                "bill status", "view statement", "details", "download"
            ])
            if target:
                return PlanResponse(
                    status="in_progress",
                    task=request.task,
                    thought=f"Identified safe action button '{target.text or target.label}' corresponding to task '{request.task}'. Protected {redacted_count} private fields.",
                    actions=[
                        ActionItem(
                            type=ActionType.CLICK,
                            target=ActionTarget(
                                selector=target.selector,
                                text=target.text,
                                tag=target.tag,
                                bbox=target.bbox
                            )
                        )
                    ]
                )

        # ─── Strategy 2: Search Intent ─────────────────────────────────
        search_match = re.search(r'(?:search|find|lookup)\s+(?:for\s+)?["\'"]?([^"\']+)["\'"]?', task_lower)
        if search_match:
            search_query = search_match.group(1).strip()
            # Find safe search input
            search_input = self._find_input(interactive_elements, ["search", "query", "find", "filter", "q"])
            if search_input and not search_input.is_redacted:
                return PlanResponse(
                    status="in_progress",
                    task=request.task,
                    thought=f"Located safe search field '{search_input.selector or search_input.label}'. Entering non-sensitive query '{search_query}' and pressing Enter to submit.",
                    actions=[
                        ActionItem(
                            type=ActionType.FOCUS,
                            target=ActionTarget(selector=search_input.selector, bbox=search_input.bbox)
                        ),
                        ActionItem(
                            type=ActionType.TYPE,
                            target=ActionTarget(selector=search_input.selector, bbox=search_input.bbox),
                            text=search_query,
                            clear=True
                        ),
                        ActionItem(
                            type=ActionType.PRESS_KEY,
                            target=ActionTarget(selector=search_input.selector, bbox=search_input.bbox),
                            key="Enter"
                        ),
                        ActionItem(type=ActionType.WAIT, duration=2000)
                    ]
                )

        # ─── Strategy 3: Status / Navigation Verification ──────────────
        if any(w in task_lower for w in ["status", "check", "verify"]):
            # Check if status text is already visible on screen
            for el in elements:
                text = (el.text or "").lower()
                if any(k in text for k in ["status: paid", "status: active", "status: success", "completed", "pending"]):
                    return PlanResponse(
                        status="complete",
                        task=request.task,
                        thought=f"Task target verified on page: '{el.text}'. Screen state successfully resolved without sensitive data leakage.",
                        actions=[]
                    )

            # Look for a Status tab or button
            status_btn = self._find_best_match(interactive_elements, ["status", "overview", "transactions", "dashboard"])
            if status_btn:
                return PlanResponse(
                    status="in_progress",
                    task=request.task,
                    thought=f"Navigating to status section via '{status_btn.text}'.",
                    actions=[
                        ActionItem(
                            type=ActionType.CLICK,
                            target=ActionTarget(selector=status_btn.selector, text=status_btn.text, bbox=status_btn.bbox)
                        )
                    ]
                )

        # ─── Strategy 4: General Button / Link Matching ────────────────
        task_words = [w for w in re.split(r'\W+', task_lower) if len(w) > 2 and w not in ["the", "and", "for", "with", "page"]]
        for word in task_words:
            match = self._find_best_match(interactive_elements, [word])
            if match:
                return PlanResponse(
                    status="in_progress",
                    task=request.task,
                    thought=f"Found matching safe element for term '{word}': '{match.text or match.label}'.",
                    actions=[
                        ActionItem(
                            type=ActionType.CLICK,
                            target=ActionTarget(selector=match.selector, text=match.text, bbox=match.bbox)
                        )
                    ]
                )

        # ─── Strategy 5: Content Scrolling (if elements below fold) ────
        viewport_h = request.page.viewport.height if request.page.viewport else 800
        elements_below_fold = [el for el in elements if el.bbox and el.bbox[1] > viewport_h - 100]
        if elements_below_fold:
            return PlanResponse(
                status="in_progress",
                task=request.task,
                thought="Target element not immediately in current viewport view. Scrolling page down to discover remaining UI controls.",
                actions=[
                    ActionItem(type=ActionType.SCROLL, direction="DOWN", amount=400),
                    ActionItem(type=ActionType.WAIT, duration=600)
                ]
            )

        # ─── Default: Task Complete / No further actions required ──────
        return PlanResponse(
            status="complete",
            task=request.task,
            thought="Evaluated all safe page elements. Task goal achieved or no further automated actions required.",
            actions=[]
        )

    # ═══════════════════════════════════════════════════════════════
    # Utility Methods
    # ═══════════════════════════════════════════════════════════════

    def _find_best_match(self, elements: List[ElementDescriptor], keywords: List[str]) -> Optional[ElementDescriptor]:
        for kw in keywords:
            kw_clean = kw.lower()
            for el in elements:
                t = (el.text or "").lower()
                l = (el.label or "").lower()
                a = (el.ariaLabel or "").lower()
                if kw_clean in t or kw_clean in l or kw_clean in a:
                    return el
        return None

    def _find_input(self, elements: List[ElementDescriptor], keywords: List[str]) -> Optional[ElementDescriptor]:
        for el in elements:
            if el.type in ["input", "textarea"]:
                combined = f"{el.placeholder or ''} {el.name or ''} {el.label or ''} {el.ariaLabel or ''}".lower()
                if any(kw in combined for kw in keywords):
                    return el
        return None

    def _summarize_elements(self, elements: List[ElementDescriptor], max_elements: int = 50) -> str:
        lines = []
        for i, el in enumerate(elements[:max_elements]):
            if el.is_redacted:
                lines.append(f"[{i}] PROTECTED {el.pii_category}: [REDACTED] (bbox={el.bbox})")
            else:
                tag_desc = f"<{el.tag}>"
                label = el.text or el.label or el.placeholder or ""
                if label:
                    label = f"\"{label[:40]}\""
                lines.append(f"[{i}] {el.type.upper()} {tag_desc} {label} selector={el.selector} bbox={el.bbox}")
        return "\n".join(lines)
