# SIH 2026 — SIH26171 Project Blueprint
## PRIVAGENT — Privacy-First On-Device Visual Perception for Lightweight Browser Agents

> **Purpose of this document:** Master planning document for the SIH26171 PPT, prototype, architecture, development, testing, demo, and final documentation.
>
> **Primary problem statement:** SIH26171 — *On-device Visual Perception for Light-weight Browser Agents*
>
> **Sponsoring organization:** Indian Space Research Organisation (ISRO), Department of Space
>
> **Theme / Domain:** Smart Automation
>
> **Development environment:** Google Antigravity
>
> **Status:** Planning / Prototype Development

---

# 1. Source of Truth — Official SIH26171 Requirements

The project must be designed around the following requirements in the supplied SIH 2026 catalogue. These requirements take priority over optional features proposed later in this document.

## 1.1 Core problem

Current agentic AI systems are often server-side. A server-based agent that needs visual screen context may require sensitive user information to leave the device. Local systems have fewer resources, so a complete vision + reasoning pipeline may not be practical locally.

SIH26171 asks teams to bridge these two environments:

- perform lightweight visual perception locally in the browser/device;
- identify sensitive/PII information locally;
- sanitize/redact it before any network request;
- transmit only anonymized/unidentifiable context where needed;
- use server/cloud reasoning for heavier processing;
- return actionable commands to the local browser agent;
- balance privacy, accuracy, latency, and client resource usage.

## 1.2 Explicit technical direction in the PS

The PS explicitly points to modern browser/client technologies such as:

- WebGPU
- WebAssembly
- ONNX Runtime Web
- Transformers.js

A local Vision Transformer (ViT) or equivalent computer-vision model is expected to evaluate screen state.

## 1.3 Required prototype pieces

### Client side

1. Browser extension / JavaScript client.
2. Local visual perception model.
3. Privacy-preserving filter.
4. Dynamic detection of sensitive/PII information.
5. Bounding-box redaction, masking, semantic obfuscation, or equivalent sanitization.
6. Sanitization must happen before the relevant network request.

### Server side

1. Receive anonymized/sanitized visual context.
2. Centralized LLM/VLM interprets the sanitized context.
3. Server returns processed information and/or actionable browser commands.
4. Local browser agent executes the returned action.
5. Demonstrate an end-to-end assisting task.

## 1.4 Official evaluation criteria from the supplied catalogue

| Metric | Weight | What we need to demonstrate |
|---|---:|---|
| Accuracy of visual context from screen | 25% | Local model correctly understands visual screen state |
| Recall and precision for sensitive/PII detection | 20% | Sensitive content is detected accurately |
| Precision of redaction | 20% | Redaction removes sensitive content without unnecessarily hiding useful context |
| Client-side resource utilization | 20% | Browser-side system remains lightweight in CPU/GPU/RAM use |
| Overall end-to-end latency of the provided task | 15% | Full task completes with acceptable latency |

**Total = 100%**

---

# 2. Our Product Concept

## Product name

**PRIVAGENT**

## Expanded name

**Privacy-First On-Device Visual Perception for Autonomous Browser Agents**

## One-line pitch

> **PRIVAGENT lets an AI agent operate a browser using local visual perception while preventing sensitive screen information from reaching the server.**

## Core idea

The system separates **seeing** from **reasoning**:

- **Local device:** sees the screen, detects private information, sanitizes it, enforces privacy rules.
- **Server:** receives only sanitized context, reasons over the safe context, and generates browser actions.
- **Browser:** executes validated actions.

This is a **hybrid edge + server architecture** rather than a fully cloud-based browser agent.

---

# 3. Problem We Are Solving

A browser agent can be useful for repetitive workflows such as:

- finding information on websites;
- navigating dashboards;
- reading a form and moving to the next step;
- searching a portal;
- clicking the correct UI element;
- scrolling through pages;
- assisting with structured web workflows.

However, screen context can contain information that should not be sent to an AI server.

Examples of potentially sensitive information:

- passwords;
- OTPs;
- email addresses;
- phone numbers;
- bank/account numbers;
- payment information;
- government/document identifiers;
- faces;
- names;
- addresses;
- private text fields;
- confidential enterprise information.

The central problem becomes:

> **How can an AI browser agent understand enough of a webpage to act correctly without exposing the user's sensitive visual information to the server?**

---

# 4. Proposed Solution

PRIVAGENT creates a local privacy boundary between the browser and the AI server.

## High-level pipeline

