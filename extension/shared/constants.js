/**
 * PRIVAGENT — Shared Constants
 * 
 * Central definitions for message types, pipeline states, privacy levels,
 * action types, and PII categories used across the extension.
 */

// ─── Message Types (content ↔ background communication) ─────────────────────

export const MSG = Object.freeze({
  // Content → Background
  DOM_CONTEXT_READY:        'privagent:dom-context-ready',
  SCREENSHOT_REQUEST:       'privagent:screenshot-request',
  PII_SCAN_RESULT:          'privagent:pii-scan-result',
  REDACTION_COMPLETE:       'privagent:redaction-complete',
  SANITIZED_CONTEXT_READY:  'privagent:sanitized-context-ready',
  ACTION_EXECUTED:          'privagent:action-executed',
  AUDIT_EVENT:              'privagent:audit-event',
  ERROR:                    'privagent:error',

  // Background → Content
  EXTRACT_DOM:              'privagent:extract-dom',
  CAPTURE_SCREENSHOT:       'privagent:capture-screenshot',
  APPLY_REDACTION:          'privagent:apply-redaction',
  EXECUTE_ACTION:           'privagent:execute-action',
  GET_PIPELINE_STATE:       'privagent:get-pipeline-state',

  // Background ↔ Popup / Side-panel
  TASK_SUBMIT:              'privagent:task-submit',
  TASK_ABORT:               'privagent:task-abort',
  TASK_STATUS:              'privagent:task-status',
  PRIVACY_STATUS:           'privagent:privacy-status',
  AGENT_LOOP_STATUS:        'privagent:agent-loop-status',
  OPEN_SIDEPANEL:           'privagent:open-sidepanel',

  // Background ↔ Offscreen Document
  OFFSCREEN_REDACT_IMAGE:       'privagent:offscreen-redact-image',
  OFFSCREEN_VISION_INFERENCE:   'privagent:offscreen-vision-inference',
  OFFSCREEN_READY:              'privagent:offscreen-ready',
});


// ─── Pipeline States ─────────────────────────────────────────────────────────
// Linear state machine: the network request is ONLY allowed after
// SANITIZED_CONTEXT_READY. This enforces the "privacy before network" rule.

export const PIPELINE_STATE = Object.freeze({
  IDLE:                     'IDLE',
  RAW_CONTEXT_CREATED:      'RAW_CONTEXT_CREATED',
  PII_SCAN_COMPLETE:        'PII_SCAN_COMPLETE',
  REDACTION_COMPLETE:       'REDACTION_COMPLETE',
  SANITIZED_CONTEXT_READY:  'SANITIZED_CONTEXT_READY',
  NETWORK_REQUEST_ALLOWED:  'NETWORK_REQUEST_ALLOWED',
  SERVER_RESPONSE_RECEIVED: 'SERVER_RESPONSE_RECEIVED',
  ACTION_VALIDATED:         'ACTION_VALIDATED',
  ACTION_EXECUTED:          'ACTION_EXECUTED',
});

// Ordered list — used to enforce the gate (no skipping states)
export const PIPELINE_ORDER = [
  PIPELINE_STATE.IDLE,
  PIPELINE_STATE.RAW_CONTEXT_CREATED,
  PIPELINE_STATE.PII_SCAN_COMPLETE,
  PIPELINE_STATE.REDACTION_COMPLETE,
  PIPELINE_STATE.SANITIZED_CONTEXT_READY,
  PIPELINE_STATE.NETWORK_REQUEST_ALLOWED,
  PIPELINE_STATE.SERVER_RESPONSE_RECEIVED,
  PIPELINE_STATE.ACTION_VALIDATED,
  PIPELINE_STATE.ACTION_EXECUTED,
];


// ─── Privacy / Data Classification Levels (Section 26 of blueprint) ──────────

export const PRIVACY_LEVEL = Object.freeze({
  PUBLIC:           0,   // Safe to transmit
  CONTEXTUAL:       1,   // Task-relevant, not inherently sensitive
  PERSONAL:         2,   // Name, email, phone, address
  HIGHLY_SENSITIVE: 3,   // Password, OTP, payment, gov-ID
  NEVER_TRANSMIT:   4,   // User/org blocked
});


// ─── PII Categories ─────────────────────────────────────────────────────────

export const PII_CATEGORY = Object.freeze({
  PASSWORD:       'PASSWORD',
  OTP:            'OTP',
  EMAIL:          'EMAIL',
  PHONE:          'PHONE',
  ACCOUNT_NUMBER: 'ACCOUNT_NUMBER',
  PAYMENT_DATA:   'PAYMENT_DATA',
  FACE:           'FACE',
  GOVERNMENT_ID:  'GOVERNMENT_ID',
  NAME:           'NAME',
  ADDRESS:        'ADDRESS',
  CONFIDENTIAL:   'CONFIDENTIAL',
});

