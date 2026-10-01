/**
 * PRIVAGENT — Background Service Worker
 * 
 * Manifest V3 service worker running in the extension's background context.
 * This is the orchestration hub of the entire PRIVAGENT pipeline.
 * 
 * Responsibilities:
 *   1. Orchestrate the agent loop: capture → detect → redact → sanitize → send → validate → execute.
 *   2. Enforce the Privacy Gate: block ALL network requests to the reasoning
 *      server until sanitization is provably complete.
 *   3. Manage pipeline state machine (Section 12 of blueprint).
 *   4. Capture tab screenshots via chrome.tabs API.
 *   5. Communicate with content script for DOM extraction and action execution.
 *   6. Communicate with the server-side LLM/VLM for reasoning (POST /agent/plan).
 *   7. Validate server-returned actions before forwarding to the content script.
 *   8. Maintain the audit log for the privacy dashboard.
 *   9. Expose pipeline status to popup / side-panel UI.
 * 
 * The service worker NEVER exposes raw (unsanitized) context to the network.
 */

import {
  MSG,
  PIPELINE_STATE,
  PIPELINE_ORDER,
  PRIVACY_LEVEL,
  PII_CATEGORY,
  CATEGORY_LEVEL,
  REDACTION_MODE,
  CATEGORY_REDACTION,
  ACTION_TYPE,
  BLOCKED_INPUT_TYPES,
  POLICY_MODE,
  SERVER,
  DOM_LIMITS,
} from '../shared/constants.js';


// ═══════════════════════════════════════════════════════════════════════════════
// Global State
// ═══════════════════════════════════════════════════════════════════════════════

/** Current pipeline state — strictly ordered, never skipped */
let pipelineState = PIPELINE_STATE.IDLE;

/** Current user task / instruction */
let currentTask = null;

/** Tab ID of the active target tab */
let activeTabId = null;

/** The latest raw DOM context from the content script */
let rawDomContext = null;

/** The latest PII scan result (Layer 1 + patterns) */
let piiScanResult = null;

/** The sanitized context ready for transmission */
let sanitizedContext = null;

/** The latest server action plan */
let serverActionPlan = null;

/** Privacy policy mode */
let policyMode = POLICY_MODE.BALANCED;

/** Custom per-category overrides (for USER_DEFINED mode) */
let categoryOverrides = {};

/** Ordered audit log */
const auditLog = [];

/** Maximum audit log entries to retain in memory */
const MAX_AUDIT_ENTRIES = 500;

/** Agent loop iteration count (for the current task) */
let loopIteration = 0;

/** Maximum agent loop iterations before auto-stop */
const MAX_LOOP_ITERATIONS = 20;

/** Client-only Raw screenshot (device-held, never sent across network) */
let rawScreenshotUrl = null;

/** Sanitized visual screenshot with bboxes masked/blurred */
let sanitizedScreenshotUrl = null;

/** Flag to interrupt running agent loop on user demand */
let isTaskAborted = false;


// ═══════════════════════════════════════════════════════════════════════════════
// Audit Log
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Append an entry to the audit log.
 * The audit log records every observable pipeline event with timestamps
 * and safe metadata (Section 21 of blueprint).
 */
function audit(event, detail = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    pipelineState,
    iteration: loopIteration,
    ...detail,
  };
  auditLog.push(entry);

  // Evict oldest entries if over capacity
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }

  console.log(`[PRIVAGENT] ${entry.timestamp} | ${event}`, detail);
}


// ═══════════════════════════════════════════════════════════════════════════════
// Pipeline State Machine (Section 12 of blueprint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transition the pipeline to a new state.
 * 
 * ENFORCES: States must advance in order. No state can be skipped.
 * ENFORCES: NETWORK_REQUEST_ALLOWED is only reachable after SANITIZED_CONTEXT_READY.
 * 
 * @param {string} newState - The target pipeline state
 * @returns {boolean} True if transition succeeded
 */
function transitionState(newState) {
  const currentIndex = PIPELINE_ORDER.indexOf(pipelineState);
  const targetIndex = PIPELINE_ORDER.indexOf(newState);

  // Allow reset to IDLE from any state
  if (newState === PIPELINE_STATE.IDLE) {
    pipelineState = PIPELINE_STATE.IDLE;
    audit('pipeline_state_reset', { to: newState });
    return true;
  }

  // Must advance forward (or stay)
  if (targetIndex < 0) {
    audit('pipeline_state_invalid', { attempted: newState });
    return false;
  }

  if (targetIndex > currentIndex + 1) {
    // Skipping states is NOT allowed — this is the privacy gate enforcement
    audit('pipeline_state_skip_blocked', {
      from: pipelineState,
      attempted: newState,
      reason: 'Cannot skip pipeline states — privacy gate violation',
    });
    return false;
  }

  pipelineState = newState;
  audit('pipeline_state_transition', { from: PIPELINE_ORDER[currentIndex], to: newState });

  // Broadcast to popup/sidepanel
  broadcastStatus();
  return true;
}