```text
User Instruction
      |
      v
Browser Agent
      |
      v
Current Page / Screen State
      |
      +------------------------------+
      |                              |
      v                              v
DOM/Accessibility Context       Local Visual Perception
      |                              |
      +---------------+--------------+
                      |
                      v
             Local PII Detection
                      |
                      v
             Privacy Policy Engine
                      |
              +-------+-------+
              |               |
          Sensitive         Safe
              |               |
              v               |
        Redaction/Masking     |
              |               |
              +-------+-------+
                      |
                      v
              Sanitized Context
                      |
              NETWORK BOUNDARY
                      |
                      v
               Server LLM/VLM
                      |
                      v
              Structured Action
                      |
                      v
             Local Action Validator
                      |
                      v
             Browser Action Executor
                      |
                      v
                 New State
```

---

# 5. Main Design Principle: Privacy Before Network

This is the key technical story of the project.

## Rule

> **No relevant visual context is sent to the server until local sanitization has completed.**

## The browser should maintain two representations

### Human View

The original page as the user sees it.

### AI Server View

A sanitized representation in which protected information is:

- removed;
- masked;
- blurred;
- replaced with semantic placeholders;
- or otherwise made unidentifiable.

Example:

```text
HUMAN VIEW
--------------------------------
Name: Atharav Tayade
Email: atharav@example.com
Account: 1234567890
Electricity Bill: PAID
[Pay Now]
--------------------------------

                    |
                    | Local AI
                    v

SANITIZED SERVER VIEW
--------------------------------
Name: [NAME_REDACTED]
Email: [EMAIL_REDACTED]
Account: [ACCOUNT_REDACTED]
Electricity Bill: PAID
[Pay Now]
--------------------------------
```

The server retains task-relevant information while protected fields are transformed according to policy.

---

# 6. Architecture — Detailed Modules

## Module A — Browser Extension

Responsibilities:

- capture current tab/page state;
- read allowed DOM metadata;
- receive user task/instruction;
- orchestrate local pipeline;
- apply redaction;
- communicate with server;
- execute approved browser actions;
- display privacy status and audit information.

Target browsers:

- Chrome first;
- Firefox compatibility as a secondary target.

Implementation direction:

- WebExtensions / Manifest V3-style architecture where applicable;
- content script;
- background/service worker;
- extension UI/popup or side panel;
- local inference worker.

---

## Module B — Screen / Visual Context Collector

Two complementary context sources should be used.

### 1. DOM-first context

Extract useful structural context when available:

- visible text;
- button labels;
- input type;
- input labels/placeholders;
- links;
- ARIA/accessibility labels;
- element coordinates/bounding boxes;
- role/state information.

DOM information is efficient and often cheaper than full-image reasoning.

### 2. Visual context

Capture the visible visual state when the browser agent needs information that is not reliably available from DOM metadata.

Examples:

- rendered UI state;
- icons;
- images;
- canvas content;
- visually displayed sensitive information;
- custom components;
- layout relationships.

The final system should fuse DOM + visual evidence instead of relying exclusively on screenshots.

---

# 7. Local Vision System

## Objective

Run lightweight computer vision locally inside the browser/device to identify objects, sensitive regions, and useful screen context.

## Proposed strategy

Use a **small browser-compatible vision model** exported to ONNX or another supported browser runtime.

Candidate model families to benchmark:

- lightweight YOLO-family detector;
- lightweight DETR/transformer-style detector;
- lightweight OCR pipeline;
- face detector;
- other browser-compatible open-source vision models.

The final model must be selected using measured:

- accuracy;
- inference latency;
- memory usage;
- browser compatibility.

Do not lock the final model before benchmarking.

## Inference runtime

Primary implementation direction:

- ONNX Runtime Web;
- WebGPU acceleration when available;
- WebAssembly fallback when WebGPU is unavailable;
- inference inside a Web Worker where practical so the UI remains responsive.

---

# 8. Sensitive / PII Detection Engine

The privacy engine should be **multi-layered** rather than relying on one detector.

## Layer 1 — DOM-aware detection

Detect privacy-sensitive HTML elements before screenshot transmission.

Examples:

```text
<input type="password">
<input autocomplete="cc-number">
<input autocomplete="one-time-code">
<input type="email">
<input type="tel">
```

Also inspect:

- field labels;
- aria-labels;
- placeholder text;
- semantic tags;
- application-specific privacy attributes.

## Layer 2 — Text / OCR detection

Use local OCR for text visible in screenshots when DOM access is insufficient.

Classify likely sensitive strings using local pattern/rule engines.

Examples:

- email pattern;
- phone-number pattern;
- account-number-like patterns;
- OTP-like short numeric fields;
- payment-card-like patterns;
- identity-document-like patterns;
- addresses/names when configured by privacy policy.

## Layer 3 — Visual detection

Detect privacy-sensitive objects such as:

- faces;
- ID/document regions;
- QR/barcode regions when policy requires masking;
- other sensitive visual elements.

## Layer 4 — Contextual privacy policy

The policy engine combines:

```text
DOM signal
+ OCR signal
+ visual detector signal
+ page context
+ user privacy policy
= privacy decision
```

This reduces dependence on a single model.

---

# 9. Privacy Policy Engine