// Map each category to a default privacy level
export const CATEGORY_LEVEL = Object.freeze({
  [PII_CATEGORY.PASSWORD]:       PRIVACY_LEVEL.HIGHLY_SENSITIVE,
  [PII_CATEGORY.OTP]:            PRIVACY_LEVEL.HIGHLY_SENSITIVE,
  [PII_CATEGORY.EMAIL]:          PRIVACY_LEVEL.PERSONAL,
  [PII_CATEGORY.PHONE]:          PRIVACY_LEVEL.PERSONAL,
  [PII_CATEGORY.ACCOUNT_NUMBER]: PRIVACY_LEVEL.HIGHLY_SENSITIVE,
  [PII_CATEGORY.PAYMENT_DATA]:   PRIVACY_LEVEL.HIGHLY_SENSITIVE,
  [PII_CATEGORY.FACE]:           PRIVACY_LEVEL.PERSONAL,
  [PII_CATEGORY.GOVERNMENT_ID]:  PRIVACY_LEVEL.HIGHLY_SENSITIVE,
  [PII_CATEGORY.NAME]:           PRIVACY_LEVEL.PERSONAL,
  [PII_CATEGORY.ADDRESS]:        PRIVACY_LEVEL.PERSONAL,
  [PII_CATEGORY.CONFIDENTIAL]:   PRIVACY_LEVEL.NEVER_TRANSMIT,
});


// ─── Redaction Modes ─────────────────────────────────────────────────────────

export const REDACTION_MODE = Object.freeze({
  BLACKOUT:      'BLACKOUT',
  BLUR:          'BLUR',
  PIXELATE:      'PIXELATE',
  PLACEHOLDER:   'PLACEHOLDER',
  SEMANTIC:      'SEMANTIC',
  DOM_REPLACE:   'DOM_REPLACE',
});

// Default redaction mode per category
export const CATEGORY_REDACTION = Object.freeze({
  [PII_CATEGORY.PASSWORD]:       REDACTION_MODE.BLACKOUT,
  [PII_CATEGORY.OTP]:            REDACTION_MODE.BLACKOUT,
  [PII_CATEGORY.EMAIL]:          REDACTION_MODE.PLACEHOLDER,
  [PII_CATEGORY.PHONE]:          REDACTION_MODE.PLACEHOLDER,
  [PII_CATEGORY.ACCOUNT_NUMBER]: REDACTION_MODE.PLACEHOLDER,
  [PII_CATEGORY.PAYMENT_DATA]:   REDACTION_MODE.BLACKOUT,
  [PII_CATEGORY.FACE]:           REDACTION_MODE.BLUR,
  [PII_CATEGORY.GOVERNMENT_ID]:  REDACTION_MODE.BLACKOUT,
  [PII_CATEGORY.NAME]:           REDACTION_MODE.PLACEHOLDER,
  [PII_CATEGORY.ADDRESS]:        REDACTION_MODE.PLACEHOLDER,
  [PII_CATEGORY.CONFIDENTIAL]:   REDACTION_MODE.BLACKOUT,
});


// ─── Browser Action Types (Section 14 of blueprint) ─────────────────────────

export const ACTION_TYPE = Object.freeze({
  CLICK:     'CLICK',
  SCROLL:    'SCROLL',
  NAVIGATE:  'NAVIGATE',
  FOCUS:     'FOCUS',
  TYPE:      'TYPE',
  SELECT:    'SELECT',
  WAIT:      'WAIT',
  PRESS_KEY: 'PRESS_KEY',
});

// Fields that the action executor must NEVER type into by default
export const BLOCKED_INPUT_TYPES = Object.freeze([
  'password',
  'cc-number',
  'cc-exp',
  'cc-csc',
  'one-time-code',
]);


// ─── Privacy Policy Modes ────────────────────────────────────────────────────

export const POLICY_MODE = Object.freeze({
  STRICT:       'STRICT',       // Hide all configured sensitive categories
  BALANCED:     'BALANCED',     // Preserve task-relevant semantics
  USER_DEFINED: 'USER_DEFINED', // Custom per-category overrides
});


// ─── Server Endpoints ────────────────────────────────────────────────────────

export const SERVER = Object.freeze({
  BASE_URL:    'http://localhost:8000',
  PLAN:        '/agent/plan',
  VALIDATE:    '/privacy/validate',
  HEALTH:      '/health',
  METRICS:     '/metrics',
});


// ─── DOM Extraction Limits ───────────────────────────────────────────────────

export const DOM_LIMITS = Object.freeze({
  MAX_ELEMENTS:     2000,   // Hard cap on elements extracted per page
  MAX_TEXT_LENGTH:   500,   // Truncate text content per element
  MAX_DEPTH:         30,    // Maximum DOM traversal depth
  VIEWPORT_MARGIN:  100,    // px outside viewport still considered "visible"
});


// ─── Element Types for Structured Context ────────────────────────────────────

export const ELEMENT_TYPE = Object.freeze({
  TEXT:       'text',
  BUTTON:    'button',
  LINK:      'link',
  INPUT:     'input',
  SELECT:    'select',
  TEXTAREA:  'textarea',
  IMAGE:     'image',
  HEADING:   'heading',
  LIST_ITEM: 'list_item',
  TABLE:     'table',
  FORM:      'form',
  CONTAINER: 'container',
  UNKNOWN:   'unknown',
});