/**
 * Check if network transmission is currently allowed.
 * This is the core privacy gate — the system REFUSES to send data to the
 * server unless sanitization has provably completed.
 */
function isNetworkAllowed() {
  const stateIndex = PIPELINE_ORDER.indexOf(pipelineState);
  const requiredIndex = PIPELINE_ORDER.indexOf(PIPELINE_STATE.NETWORK_REQUEST_ALLOWED);
  return stateIndex >= requiredIndex;
}


// ═══════════════════════════════════════════════════════════════════════════════
// Tab Screenshot Capture
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Capture a screenshot of the active tab.
 * Uses chrome.tabs.captureVisibleTab which runs in the extension context.
 * 
 * @returns {Promise<string>} Base64-encoded PNG data URI
 */
async function captureScreenshot() {
  audit('screenshot_capture_started');
  try {
    const tab = await chrome.tabs.get(activeTabId);

    // Guard: captureVisibleTab is not allowed on chrome://, edge://, devtools:// etc.
    if (tab.url && /^(chrome|edge|devtools|chrome-extension|about):/i.test(tab.url)) {
      audit('screenshot_capture_skipped', { reason: 'Restricted URL scheme', url: tab.url });
      return null;
    }

    const dataUrl = await new Promise((resolve) => {
      try {
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 85 }, (url) => {
          if (chrome.runtime.lastError) {
            console.warn('[PRIVAGENT] captureVisibleTab failed:', chrome.runtime.lastError.message);
            audit('screenshot_capture_warning', { warning: chrome.runtime.lastError.message });
            resolve(null);
          } else {
            resolve(url || null);
          }
        });
      } catch (err) {
        console.warn('[PRIVAGENT] captureVisibleTab exception:', err.message);
        audit('screenshot_capture_exception', { error: err.message });
        resolve(null);
      }
    });

    if (!dataUrl) {
      console.warn('[PRIVAGENT] Screen capture empty or failed. Falling back gracefully to DOM-only context scanning.');
      audit('screenshot_capture_empty', { reason: 'captureVisibleTab returned undefined or null' });
      return null;
    }

    audit('screenshot_capture_complete', {
      size: dataUrl.length,
    });
    return dataUrl;
  } catch (err) {
    // Graceful fallback: log the error and return null so the pipeline
    // continues with DOM-only perception rather than hanging.
    console.warn('[PRIVAGENT] Screen capture error:', err.message, '— proceeding with DOM-only context scanning');
    audit('screenshot_capture_error', {
      error: err.message,
      fallback: 'DOM-only perception (no screenshot)',
    });
    return null;
  }
}

/**
 * Ensure an Offscreen Document is active for HTML5 canvas redaction & workers.
 */