PRIVAGENT should expose a configurable privacy policy.

## Example policy categories

```yaml
privacy_policy:
  password: REDACT
  otp: REDACT
  email: REDACT
  phone: REDACT
  account_number: REDACT
  payment_data: REDACT
  face: BLUR
  government_id: REDACT
  confidential_text: REDACT
```

## Policy modes

### Strict Mode

Hide all configured sensitive categories.

### Balanced Mode

Preserve task-relevant semantics while removing sensitive values.

Example:

```text
"Electricity bill status: Paid"
```

can remain visible while:

```text
"Consumer ID: 239482993"
```

is replaced with:

```text
"Consumer ID: [REDACTED]"
```

### User-defined Mode

Allow users/organizations to select what categories must never leave the device.

---

# 10. Redaction Engine

Redaction should occur locally.

## Supported mechanisms

1. Black-box masking.
2. Gaussian/visual blur for faces.
3. Pixelation.
4. Placeholder replacement.
5. Semantic obfuscation.
6. DOM text replacement where appropriate.

## Important design goal

Redaction should be **precise**, not simply aggressive.

Over-redaction can remove the information required by the browser agent.

Under-redaction can expose private information.

This trade-off directly relates to the SIH redaction-precision evaluation criterion.

---

# 11. Sanitized Representation

The system should support both:

## Sanitized image

A visual image with protected areas masked/blurred.

## Sanitized structured context

A JSON representation describing safe UI elements.

Example:

```json
{
  "page_title": "Electricity Bill Portal",
  "elements": [
    {
      "type": "text",
      "content": "Electricity Bill Status: Paid",
      "bbox": [120, 260, 520, 310]
    },
    {
      "type": "input",
      "label": "Consumer ID",
      "value": "[REDACTED]",
      "bbox": [120, 180, 430, 220]
    },
    {
      "type": "button",
      "text": "View Receipt",
      "bbox": [450, 320, 590, 370]
    }
  ]
}
```

The server should reason over the sanitized representation and never require the original sensitive values for ordinary navigation tasks.

---

# 12. Network Privacy Guard

This is a critical prototype component.

## Objective

Prove that sanitization occurs **before the network request**.

## Implementation idea

Maintain a client-side pipeline state:

```text
RAW_CONTEXT_CREATED
        |
        v
PII_SCAN_COMPLETE
        |
        v
REDACTION_COMPLETE
        |
        v
SANITIZED_CONTEXT_READY
        |
        v
NETWORK_REQUEST_ALLOWED
```

The system should refuse transmission if sanitization has not completed.

## Visible demo

Display:

```text
Privacy Firewall: ACTIVE
Raw screen: LOCAL ONLY
PII scan: COMPLETE
Redactions: 7
Sanitized context: READY
Network request: ALLOWED
```

This makes the privacy boundary easy to verify during judging.

---

# 13. Server-Side AI Reasoning Layer

## Role of server

The server does the expensive reasoning that the local device does not need to perform.

It receives:

- user instruction;
- sanitized screenshot/context;
- safe DOM structure;
- safe element coordinates;
- privacy metadata needed to interpret placeholders.

It returns a structured action plan.

## Model direction

Use an open-weight/offline-deployable LLM/VLM for the final architecture, consistent with the PS allowance.

Potential development choices can include:

- a small open-weight VLM;
- a text LLM combined with structured visual context;
- a local server model via Ollama or another inference server;
- a cloud-hosted development endpoint during early prototyping, then an offline-capable deployment for final demonstration.

**Final model selection must be benchmark-driven.**

---

# 14. Action Protocol

Never allow arbitrary model-generated JavaScript to execute directly.

The server should return a constrained action schema.

Example:

```json
{
  "task": "check bill status",
  "actions": [
    {
      "type": "CLICK",
      "target": {
        "text": "View Receipt",
        "bbox": [450, 320, 590, 370]
      }
    },
    {
      "type": "SCROLL",
      "direction": "DOWN",
      "amount": 520
    }
  ]
}
```

The client validates actions against the current page before execution.

Supported initial action types:

- CLICK
- SCROLL
- NAVIGATE
- FOCUS
- TYPE into an explicitly approved non-sensitive field
- SELECT
- WAIT

Do **not** allow the model to type into password/OTP/payment fields by default.

---

# 15. Action Safety Layer

A second local policy check should happen before executing an action.

Example:

```text
Server says: TYPE "123456"
          |
          v
Local action validator
          |
          +--> Password field? YES
          |
          v
      BLOCK ACTION
```

This creates a second security boundary:

> **The server decides what may be useful; the local client decides what is permitted.**

---

# 16. Agent Loop

The system should operate as a closed perception-action loop.

```text
1. User gives task
2. Browser state captured
3. Local DOM + vision processing
4. Sensitive data detected
5. Local redaction
6. Sanitized context created
7. Context sent to server
8. Server reasons
9. Server returns structured action
10. Client validates action
11. Browser executes action
12. New browser state observed
13. Repeat until task is complete
```

This makes the prototype a real **browser agent**, not just a privacy-filter demo.

---

# 17. Recommended Signature Demo

The main demo should be simple enough to understand within seconds but technically rich enough to show the complete architecture.

## Demo Scenario A — Private Dashboard Navigation

User instruction:

> "Open the dashboard and find the latest transaction status."

The page contains:

- name;
- email;
- account number;
- balance;
- transaction status;
- buttons/links.

The local AI:

1. identifies sensitive fields;
2. redacts them;
3. preserves the transaction-status text and action buttons;
4. sends only sanitized context;
5. server model chooses the relevant action;
6. browser executes it.

## Demo Scenario B — Form Navigation

User instruction:

> "Fill the non-sensitive address section and continue."

The agent must:

- understand the form locally;
- recognize protected inputs;
- avoid exposing or typing sensitive fields;
- execute safe navigation actions.

## Demo Scenario C — Face Privacy

A webpage contains profile photos/faces.

The local visual module detects faces and applies blur before visual context is sent.

## Demo Scenario D — Mixed DOM + Visual Content

Use a modern web dashboard where some information exists in DOM structure and some is rendered visually.

This demonstrates why the system needs both structured DOM context and visual perception.

---

# 18. Core UI for the Prototype

The prototype should not look like a generic chatbot. It should communicate the architecture visually.

## Main layout

```text
+------------------------------------------------------------+
| PRIVAGENT                               🔒 Protected       |
+------------------------------------------------------------+
|                                                            |
|  USER TASK                                                 |
|  [ Check the bill status and open the receipt ]            |
|                                                            |
+-----------------------+------------------------------------+
| HUMAN VIEW            | AI SERVER VIEW                     |
|                       |                                    |
| Original page         | Sanitized page                    |
|                       |                                    |
+-----------------------+------------------------------------+
| Privacy Firewall                                           |
| PII detected: 5       Redactions: 5       Network: SAFE   |
+------------------------------------------------------------+
| Agent Actions                                             |
| ✓ Open portal                                             |
| ✓ Detect bill status                                      |
| ✓ Click View Receipt                                      |
+------------------------------------------------------------+
| Performance                                               |
| Local inference: 118 ms   RAM: xx MB   FPS: xx            |
+------------------------------------------------------------+
```

---

# 19. Privacy Dashboard

Include a dedicated panel showing:

- privacy status;
- number of detected sensitive regions;
- categories detected;
- redaction count;
- sanitized/not-sanitized status;
- outgoing payload summary;
- local inference latency;
- server latency;
- total latency;
- browser CPU/RAM utilization.

## Example

```text
PRIVACY FIREWALL
------------------------------
Status: PROTECTED

Detected:
  Faces              2
  Emails             1
  Password fields    1
  Phone numbers      1

Redacted: 5
Raw visual data sent: NO
Sanitized context sent: YES
```

---

# 20. Human View vs AI View

This should be one of the strongest visual elements of the final demo.

### Left: Human View

Original webpage.

### Right: AI Server View

The exact information representation sent to the server.

Use a synchronized highlight system:

- red = protected region;
- neutral = safe context;
- dashed border = transformed region.

When a judge hovers/clicks a redacted region, show why it was protected.

Example:

```text
Reason: PASSWORD FIELD
Source: DOM + visual confirmation
Action: BLACKOUT
Network status: NEVER TRANSMITTED
```

---

# 21. Evidence and Audit Log

The agent should record observable execution information.

Example:

```text
[10:31:20.104] Task received
[10:31:20.182] DOM context collected
[10:31:20.301] Local vision inference complete
[10:31:20.317] 5 sensitive regions detected
[10:31:20.330] Redaction completed
[10:31:20.332] Privacy gate passed
[10:31:20.335] Sanitized context sent
[10:31:20.811] Server response received
[10:31:20.823] CLICK action validated
[10:31:20.830] Browser action executed
```

Do not expose private internal reasoning or chain-of-thought. The audit trail should contain observable execution steps, decisions, model/tool names, timings, and safe metadata.

---

# 22. Evaluation Strategy

The evaluation plan should mirror the five official metrics.

## 22.1 Visual-context accuracy — 25%

Measure whether the local system identifies the correct useful screen elements.

Test set examples:

- buttons;
- input fields;
- labels;
- navigation elements;
- visually rendered text;
- icons/images where relevant.

Potential measurements:

- element detection precision/recall;
- text extraction accuracy;
- action-target localization accuracy;
- task success rate.

## 22.2 PII detection precision/recall — 20%

Create a benchmark containing synthetic pages/screenshots with annotated sensitive regions.

Track:

```text
TP = sensitive data correctly detected
FP = safe content incorrectly flagged
FN = sensitive data missed
TN = safe content left safe
```