async function ensureOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS', 'WORKERS'],
      justification: 'PRIVAGENT requires offscreen canvas for visual PII redaction and Web Worker vision model inference.'
    });
    audit('offscreen_document_created');
  } catch (err) {
    if (!err.message?.includes('Only a single offscreen document may be created')) {
      audit('offscreen_document_error', { error: err.message });
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// DOM Extraction (via content script)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Request DOM extraction and Layer 1 PII scan from the content script.
 * 
 * @returns {Promise<{domContext, piiResult}>}
 */
async function requestDOMExtraction() {
  audit('dom_extraction_requested');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(activeTabId, { type: MSG.EXTRACT_DOM }, (response) => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message;
        audit('dom_extraction_failed', { error: errMsg });
        reject(new Error(errMsg));
        return;
      }
      if (!response || !response.success) {
        reject(new Error('DOM extraction returned unsuccessful response'));
        return;
      }
      audit('dom_extraction_received', {
        elementCount: response.domContext?.elementCount,
        piiDetections: response.piiResult?.detectionCount,
      });
      resolve(response);
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Sanitization Engine (Section 10 & 11 of blueprint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the sanitized context from raw DOM context + PII detections.
 * 
 * This creates both:
 *   1. Sanitized structured context (JSON) — element descriptions with
 *      sensitive values replaced by placeholders.
 *   2. Redaction metadata — for the visual redaction engine to apply
 *      blackout/blur/pixelation on the screenshot.
 * 
 * @param {Object} domContext - Raw DOM context from content script
 * @param {Object} piiResult - PII scan result from content script
 * @returns {Object} Sanitized context ready for server transmission
 */
function buildSanitizedContext(domContext, piiResult) {
  const t0 = performance.now();
  audit('sanitization_started');

  // Deep clone elements so we don't mutate the raw context
  const sanitizedElements = JSON.parse(JSON.stringify(domContext.elements));
  const redactionLog = [];

  // Build a map: elementIndex → list of PII detections
  const piiByElement = new Map();
  for (const detection of piiResult.detections) {
    const idx = detection.elementIndex;
    if (!piiByElement.has(idx)) piiByElement.set(idx, []);
    piiByElement.get(idx).push(detection);
  }

  // Apply redaction to each element that has PII detections
  for (const [idx, detections] of piiByElement) {
    if (idx >= sanitizedElements.length) continue;
    const el = sanitizedElements[idx];

    for (const det of detections) {
      const redactionMode = getRedactionMode(det.category);
      const placeholder = getPlaceholder(det.category);

      // Redact the element's value/text fields
      if (el.value !== undefined && el.value.length > 0) {
        el.value = placeholder;
      }
      if (el.text !== undefined && el.text.length > 0) {
        // For text elements, try pattern-specific replacement
        el.text = redactTextContent(el.text, det.category, placeholder);
      }

      el._redacted = true;
      el._redactionMode = redactionMode;
      el._piiCategory = det.category;
      el._privacyLevel = det.privacyLevel;

      redactionLog.push({
        elementIndex: idx,
        category: det.category,
        mode: redactionMode,
        source: det.source,
        confidence: det.confidence,
        bbox: det.bbox,
      });
    }
  }

  const elapsed = performance.now() - t0;
  const totalRedactions = redactionLog.length;

  // Build category summary
  const categoryCounts = {};
  for (const r of redactionLog) {
    categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
  }

  audit('sanitization_complete', {
    totalRedactions,
    categoryCounts,
    elapsedMs: Math.round(elapsed * 100) / 100,
  });

  return {
    timestamp: new Date().toISOString(),
    page: {
      url: domContext.url,
      title: domContext.title,
      viewport: domContext.viewport,
    },
    elementCount: sanitizedElements.length,
    elements: sanitizedElements,
    privacy: {
      totalRedactions,
      categoryCounts,
      policyMode,
      rawDataSent: false,
      sanitized: true,
    },
    redactionLog,
    sanitizationMs: Math.round(elapsed * 100) / 100,
  };
}

/**
 * Get the redaction mode for a PII category, respecting current policy.
 */
function getRedactionMode(category) {
  // Check user overrides first
  if (categoryOverrides[category]?.mode) {
    return categoryOverrides[category].mode;
  }
  return CATEGORY_REDACTION[category] || REDACTION_MODE.PLACEHOLDER;
}

/**
 * Get the placeholder text for a PII category.
 */
function getPlaceholder(category) {
  const placeholders = {
    [PII_CATEGORY.PASSWORD]:       '[PASSWORD_REDACTED]',
    [PII_CATEGORY.OTP]:            '[OTP_REDACTED]',
    [PII_CATEGORY.EMAIL]:          '[EMAIL_REDACTED]',
    [PII_CATEGORY.PHONE]:          '[PHONE_REDACTED]',
    [PII_CATEGORY.ACCOUNT_NUMBER]: '[ACCOUNT_REDACTED]',
    [PII_CATEGORY.PAYMENT_DATA]:   '[PAYMENT_REDACTED]',
    [PII_CATEGORY.FACE]:           '[FACE_REDACTED]',
    [PII_CATEGORY.GOVERNMENT_ID]:  '[ID_REDACTED]',
    [PII_CATEGORY.NAME]:           '[NAME_REDACTED]',
    [PII_CATEGORY.ADDRESS]:        '[ADDRESS_REDACTED]',
    [PII_CATEGORY.CONFIDENTIAL]:   '[CONFIDENTIAL_REDACTED]',
  };
  return placeholders[category] || '[REDACTED]';
}

/**
 * Redact PII patterns within a text string.
 * In BALANCED mode, preserves surrounding task-relevant text.
 * In STRICT mode, replaces the entire text.
 */
function redactTextContent(text, category, placeholder) {
  if (policyMode === POLICY_MODE.STRICT) {
    return placeholder;
  }

  // BALANCED mode: try to replace just the sensitive pattern
  switch (category) {
    case PII_CATEGORY.EMAIL:
      return text.replace(
        /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
        placeholder
      );
    case PII_CATEGORY.PHONE:
      return text.replace(
        /(?:\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
        placeholder
      );
    case PII_CATEGORY.GOVERNMENT_ID:
      // Aadhaar
      text = text.replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, placeholder);
      // PAN
      text = text.replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, placeholder);
      return text;
    case PII_CATEGORY.PAYMENT_DATA:
      return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, placeholder);
    default:
      // For categories without clear patterns, replace the full value
      return placeholder;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Server Communication — Privacy-Gated (Section 13 of blueprint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send sanitized context to the server for reasoning.
 * 
 * CRITICAL: This function enforces the privacy gate. It will REFUSE to
 * transmit if the pipeline has not reached SANITIZED_CONTEXT_READY.
 * 
 * @param {string} task - User's task instruction
 * @param {Object} context - Sanitized context (never raw)
 * @param {string|null} screenshotDataUrl - Optional sanitized screenshot
 * @returns {Promise<Object>} Server's action plan
 */
async function sendToServer(task, context, screenshotDataUrl = null) {
  // ─── PRIVACY GATE CHECK ─────────────────────────────────────────────
  if (!isNetworkAllowed()) {
    const error = 'PRIVACY GATE VIOLATION: Attempted network request before sanitization complete';
    audit('privacy_gate_blocked', {
      currentState: pipelineState,
      requiredState: PIPELINE_STATE.NETWORK_REQUEST_ALLOWED,
    });
    throw new Error(error);
  }

  audit('server_request_started', {
    task,
    elementCount: context.elementCount,
    redactions: context.privacy?.totalRedactions,
  });

  const payload = {
    task,
    page: context.page,
    elements: context.elements,
    privacy_metadata: context.privacy,
  };

  // Include sanitized screenshot if available
  if (screenshotDataUrl) {
    payload.sanitized_image = screenshotDataUrl;
  }

  const t0 = performance.now();

  try {
    const response = await fetch(`${SERVER.BASE_URL}${SERVER.PLAN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const elapsed = performance.now() - t0;

    audit('server_response_received', {
      status: result.status,
      actionCount: result.actions?.length,
      serverMs: Math.round(elapsed * 100) / 100,
    });

    return result;
  } catch (err) {
    const elapsed = performance.now() - t0;
    audit('server_request_failed', {
      error: err.message,
      elapsedMs: Math.round(elapsed * 100) / 100,
    });
    throw err;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Action Validation (Section 15 of blueprint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a server-returned action plan before execution.
 * 
 * This is the background-side validation layer. The content script
 * performs a second defense-in-depth check during execution.
 * 
 * Rules:
 *   - Only known ACTION_TYPEs are allowed.
 *   - TYPE actions into BLOCKED_INPUT_TYPES are rejected.
 *   - NAVIGATE actions to data: or javascript: URLs are rejected.
 *   - Actions must have a valid target when required.
 * 
 * @param {Array} actions - Array of action objects from the server
 * @returns {Object} { valid: boolean, actions: validated[], rejected: [] }
 */
function validateActions(actions) {
  audit('action_validation_started', { actionCount: actions?.length });

  if (!Array.isArray(actions) || actions.length === 0) {
    audit('action_validation_failed', { reason: 'No actions provided' });
    return { valid: false, actions: [], rejected: [], reason: 'No actions in plan' };
  }

  const validated = [];
  const rejected = [];

  for (const action of actions) {
    const result = validateSingleAction(action);
    if (result.valid) {
      validated.push(action);
    } else {
      rejected.push({ action, reason: result.reason });
      audit('action_rejected', {
        type: action.type,
        reason: result.reason,
      });
    }
  }

  const allValid = rejected.length === 0 && validated.length > 0;

  audit('action_validation_complete', {
    valid: allValid,
    validCount: validated.length,
    rejectedCount: rejected.length,
  });

  return {
    valid: allValid,
    actions: validated,
    rejected,
  };
}

/**
 * Validate a single action.
 */
function validateSingleAction(action) {
  // Check action type is known
  if (!Object.values(ACTION_TYPE).includes(action.type)) {
    return { valid: false, reason: `Unknown action type: ${action.type}` };
  }

  // TYPE action safety
  if (action.type === ACTION_TYPE.TYPE) {
    if (!action.text && action.text !== '') {
      return { valid: false, reason: 'TYPE action missing text' };
    }
    if (!action.target) {
      return { valid: false, reason: 'TYPE action missing target' };
    }
    // Check if target is explicitly a blocked input type
    if (action.target.inputType && BLOCKED_INPUT_TYPES.includes(action.target.inputType)) {
      return {
        valid: false,
        reason: `TYPE into blocked input type: ${action.target.inputType}`,
      };
    }
  }

  // CLICK/FOCUS/PRESS_KEY actions need a target
  if ([ACTION_TYPE.CLICK, ACTION_TYPE.FOCUS, ACTION_TYPE.SELECT, ACTION_TYPE.PRESS_KEY].includes(action.type)) {
    if (!action.target) {
      return { valid: false, reason: `${action.type} action missing target` };
    }
  }

  // PRESS_KEY needs a key name
  if (action.type === ACTION_TYPE.PRESS_KEY) {
    if (!action.key) {
      return { valid: false, reason: 'PRESS_KEY action missing key name' };
    }
  }

  // NAVIGATE safety — block javascript: and data: URLs
  if (action.type === ACTION_TYPE.NAVIGATE) {
    if (action.url) {
      const lower = action.url.toLowerCase().trim();
      if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
        return {
          valid: false,
          reason: `NAVIGATE to unsafe URL scheme: ${lower.split(':')[0]}`,
        };
      }
    }
  }

  // SCROLL needs direction
  if (action.type === ACTION_TYPE.SCROLL) {
    if (!action.direction) {
      return { valid: false, reason: 'SCROLL action missing direction' };
    }
  }

  return { valid: true };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Execute Action (via content script)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Forward a validated action to the content script for execution.
 */
async function executeActionInTab(action) {
  audit('action_dispatch', { type: action.type });
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      activeTabId,
      { type: MSG.EXECUTE_ACTION, payload: action },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response?.result || response);
      }
    );
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Agent Loop (Section 16 of blueprint)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run one iteration of the agent loop.
 * 
 * One iteration:
 *   1. Extract DOM + PII scan from content script
 *   2. Optionally capture screenshot
 *   3. Build sanitized context
 *   4. Advance pipeline through privacy gate
 *   5. Send sanitized context to server
 *   6. Validate server actions
 *   7. Execute validated actions
 *   8. Return result
 * 
 * The loop controller (runAgentLoop) calls this repeatedly until the task
 * is complete or the iteration limit is reached.
 */
async function runOneIteration() {
  loopIteration++;
  audit('agent_loop_iteration_started', { iteration: loopIteration });

  // ─── Step 1: Reset pipeline for new iteration ───────────────────────
  transitionState(PIPELINE_STATE.IDLE);

  // Dynamic native tab resolution: bind to whichever tab/window is currently active
  try {
    const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTabs && activeTabs.length > 0 && activeTabs[0].id) {
      activeTabId = activeTabs[0].id;
    } else {
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTabs && currentTabs.length > 0 && currentTabs[0].id) {
        activeTabId = currentTabs[0].id;
      }
    }
  } catch (_) {}

  // ─── Step 2: Extract DOM context + Layer 1 PII scan ─────────────────
  let domContext, piiResult;
  try {
    const extraction = await requestDOMExtraction();
    domContext = extraction.domContext;
    piiResult = extraction.piiResult;
  } catch (err) {
    // Content script may not be injected (restricted page, new tab, etc.)
    // Attempt to re-inject the content script and retry once.
    audit('dom_extraction_initial_failure', { error: err.message });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content/content-script.js'],
      });
      await sleep(300); // Allow script to initialize
      const retryExtraction = await requestDOMExtraction();
      domContext = retryExtraction.domContext;
      piiResult = retryExtraction.piiResult;
    } catch (retryErr) {
      audit('dom_extraction_retry_failed', { error: retryErr.message });
      return {
        success: false,
        error: `Cannot extract DOM from current tab: ${retryErr.message}`,
        iteration: loopIteration,
        shouldContinue: false,
      };
    }
  }

  rawDomContext = domContext;
  piiScanResult = piiResult;
  transitionState(PIPELINE_STATE.RAW_CONTEXT_CREATED);
  broadcastStatus(); // Push Step 1 complete to UI

  // ─── Step 3: PII scan is already done by content script ─────────────
  transitionState(PIPELINE_STATE.PII_SCAN_COMPLETE);

  // ─── Step 4: Build sanitized context (redaction) ────────────────────
  sanitizedContext = buildSanitizedContext(domContext, piiResult);
  transitionState(PIPELINE_STATE.REDACTION_COMPLETE);

  // ─── Step 5: Mark sanitized context as ready ────────────────────────
  transitionState(PIPELINE_STATE.SANITIZED_CONTEXT_READY);
  broadcastStatus(); // Push Steps 2-4 complete to UI

  // ─── Step 6: Capture and visually redact screenshot via Offscreen Document ───
  try {
    const rawCapture = await captureScreenshot();
    rawScreenshotUrl = rawCapture; // Kept local only for Human View sidepanel

    if (rawCapture) {
      await ensureOffscreenDocument();

      const visualRedactions = (sanitizedContext.redactionLog || []).map(r => ({
        bbox: r.bbox,
        category: r.category,
        mode: r.mode,
        placeholder: getPlaceholder(r.category)
      }));

      // Use callback-based sendMessage with a timeout to avoid deadlocks.
      // chrome.runtime.sendMessage from the service worker broadcasts to ALL
      // extension contexts (including itself). The offscreen document handles
      // the OFFSCREEN_REDACT_IMAGE message asynchronously (returns true).
      // We wrap in a Promise with a 10s timeout to prevent indefinite hanging.
      const redactResp = await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          audit('visual_redaction_timeout', { reason: 'Offscreen did not respond within 10s' });
          resolve(null);
        }, 10000);

        try {
          chrome.runtime.sendMessage({
            type: MSG.OFFSCREEN_REDACT_IMAGE,
            payload: {
              imageDataUrl: rawCapture,
              redactions: visualRedactions,
            },
          }, (response) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              audit('visual_redaction_message_error', {
                error: chrome.runtime.lastError.message,
              });
              resolve(null);
            } else {
              resolve(response);
            }
          });
        } catch (msgErr) {
          clearTimeout(timeoutId);
          audit('visual_redaction_send_error', { error: msgErr.message });
          resolve(null);
        }
      });

      if (redactResp && redactResp.success) {
        sanitizedScreenshotUrl = redactResp.sanitizedDataUrl;
        audit('visual_redaction_complete', {
          redactionsApplied: redactResp.redactionsCount,
          elapsedMs: redactResp.elapsedMs
        });
      } else {
        // Fallback: use raw screenshot for Human View, no sanitized version
        sanitizedScreenshotUrl = null;
        audit('visual_redaction_failed', { error: redactResp?.error || 'No response from offscreen' });
      }
    } else {
      // No screenshot captured — proceed with DOM-only perception
      rawScreenshotUrl = null;
      sanitizedScreenshotUrl = null;
      audit('screenshot_skipped', { reason: 'captureScreenshot returned null, using DOM-only perception' });
    }
  } catch (err) {
    audit('screenshot_redaction_error', { error: err.message });
    rawScreenshotUrl = null;
    sanitizedScreenshotUrl = null;
  }

  // ─── Step 7: Open the privacy gate for network transmission ─────────
  transitionState(PIPELINE_STATE.NETWORK_REQUEST_ALLOWED);

  // ─── Step 8: Send sanitized context to server ──────────────────────
  let actionPlan;
  try {
    // SECURITY: Transmit ONLY the sanitized screenshot, never the raw screen!
    actionPlan = await sendToServer(currentTask, sanitizedContext, sanitizedScreenshotUrl);
    serverActionPlan = actionPlan;
    transitionState(PIPELINE_STATE.SERVER_RESPONSE_RECEIVED);
  } catch (err) {
    audit('server_communication_failed', { error: err.message });
    return {
      success: false,
      error: err.message,
      iteration: loopIteration,
      shouldContinue: false,
    };
  }

  // ─── Step 9: Validate server actions ────────────────────────────────
  const validation = validateActions(actionPlan.actions);
  if (!validation.valid && validation.actions.length === 0) {
    audit('all_actions_rejected', { rejected: validation.rejected });
    transitionState(PIPELINE_STATE.ACTION_VALIDATED);
    return {
      success: false,
      error: 'All server actions were rejected by validation',
      rejected: validation.rejected,
      iteration: loopIteration,
      shouldContinue: false,
    };
  }
  transitionState(PIPELINE_STATE.ACTION_VALIDATED);

  // ─── Step 10: Execute validated actions ─────────────────────────────
  const executionResults = [];
  for (const action of validation.actions) {
    try {
      const result = await executeActionInTab(action);
      executionResults.push({ action: action.type, ...result });

      // Small delay between actions for page stability
      await sleep(300);
    } catch (err) {
      executionResults.push({
        action: action.type,
        success: false,
        error: err.message,
      });
    }
  }
  transitionState(PIPELINE_STATE.ACTION_EXECUTED);

  // ─── Step 11: Determine if loop should continue ─────────────────────
  const shouldContinue = actionPlan.status !== 'complete' &&
                         loopIteration < MAX_LOOP_ITERATIONS &&
                         executionResults.some(r => r.success);

  // Wait for page to settle after actions
  if (shouldContinue) {
    await sleep(1000);
  }

  audit('agent_loop_iteration_complete', {
    iteration: loopIteration,
    actionsExecuted: executionResults.length,
    shouldContinue,
  });

  return {
    success: true,
    iteration: loopIteration,
    actionsExecuted: executionResults,
    rejected: validation.rejected,
    shouldContinue,
    privacy: sanitizedContext.privacy,
  };
}

/**
 * Run the full agent loop for a given task.
 * Repeats: capture → sanitize → reason → act → observe until done.
 */
async function runAgentLoop(task, tabId) {
  currentTask = task;
  activeTabId = tabId;
  loopIteration = 0;
  isTaskAborted = false;

  audit('agent_loop_started', { task, tabId });
  broadcastStatus();

  const iterationResults = [];

  try {
    let shouldContinue = true;
    while (shouldContinue && !isTaskAborted) {
      const result = await runOneIteration();
      iterationResults.push(result);
      if (isTaskAborted) {
        audit('agent_loop_aborted_by_user');
        break;
      }
      shouldContinue = result.shouldContinue;

      // Broadcast progress after each iteration
      broadcastStatus();
    }
  } catch (err) {
    audit('agent_loop_error', { error: err.message });
  } finally {
    // Reset pipeline
    transitionState(PIPELINE_STATE.IDLE);
    audit('agent_loop_finished', {
      totalIterations: loopIteration,
      task,
      wasAborted: isTaskAborted,
    });
    broadcastStatus();
  }

  return {
    task,
    totalIterations: loopIteration,
    results: iterationResults,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// Status Broadcasting (for Popup / Side-panel)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Broadcast current pipeline status to popup / side-panel.
 * This feeds the Privacy Dashboard (Section 19 of blueprint).
 */
function broadcastStatus() {
  const status = {
    type: MSG.AGENT_LOOP_STATUS,
    payload: {
      pipelineState,
      task: currentTask,
      iteration: loopIteration,
      policyMode,
      networkAllowed: isNetworkAllowed(),
      privacy: sanitizedContext?.privacy || null,
      rawScreenshot: rawScreenshotUrl,
      sanitizedScreenshot: sanitizedScreenshotUrl,
      lastPiiScan: piiScanResult ? {
        detectionCount: piiScanResult.detectionCount,
        scanMs: piiScanResult.scanMs,
      } : null,
      auditLogLength: auditLog.length,
      auditLog: auditLog.slice(-40),
    },
  };

  // Send to all extension UI contexts
  try {
    chrome.runtime.sendMessage(status).catch(() => {
      // No listeners — popup/sidepanel not open; safe to ignore
    });
  } catch (_) {
    // Extension context may be invalid
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// Message Handlers
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // ─── Ignore messages intended for the offscreen document ──────────
  // chrome.runtime.sendMessage broadcasts to ALL listeners in the extension.
  // The service worker must NOT handle offscreen-targeted messages, otherwise
  // it will consume the message port and prevent the offscreen document's
  // asynchronous response from reaching the caller.
  if (message.type === MSG.OFFSCREEN_REDACT_IMAGE ||
      message.type === MSG.OFFSCREEN_VISION_INFERENCE ||
      message.type === MSG.OFFSCREEN_READY) {
    return false;
  }

  switch (message.type) {
    // ─── Popup/Sidepanel submits a new task ─────────────────────────
    case MSG.TASK_SUBMIT: {
      const { task } = message.payload;
      if (!task || !task.trim()) {
        sendResponse({ success: false, error: 'Empty task' });
        return false;
      }

      // Robust resolution of active target web tab
      findActiveWebTab().then(activeTab => {
        if (!activeTab || !activeTab.id) {
          sendResponse({ success: false, error: 'No active web tab found. Please navigate to a webpage (e.g., youtube.com) and try again.' });
          return;
        }

        const tabId = activeTab.id;
        activeTabId = tabId;
        sendResponse({ success: true, status: 'started', tabId });

        // Run the agent loop asynchronously
        runAgentLoop(task.trim(), tabId).then(result => {
          chrome.runtime.sendMessage({
            type: MSG.TASK_STATUS,
            payload: { status: 'complete', result },
          }).catch(() => {});
        }).catch(err => {
          chrome.runtime.sendMessage({
            type: MSG.TASK_STATUS,
            payload: { status: 'error', error: err.message },
          }).catch(() => {});
        });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });

      return true; // async sendResponse
    }

    // ─── UI requests task abort ─────────────────────────────────────
    case MSG.TASK_ABORT: {
      isTaskAborted = true;
      transitionState(PIPELINE_STATE.IDLE);
      audit('task_abort_received');
      broadcastStatus();
      sendResponse({ success: true });
      return false;
    }

    // ─── UI requests sidepanel open ─────────────────────────────────
    case MSG.OPEN_SIDEPANEL: {
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.windowId) {
            chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(console.error);
          }
        });
      }
      sendResponse({ success: true });
      return false;
    }

    // ─── UI requests current privacy status ─────────────────────────
    case MSG.PRIVACY_STATUS: {
      sendResponse({
        pipelineState,
        policyMode,
        task: currentTask,
        iteration: loopIteration,
        networkAllowed: isNetworkAllowed(),
        privacy: sanitizedContext?.privacy || null,
        rawScreenshot: rawScreenshotUrl,
        sanitizedScreenshot: sanitizedScreenshotUrl,
        piiScan: piiScanResult ? {
          detectionCount: piiScanResult.detectionCount,
          detections: piiScanResult.detections,
        } : null,
        auditLog: auditLog.slice(-50), // Last 50 entries
      });
      return false;
    }

    // ─── UI requests pipeline state ──────────────────────────────────
    case MSG.GET_PIPELINE_STATE: {
      sendResponse({
        pipelineState,
        task: currentTask,
        iteration: loopIteration,
        networkAllowed: isNetworkAllowed(),
      });
      return false;
    }

    // ─── Content script audit event ──────────────────────────────────
    case MSG.AUDIT_EVENT: {
      audit(message.payload.event, message.payload);
      return false;
    }

    // ─── Content script error ────────────────────────────────────────
    case MSG.ERROR: {
      audit('content_script_error', message.payload);
      return false;
    }

    default:
      return false;
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Extension Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

/** Called when the extension is installed or updated */
chrome.runtime.onInstalled.addListener((details) => {
  audit('extension_installed', {
    reason: details.reason,
    version: chrome.runtime.getManifest().version,
  });

  // Initialize default privacy policy in storage
  chrome.storage.local.set({
    privagent_policy: {
      mode: POLICY_MODE.BALANCED,
      categoryOverrides: {},
    },
  });
});

/** Called when the service worker starts */
audit('service_worker_started', {
  version: chrome.runtime.getManifest?.()?.version || '0.1.0',
});

/** Load saved privacy policy */
chrome.storage.local.get('privagent_policy', (data) => {
  if (data.privagent_policy) {
    policyMode = data.privagent_policy.mode || POLICY_MODE.BALANCED;
    categoryOverrides = data.privagent_policy.categoryOverrides || {};
    audit('privacy_policy_loaded', { mode: policyMode });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// Utility
// ═══════════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find the active target web tab across any browser window.
 * Ignores extension internal pages, devtools, and chrome:// system URLs.
 */
async function findActiveWebTab() {
  const isWebUrl = (u) => u && !/^(chrome|edge|devtools|chrome-extension|about):/i.test(u);

  // 1. Try active tab in last focused window (the browser window user clicked from)
  try {
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabs = (tabs || []).filter(t => t && t.id && isWebUrl(t.url));
    if (tabs.length > 0) return tabs[0];
  } catch (_) {}

  // 2. Try active tab in current window
  try {
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabs = (tabs || []).filter(t => t && t.id && isWebUrl(t.url));
    if (tabs.length > 0) return tabs[0];
  } catch (_) {}

  // 3. Try any active tab in any window
  try {
    let tabs = await chrome.tabs.query({ active: true });
    tabs = (tabs || []).filter(t => t && t.id && isWebUrl(t.url));
    if (tabs.length > 0) return tabs[0];
  } catch (_) {}

  // 4. Fallback: any web tab open in the browser
  try {
    let tabs = await chrome.tabs.query({});
    tabs = (tabs || []).filter(t => t && t.id && isWebUrl(t.url));
    if (tabs.length > 0) return tabs[0];
  } catch (_) {}

  return null;
}