Metrics:

```text
Precision = TP / (TP + FP)
Recall    = TP / (TP + FN)
F1        = 2 * Precision * Recall / (Precision + Recall)
```

Report category-wise results where possible.

## 22.3 Redaction precision — 20%

Measure:

- how much of sensitive content was successfully removed;
- how much safe information was unnecessarily hidden;
- whether redaction covers the full target region;
- whether neighboring task-relevant content remains readable.

Use annotated ground-truth boxes and IoU where appropriate.

## 22.4 Client-side resource utilization — 20%

Record:

- browser CPU usage;
- GPU/WebGPU utilization where available;
- RAM/memory footprint;
- model size;
- inference time;
- sustained performance over multiple pages.

Run identical test scenarios on the same machine.

## 22.5 End-to-end latency — 15%

Break latency into:

```text
Capture
+ DOM extraction
+ Vision inference
+ PII detection
+ Redaction
+ Serialization
+ Network
+ Server reasoning
+ Action validation
+ Browser execution
```

Measure:

- p50;
- p90;
- p95 if enough trials are available;
- task completion time.

---

# 23. Benchmark Dataset Plan

The project needs a controlled benchmark because the final SIH judging dataset will not be available to us beforehand.

## Build a synthetic privacy benchmark

Generate browser pages containing combinations of:

- names;
- emails;
- phone numbers;
- passwords;
- OTPs;
- account numbers;
- document numbers;
- faces;
- safe text;
- buttons;
- tables;
- dashboards;
- forms.

Store ground truth in a machine-readable format.

Example:

```json
{
  "image": "page_001.png",
  "annotations": [
    {
      "category": "EMAIL",
      "bbox": [120, 180, 380, 214]
    },
    {
      "category": "PASSWORD",
      "bbox": [120, 230, 380, 270]
    },
    {
      "category": "FACE",
      "bbox": [600, 90, 680, 170]
    }
  ]
}
```

Use synthetic data for controlled repeatability and optional manually annotated real webpages for broader testing.

---

# 24. Failure Cases We Must Test

A serious prototype must test when detection fails.

Examples:

- password drawn in a canvas;
- PII inside an image;
- PII partially occluded;
- unusual fonts;
- small text;
- dark mode;
- multilingual text;
- dynamically loaded elements;
- scrolling pages;
- popups/modals;
- cross-origin content;
- multiple faces;
- pages with no DOM semantics;
- pages with very dense information;
- WebGPU unavailable;
- local model unavailable;
- network unavailable;
- server returns invalid action.

The system should fail safely: when uncertain about sensitive content, prefer blocking transmission or requiring user confirmation rather than silently exposing data.

---

# 25. Security Design

Security principles:

## Local-first privacy

Sensitive content is detected and transformed locally.

## Least data transmission

Send only what the server needs for the requested task.

## Explicit privacy policy

Do not depend entirely on the model's judgment.

## Safe action schema

Never execute arbitrary code generated by the server model.

## Local action validation

Re-check the current page before every sensitive action.

## Fail-closed privacy gate

When sanitization status is unknown or processing fails, block visual transmission.

## Auditability

Record safe, observable events for debugging and judging.

---

# 26. Data Classification Model

Use a simple policy hierarchy.

```text
LEVEL 0 — PUBLIC
Safe to transmit if task requires it.

LEVEL 1 — CONTEXTUAL
Task-relevant but not inherently sensitive.

LEVEL 2 — PERSONAL
Name, email, phone, address, etc.

LEVEL 3 — HIGHLY SENSITIVE
Password, OTP, payment details, government IDs, confidential documents.

LEVEL 4 — NEVER TRANSMIT
Anything explicitly blocked by user/organization policy.
```

The UI should clearly show which level caused a redaction.

---

# 27. Technical Stack — Proposed

## Frontend / Extension

- HTML
- CSS
- JavaScript / TypeScript
- WebExtensions APIs
- Chrome extension architecture
- Firefox compatibility layer

## Local AI

- ONNX Runtime Web
- WebGPU
- WebAssembly fallback
- lightweight local vision model
- OCR component
- face/object detection component

## Server

- Python
- FastAPI
- structured JSON APIs
- open-weight LLM/VLM
- optional Ollama-based model serving during development

## Data

- JSON annotation files
- synthetic browser-page benchmark
- local telemetry/metrics

## Development

- Google Antigravity
- Git
- GitHub
- browser developer tools

## Optional observability

- local benchmark scripts
- browser performance APIs
- server timing instrumentation

---

# 28. Suggested Repository Structure

```text
privagent/
│
├── extension/
│   ├── manifest.json
│   ├── background/
│   ├── content/
│   ├── popup/
│   ├── sidepanel/
│   ├── privacy/
│   ├── vision/
│   ├── actions/
│   └── assets/
│
├── server/
│   ├── app.py
│   ├── routes/
│   ├── agents/
│   ├── models/
│   ├── schemas/
│   └── services/
│
├── models/
│   ├── local_vision/
│   ├── ocr/
│   └── face_detector/
│
├── benchmark/
│   ├── images/
│   ├── annotations/
│   ├── generate_dataset.py
│   ├── evaluate_privacy.py
│   ├── evaluate_redaction.py
│   └── evaluate_latency.py
│
├── shared/
│   ├── schemas/
│   └── constants/
│
├── docs/
│   ├── architecture.md
│   ├── evaluation.md
│   └── demo.md
│
├── tests/
│
├── README.md
└── docker-compose.yml
```

---

# 29. API Design

## POST /agent/plan

Input:

```json
{
  "task": "Find the bill status",
  "page": {
    "title": "Electricity Portal",
    "elements": []
  },
  "sanitized_image": "base64-or-upload-reference",
  "privacy_metadata": {
    "redactions": 4
  }
}
```

Output:

```json
{
  "status": "ok",
  "actions": [
    {
      "type": "CLICK",
      "target_text": "Bill Status"
    }
  ]
}
```

## POST /privacy/validate

Used during development/testing to inspect the client-side sanitization result.

## GET /health

Server health endpoint.

## GET /metrics

Optional benchmark/performance endpoint for local development.

---

# 30. Antigravity Development Strategy

Use Google Antigravity as the primary coding/build environment.

Do not ask the coding agent to generate the entire project blindly in one pass.

Build in controlled stages.

## Stage 1 — Repository bootstrap

Create:

- extension;
- server;
- shared schema;
- basic README;
- development scripts.

## Stage 2 — Browser capture

Implement:

- screenshot/context capture;
- DOM extraction;
- visible element bounding boxes.

Validate this independently.

## Stage 3 — Local vision

Add browser-compatible local model inference.

Measure:

- model loading time;
- inference time;
- memory;
- accuracy.

## Stage 4 — PII detection

Implement DOM rules first, then OCR and visual detection.

## Stage 5 — Redaction

Build the redaction engine and the Human View / AI View interface.

## Stage 6 — Privacy gate

Block network transmission until sanitization is complete.

## Stage 7 — Server reasoning

Implement structured action generation.

## Stage 8 — Action validation

Validate server actions locally before browser execution.

## Stage 9 — Closed-loop agent

Capture -> sanitize -> reason -> act -> observe -> repeat.

## Stage 10 — Benchmarking

Automate the official five evaluation dimensions.

## Stage 11 — UI polish

Add:

- privacy dashboard;
- audit timeline;
- metrics;
- AI View;
- network status.

## Stage 12 — SIH demo hardening

Run everything from a clean machine/environment and prepare an offline fallback.

---

# 31. Prototype Definition of Done

The MVP should be considered functional only when all of these work:

- [ ] Browser extension loads successfully.
- [ ] User can enter a task.
- [ ] Current page can be inspected.
- [ ] Local vision model runs in the browser.
- [ ] DOM context is collected.
- [ ] Sensitive data is detected locally.
- [ ] Sensitive visual regions are redacted locally.
- [ ] Sanitized context is visibly different from the raw page.
- [ ] Raw context is blocked from network transmission.
- [ ] Sanitized context reaches the server.
- [ ] Server model understands the sanitized context.
- [ ] Server returns structured actions.
- [ ] Client validates actions.
- [ ] Browser executes safe actions.
- [ ] Multi-step agent loop works.
- [ ] Privacy audit log is visible.
- [ ] Performance metrics are captured.
- [ ] Benchmark results are reproducible.

---

# 32. Advanced Features After MVP

Only build these after the core SIH requirements are stable.

## Privacy Heatmap

Show sensitivity as a heatmap over the page.

## Privacy Risk Score

Example:

```text
Privacy Exposure Risk: 8/100
```

This should be a clearly defined engineering metric, not an arbitrary claim.

## Context Minimization

Instead of sending a full screenshot, send only the minimal visual regions needed for the task.

## Adaptive Perception

Use cheap DOM analysis first and trigger expensive vision inference only when needed.

## Intelligent Redaction

Replace sensitive values with semantic placeholders instead of completely removing context.

## Privacy Budget

Track the amount/type of private information that the agent is allowed to process or transmit under policy.

## Offline Mode

If server connectivity is unavailable:

- continue local perception where possible;
- queue non-sensitive tasks;
- never bypass the privacy firewall.

---

# 33. Novelty / Differentiation

The solution should not be presented as simply:

> "A browser agent + a blur filter."

Our conceptual differentiation is:

### 1. Privacy Firewall

A mandatory client-side gate between perception and network transmission.

### 2. Dual Context Engine

DOM structure + local visual perception.

### 3. Semantic Privacy Transformation

Protect values while retaining task-relevant meaning.

### 4. Local Action Security

The browser—not the remote model—owns final action permission.

### 5. Human View vs AI View

The judge can see exactly what the user sees and what the server is allowed to see.

### 6. Measurable Privacy/Performance Trade-off

Every design decision is tied to the five official evaluation dimensions.

### 7. Closed-loop Browser Agent

The system actually perceives, reasons, acts, observes again, and continues.

---

# 34. What We Should NOT Do

Avoid these weak approaches:

- sending the raw screenshot to the cloud first and masking later;
- claiming privacy without proving the network boundary;
- using only regex for all visual PII;
- using a huge server model while ignoring client performance;
- hard-coding one webpage instead of building reusable browser components;
- generating arbitrary JavaScript from the LLM and executing it blindly;
- redacting the entire screen, which would destroy useful context;
- calling a generic chatbot a browser agent without actual browser action execution;
- presenting invented benchmark numbers;
- claiming 100% privacy or 100% detection without evidence.

---

# 35. PPT Formation Plan

The supplied SIH catalogue notes expected deliverables such as an interactive prototype/source, documentation, demo material, and technical presentation. The exact presentation limit/format should be taken from the submission portal or current official instructions when finalized.

The PPT should focus on the problem, architecture, innovation, implementation, and measured validation.

## Slide 1 — Problem Statement

**Title:** SIH26171 — On-device Visual Perception for Light-weight Browser Agents

Include:

- sponsor: ISRO;
- theme: Smart Automation;
- current server-side browser agents expose a visual-context privacy problem;
- local systems have resource limitations;
- target: hybrid local perception + server reasoning.

Visual:

```text
Browser Screen -> Cloud AI
       |
       +--> sensitive information exposure
```

## Slide 2 — Proposed Solution

Title:

**PRIVAGENT — Privacy Before Network**

Show the full architecture:

```text
Browser
  -> Local Vision
  -> PII Detection
  -> Privacy Firewall
  -> Sanitized Context
  -> Server LLM/VLM
  -> Action
  -> Browser
```

Highlight local processing boundary.

## Slide 3 — Technical Innovation

Focus on:

- local browser vision;
- DOM + visual fusion;
- dynamic PII detection;
- precise redaction;
- semantic obfuscation;
- safe action protocol;
- local action validator;
- fail-closed privacy gate;
- human-vs-AI view;
- audit trail.

## Slide 4 — Implementation / Technology

Show stack:

```text
Chrome / Firefox Extension
        |
TypeScript / Web APIs
        |
ONNX Runtime Web
        |
WebGPU / WebAssembly
        |
Local Vision + OCR + Privacy Engine
        |
FastAPI
        |
Open-weight LLM/VLM
```

Also include benchmark/evaluation pipeline.

## Slide 5 — Validation / Demo / Impact

Include measured results only after testing:

- visual-context accuracy;
- PII precision/recall;
- redaction precision;
- client resource usage;
- end-to-end latency.

Add screenshots of:

- Human View;
- AI Server View;
- Privacy Dashboard;
- Agent Action Log.

End with the central message:

> **The agent can act without needing the user's private screen data.**

---

# 36. PPT Design Guidelines

Keep the PPT technical and visual.

Use diagrams instead of paragraphs.

Suggested visual language:

- local/device boundary;
- network boundary;
- protected data;
- sanitized data;
- AI reasoning;
- browser actions.

Do not overload slides with implementation details that belong in the architecture document.

---

# 37. 90-Second Demo Script

## 0–10 sec

Show the problem page containing visible personal/sensitive information.

Voiceover:

> "A browser agent needs visual context to operate, but that context can contain private user information."

## 10–25 sec

Enter a task.

```text
Check the bill status and open the receipt.
```

## 25–40 sec

Show local detection.

```text
Password detected
Email detected
Account number detected
Face detected
```

## 40–50 sec

Show Human View vs AI View.

```text
Raw: LOCAL ONLY
Server: SANITIZED VIEW
```

## 50–70 sec

Show server reasoning and structured action.

```text
CLICK -> Bill Status
SCROLL -> DOWN
CLICK -> View Receipt
```

## 70–82 sec

Show browser executing the task.

## 82–90 sec

Show metrics:

```text
PII Precision: XX%
PII Recall: XX%
Redaction Precision: XX%
Local Latency: XX ms
E2E Latency: XX ms
```

Only use actual measured values.

---

# 38. Presentation Talking Points

## What is the main innovation?

The system creates a local privacy boundary where visual understanding and sensitive-data sanitization happen before network transmission.

## Why is on-device processing necessary?

Because visual browser context can contain information that users may not want to transmit to a server.

## Why not run the whole AI locally?

The PS explicitly identifies a practical resource trade-off: local systems have fewer resources, while server-side models can provide heavier reasoning. Our architecture uses each side for what it does best.

## Why use DOM + vision?

DOM context is efficient and precise for structured webpages, while visual perception is needed for content that DOM extraction cannot fully represent.

## How is privacy enforced?

Privacy is enforced by a local detection/redaction gate that must complete before the network request is allowed.

## How do we stop the server from performing unsafe actions?

The client validates returned structured actions and can block actions that violate local policy.

## How do we measure success?

We align the benchmark with the five evaluation metrics specified by SIH26171.

---

# 39. Development Milestones

## Milestone 1 — Architecture skeleton

Deliver:

- repository;
- extension;
- server;
- shared action schemas;
- basic UI.

## Milestone 2 — Perception

Deliver:

- DOM extraction;
- screenshot capture;
- local vision inference.

## Milestone 3 — Privacy

Deliver:

- PII detector;
- face detector;
- OCR;
- policy engine;
- redaction.

## Milestone 4 — Network privacy

Deliver:

- privacy gate;
- sanitized payload;
- transmission logging.

## Milestone 5 — Browser agent

Deliver:

- server reasoning;
- action protocol;
- action validator;
- browser execution.

## Milestone 6 — Evaluation

Deliver:

- test dataset;
- metric scripts;
- benchmark dashboard.

## Milestone 7 — SIH polish

Deliver:

- stable UI;
- final architecture diagram;
- screenshots;
- PPT;
- demo video;
- README;
- final source package.

---

# 40. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Local vision model too slow | High | Benchmark small models; WebGPU; worker-based inference |
| PII missed by vision model | Critical | DOM + OCR + visual + rules + fail-closed policy |
| Over-redaction | High | Tune detection thresholds; preserve semantic placeholders |
| Dynamic webpages | High | Re-capture after DOM changes and actions |
| Cross-browser differences | Medium | Build/test Chrome first; then WebExtensions compatibility |
| Server model gives bad action | High | Constrained schema + local action validator |
| Network unavailable | Medium | Offline/local fallback for perception; never bypass privacy gate |
| Demo instability | Critical | Fixed demo sites + preloaded models + offline fallback |
| Memory/CPU pressure | High | Model quantization/compression, worker isolation, adaptive inference |
| False privacy claim | Critical | Publish measured results and limitations instead of absolute claims |

---

# 41. Final SIH Project Story

The project should be presented as a **hybrid privacy-preserving browser intelligence system**.

The narrative is:

```text
AI agents need to see.
        |
        v
Screens contain private information.
        |
        v
Sending everything to the cloud is undesirable.
        |
        v
Run lightweight perception locally.
        |
        v
Detect and remove sensitive information locally.
        |
        v
Send only the minimum sanitized context.
        |
        v
Use server AI for heavier reasoning.
        |
        v
Return safe structured actions.
        |
        v
Execute locally in the browser.
```

---

# 42. One-Sentence Technical Definition

> **PRIVAGENT is a browser-based hybrid agent architecture that performs lightweight on-device visual perception and privacy filtering, transmits only sanitized visual/structural context to an open-weight server-side reasoning model, and executes validated browser actions locally.**

---

# 43. Final Prototype Success Criteria

The prototype is ready for SIH demonstration when it can visibly prove all of the following in one continuous workflow:

```text
[1] User gives a browser task
        ↓
[2] Browser page contains real/synthetic PII
        ↓
[3] Local model reads screen
        ↓
[4] PII detected locally
        ↓
[5] Sensitive regions redacted locally
        ↓
[6] Raw context blocked
        ↓
[7] Sanitized context sent
        ↓
[8] Server model reasons
        ↓
[9] Structured action returned
        ↓
[10] Local validator approves action
        ↓
[11] Browser executes action
        ↓
[12] Metrics + audit trail displayed
```

That single workflow should become the foundation for the prototype, PPT, demo video, README, and technical explanation.

---

# 44. Reference Source

Primary source used for this blueprint:

**SIH_2026_All_226_Problem_Statements_Master_Catalogue.pdf**

SIH26171 appears in the supplied catalogue on the pages containing the problem statement and evaluation criteria (PDF pages around 188–189 in the supplied document).

For final submission, verify any submission-specific presentation limits, deliverable formats, and portal instructions against the latest official SIH instructions before finalizing the PPT.

---

# 45. Immediate Build Order

Start development in this exact order:

1. Browser extension shell
2. Screen + DOM capture
3. Local vision inference
4. PII detection engine
5. Redaction engine
6. Privacy Firewall / network gate
7. Sanitized-context API
8. Server-side VLM/LLM reasoning
9. Structured action protocol
10. Local action validator
11. Browser action executor
12. Human View vs AI View
13. Audit log
14. Benchmark dataset
15. Five-metric evaluation dashboard
16. Final UI polish
17. PPT
18. Demo video
19. Final documentation

**Do not optimize the visuals before the privacy boundary and end-to-end task loop are working.**
