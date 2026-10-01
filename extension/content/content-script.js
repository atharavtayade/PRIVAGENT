/**
 * PRIVAGENT — Content Script
 * 
 * Injected into every page via manifest.json content_scripts.
 * Responsibilities (Section 6 Module A + Module B of blueprint):
 * 
 *   1. Extract structured DOM context (visible text, buttons, inputs, links,
 *      ARIA labels, coordinates/bounding boxes, role/state info).
 *   2. Perform DOM-aware PII detection (Layer 1) — detect privacy-sensitive
 *      HTML elements before any data leaves the device.
 *   3. Apply DOM-level redaction when instructed by the background worker.
 *   4. Execute validated browser actions (click, scroll, type, etc.).
 *   5. Emit audit events for the privacy dashboard timeline.
 * 
 * The content script NEVER communicates with the server directly.
 * All external communication flows through the background service worker,
 * which enforces the privacy gate / network boundary.
 */

// ─── NOTE: content scripts cannot use ES module imports in Manifest V3.
// Constants are duplicated here as an IIFE to avoid import issues.
// In production, a build step (esbuild/rollup) would bundle shared/constants.js.

const PRIVAGENT = (() => {
  'use strict';

  if (window.__PRIVAGENT_INJECTED__) {
    return window.__PRIVAGENT_INSTANCE__ || {};
  }
  window.__PRIVAGENT_INJECTED__ = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // Inline Constants (mirrored from shared/constants.js)
  // ═══════════════════════════════════════════════════════════════════════════

  const MSG = Object.freeze({
    DOM_CONTEXT_READY:        'privagent:dom-context-ready',
    SCREENSHOT_REQUEST:       'privagent:screenshot-request',
    PII_SCAN_RESULT:          'privagent:pii-scan-result',
    REDACTION_COMPLETE:       'privagent:redaction-complete',
    SANITIZED_CONTEXT_READY:  'privagent:sanitized-context-ready',
    ACTION_EXECUTED:          'privagent:action-executed',
    AUDIT_EVENT:              'privagent:audit-event',
    ERROR:                    'privagent:error',

    EXTRACT_DOM:              'privagent:extract-dom',
    CAPTURE_SCREENSHOT:       'privagent:capture-screenshot',
    APPLY_REDACTION:          'privagent:apply-redaction',
    EXECUTE_ACTION:           'privagent:execute-action',
    GET_PIPELINE_STATE:       'privagent:get-pipeline-state',
  });

  const PII_CATEGORY = Object.freeze({
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

  const ACTION_TYPE = Object.freeze({
    CLICK:     'CLICK',
    SCROLL:    'SCROLL',
    NAVIGATE:  'NAVIGATE',
    FOCUS:     'FOCUS',
    TYPE:      'TYPE',
    SELECT:    'SELECT',
    WAIT:      'WAIT',
    PRESS_KEY: 'PRESS_KEY',
  });

  const BLOCKED_INPUT_TYPES = Object.freeze([
    'password', 'cc-number', 'cc-exp', 'cc-csc', 'one-time-code',
  ]);

  const ELEMENT_TYPE = Object.freeze({
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

  const DOM_LIMITS = Object.freeze({
    MAX_ELEMENTS:     2000,
    MAX_TEXT_LENGTH:   500,
    MAX_DEPTH:         30,
    VIEWPORT_MARGIN:  100,
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // Utility Helpers
  // ═══════════════════════════════════════════════════════════════════════════

  /** High-resolution timestamp (ms) */
  const now = () => performance.now();

  /** Emit a timestamped audit event to the background worker */
  function audit(eventType, detail = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      perfMs: now(),
      event: eventType,
      ...detail,
    };
    try {
      chrome.runtime.sendMessage({ type: MSG.AUDIT_EVENT, payload: entry });
    } catch (_) {
      // Extension context may have been invalidated — silently drop
    }
  }

  /** Truncate string to maxLen, appending ellipsis if truncated */
  function truncate(str, maxLen = DOM_LIMITS.MAX_TEXT_LENGTH) {
    if (!str) return '';
    str = str.trim().replace(/\s+/g, ' ');
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
  }

  /** Get computed bounding box relative to viewport as [x, y, w, h] */
  function getBBox(el) {
    const rect = el.getBoundingClientRect();
    return [
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height),
    ];
  }

  /** Check if an element is visible in / near the viewport */
  function isInViewport(el) {
    const rect = el.getBoundingClientRect();
    const margin = DOM_LIMITS.VIEWPORT_MARGIN;
    return (
      rect.bottom > -margin &&
      rect.top < window.innerHeight + margin &&
      rect.right > -margin &&
      rect.left < window.innerWidth + margin &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  /** Check if the element is hidden via CSS */
  function isVisuallyHidden(el) {
    const style = getComputedStyle(el);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      (parseFloat(style.width) === 0 && parseFloat(style.height) === 0)
    );
  }

  /** Determine our ELEMENT_TYPE from a DOM node */
  function classifyElement(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (tag === 'select') return ELEMENT_TYPE.SELECT;
      if (tag === 'textarea') return ELEMENT_TYPE.TEXTAREA;
      return ELEMENT_TYPE.INPUT;
    }
    if (tag === 'button' || role === 'button' || el.type === 'submit' || el.type === 'reset') {
      return ELEMENT_TYPE.BUTTON;
    }
    if (tag === 'a' || role === 'link') return ELEMENT_TYPE.LINK;
    if (tag === 'img' || role === 'img') return ELEMENT_TYPE.IMAGE;
    if (/^h[1-6]$/.test(tag) || role === 'heading') return ELEMENT_TYPE.HEADING;
    if (tag === 'li' || role === 'listitem') return ELEMENT_TYPE.LIST_ITEM;
    if (tag === 'table' || role === 'table' || role === 'grid') return ELEMENT_TYPE.TABLE;
    if (tag === 'form') return ELEMENT_TYPE.FORM;
    if (['div', 'section', 'main', 'article', 'aside', 'nav', 'header', 'footer'].includes(tag)) {
      return ELEMENT_TYPE.CONTAINER;
    }
    // Anything with meaningful text content
    if (el.textContent && el.textContent.trim().length > 0) return ELEMENT_TYPE.TEXT;

    return ELEMENT_TYPE.UNKNOWN;
  }

  /**
   * Get only the direct (own) text of an element, excluding child elements.
   */
  function getDirectTextContent(el) {
    if (!el || !el.childNodes) return '';
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text.trim();
  }

  /**
   * Resolve an input/control's associated label text.
   * Checks: <label for="...">, parent <label>, aria-label, aria-labelledby.
   */
  function resolveLabel(el) {
    if (!el || typeof el.getAttribute !== 'function') return null;

    // aria-labelledby takes highest priority
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const ref = document.getElementById(id);
        return ref ? ref.textContent.trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ');
    }

    // Explicit <label for="...">
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return label.textContent.trim();
      } catch (_) {}
    }

    // Implicit label (input nested inside <label>)
    const parentLabel = el.closest ? el.closest('label') : null;
    if (parentLabel) {
      // Get label text excluding the input's own text
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(inp => inp.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }

    // Title attribute fallback
    if (el.title) return el.title;

    return null;
  }

  /**
   * Build a robust CSS selector for an element (used by action executor).
   * Prefers ID > data-testid > unique class+nth-child path.
   */
  function buildCSSSelector(el) {
    if (!el || !el.tagName) return '';

    // Direct ID
    if (el.id) {
      try {
        return `#${CSS.escape(el.id)}`;
      } catch (_) {
        return `#${el.id}`;
      }
    }

    // data-testid
    const testId = el.dataset?.testid || (typeof el.getAttribute === 'function' ? el.getAttribute('data-testid') : null);
    if (testId) {
      try {
        return `[data-testid="${CSS.escape(testId)}"]`;
      } catch (_) {
        return `[data-testid="${testId}"]`;
      }
    }

    // Build a path upward
    const parts = [];
    let current = el;
    for (let i = 0; i < 5 && current && current !== document.body; i++) {
      let segment = current.tagName.toLowerCase();
      if (current.id) {
        try {
          parts.unshift(`#${CSS.escape(current.id)}`);
        } catch (_) {
          parts.unshift(`#${current.id}`);
        }
        break;
      }
      // Add nth-child for disambiguation
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          segment += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(segment);
      current = parent;
    }
    return parts.join(' > ');
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DOM Extraction Engine (Module B — Section 6.1 of blueprint)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Walk the DOM tree and build a structured element list.
   * Only includes elements that are visible and actionable/informative.
   * Returns an array of element descriptors suitable for the sanitized context.
   */
  function extractDOM() {
    const t0 = now();
    audit('dom_extraction_started');

    const elements = [];
    let elementCount = 0;

    // Tags we always skip — they carry no user-visible content
    const SKIP_TAGS = new Set([
      'script', 'style', 'noscript', 'meta', 'link', 'br', 'hr',
      'svg', 'path', 'defs', 'clippath', 'lineargradient', 'stop',
    ]);

    // Tags that are interactive or carry meaningful semantic content
    const SEMANTIC_TAGS = new Set([
      'input', 'textarea', 'select', 'button', 'a', 'img',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'label', 'li', 'td', 'th', 'caption',
      'p', 'span', 'strong', 'em', 'b', 'i', 'u',
      'table', 'form', 'fieldset', 'legend',
    ]);

    // ARIA roles that are always interesting
    const SEMANTIC_ROLES = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio', 'switch',
      'combobox', 'listbox', 'option', 'menu', 'menuitem',
      'tab', 'tabpanel', 'dialog', 'alert', 'alertdialog',
      'navigation', 'search', 'heading', 'img',
    ]);

    /**
     * Recursive DOM walker.
     * 
     * @param {Element} node - Current DOM node
     * @param {number}  depth - Current depth from document root
     */
    function walk(node, depth) {
      if (elementCount >= DOM_LIMITS.MAX_ELEMENTS) return;
      if (depth > DOM_LIMITS.MAX_DEPTH) return;
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      if (isVisuallyHidden(node)) return;

      const role = (node.getAttribute('role') || '').toLowerCase();
      const isSemantic = SEMANTIC_TAGS.has(tag) || SEMANTIC_ROLES.has(role);
      const isInView = isInViewport(node);

      // Only extract elements that are semantic or in-viewport with content
      if (isSemantic || isInView) {
        const descriptor = buildElementDescriptor(node, tag, role, depth);
        if (descriptor) {
          elements.push(descriptor);
          elementCount++;
        }
      }

      // Recurse into children
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        walk(children[i], depth + 1);
      }
    }

    /**
     * Build a structured descriptor for a single DOM element.
     * This is the data that eventually flows into the sanitized context
     * (after PII detection + redaction).
     */
    function buildElementDescriptor(el, tag, role, depth) {
      const type = classifyElement(el);

      // For containers, only include if they have a role or landmark semantics
      if (type === ELEMENT_TYPE.CONTAINER && !role) return null;
      if (type === ELEMENT_TYPE.UNKNOWN) return null;

      const bbox = getBBox(el);

      // Skip zero-area elements
      if (bbox[2] === 0 && bbox[3] === 0) return null;

      const descriptor = {
        id: el.id || undefined,
        type,
        tag,
        bbox,
        depth,
        inViewport: isInViewport(el),
      };

      // ─── Text content ───────────────────────────────────────────────
      if (type === ELEMENT_TYPE.INPUT || type === ELEMENT_TYPE.TEXTAREA) {
        descriptor.inputType = el.type || 'text';
        descriptor.value = el.value || '';
        descriptor.placeholder = el.placeholder || undefined;
        descriptor.autocomplete = el.autocomplete || undefined;
        descriptor.name = el.name || undefined;
        descriptor.readOnly = el.readOnly || undefined;
        descriptor.disabled = el.disabled || undefined;
        descriptor.required = el.required || undefined;
      } else if (type === ELEMENT_TYPE.SELECT) {
        descriptor.options = Array.from(el.options).slice(0, 20).map(o => ({
          text: truncate(o.text, 100),
          value: o.value,
          selected: o.selected,
        }));
        descriptor.name = el.name || undefined;
      } else if (type === ELEMENT_TYPE.IMAGE) {
        descriptor.alt = el.alt || undefined;
        descriptor.src = el.src ? (el.src.length > 200 ? '[long-url]' : el.src) : undefined;
      } else if (type === ELEMENT_TYPE.LINK) {
        descriptor.href = el.href ? (el.href.length > 200 ? '[long-url]' : el.href) : undefined;
        descriptor.text = truncate(el.textContent);
      } else {
        // Generic text content — only immediate text, not children's
        const directText = getDirectTextContent(el);
        if (directText) {
          descriptor.text = truncate(directText);
        } else {
          // Fall back to full textContent for leaf nodes
          const fullText = el.textContent;
          if (fullText && fullText.trim()) {
            descriptor.text = truncate(fullText);
          }
        }
      }

      // ─── Label resolution ───────────────────────────────────────────
      const label = resolveLabel(el);
      if (label) descriptor.label = truncate(label, 200);

      // ─── ARIA attributes ────────────────────────────────────────────
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) descriptor.ariaLabel = truncate(ariaLabel, 200);

      const ariaDescribedBy = el.getAttribute('aria-describedby');
      if (ariaDescribedBy) {
        const descEl = document.getElementById(ariaDescribedBy);
        if (descEl) descriptor.ariaDescription = truncate(descEl.textContent, 200);
      }

      if (role) descriptor.role = role;

      const ariaExpanded = el.getAttribute('aria-expanded');
      if (ariaExpanded != null) descriptor.expanded = ariaExpanded === 'true';

      const ariaChecked = el.getAttribute('aria-checked');
      if (ariaChecked != null) descriptor.checked = ariaChecked === 'true';

      const ariaDisabled = el.getAttribute('aria-disabled');
      if (ariaDisabled != null) descriptor.disabled = ariaDisabled === 'true';

      const ariaRequired = el.getAttribute('aria-required');
      if (ariaRequired != null) descriptor.required = ariaRequired === 'true';

      // ─── Data attributes (useful for app-specific privacy hints) ───
      const privacyHint = el.dataset.privagentSensitive || el.dataset.sensitive;
      if (privacyHint) descriptor.privacyHint = privacyHint;

      // ─── Button / submit text ───────────────────────────────────────
      if (type === ELEMENT_TYPE.BUTTON) {
        descriptor.text = truncate(
          el.textContent || el.value || el.getAttribute('aria-label') || ''
        );
      }

      // ─── CSS selector path (for action execution targeting) ────────
      descriptor.selector = buildCSSSelector(el);

      return descriptor;
    }

    // Start the walk from <body>
    try {
      walk(document.body, 0);
    } catch (err) {
      audit('dom_extraction_error', { error: err.message });
    }

    const elapsed = now() - t0;
    audit('dom_extraction_complete', {
      elementCount: elements.length,
      elapsedMs: Math.round(elapsed * 100) / 100,
    });

    return {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
      },
      elementCount: elements.length,
      extractionMs: Math.round(elapsed * 100) / 100,
      elements,
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DOM-Aware PII Detection — Layer 1 (Section 8.1 of blueprint)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Scan extracted DOM elements for privacy-sensitive fields.
   * Returns an array of PII detections with element index, category, source,
   * confidence, and the privacy level.
   *
   * This is the first detection layer — DOM signals. It runs BEFORE any
   * screenshot is taken or sent anywhere.
   */
  function scanDOMForPII(domContext) {
    const t0 = now();
    audit('pii_dom_scan_started');
    const detections = [];

    for (let i = 0; i < domContext.elements.length; i++) {
      const el = domContext.elements[i];
      const findings = detectPIIInElement(el);
      for (const finding of findings) {
        detections.push({
          elementIndex: i,
          selector: el.selector,
          bbox: el.bbox,
          ...finding,
        });
      }
    }

    const elapsed = now() - t0;
    audit('pii_dom_scan_complete', {
      detectionCount: detections.length,
      elapsedMs: Math.round(elapsed * 100) / 100,
    });

    return {
      timestamp: new Date().toISOString(),
      layer: 'DOM',
      detectionCount: detections.length,
      scanMs: Math.round(elapsed * 100) / 100,
      detections,
    };
  }

  /**
   * Detect PII signals in a single element descriptor.
   */
  function detectPIIInElement(el) {
    const findings = [];

    // ─── Input type checks ──────────────────────────────────────────
    if (el.type === ELEMENT_TYPE.INPUT || el.type === ELEMENT_TYPE.TEXTAREA) {
      const inputType = (el.inputType || '').toLowerCase();
      const autocomplete = (el.autocomplete || '').toLowerCase();
      const name = (el.name || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      const label = (el.label || '').toLowerCase();
      const ariaLabel = (el.ariaLabel || '').toLowerCase();

      // Password fields — highest confidence
      if (inputType === 'password') {
        findings.push({
          category: PII_CATEGORY.PASSWORD,
          source: 'input-type',
          confidence: 1.0,
          privacyLevel: 3,
          reason: 'Input type="password"',
        });
      }

      // Email fields
      if (inputType === 'email' ||
          autocomplete === 'email' ||
          matchesKeyword(name, EMAIL_KEYWORDS) ||
          matchesKeyword(placeholder, EMAIL_KEYWORDS) ||
          matchesKeyword(label, EMAIL_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.EMAIL,
          source: 'input-type/autocomplete/label',
          confidence: inputType === 'email' ? 1.0 : 0.85,
          privacyLevel: 2,
          reason: `Email signal: type=${inputType}, autocomplete=${autocomplete}`,
        });
      }

      // Phone fields
      if (inputType === 'tel' ||
          autocomplete === 'tel' || autocomplete === 'tel-national' ||
          matchesKeyword(name, PHONE_KEYWORDS) ||
          matchesKeyword(placeholder, PHONE_KEYWORDS) ||
          matchesKeyword(label, PHONE_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.PHONE,
          source: 'input-type/autocomplete/label',
          confidence: inputType === 'tel' ? 1.0 : 0.85,
          privacyLevel: 2,
          reason: `Phone signal: type=${inputType}, autocomplete=${autocomplete}`,
        });
      }

      // OTP fields
      if (autocomplete === 'one-time-code' ||
          matchesKeyword(name, OTP_KEYWORDS) ||
          matchesKeyword(placeholder, OTP_KEYWORDS) ||
          matchesKeyword(label, OTP_KEYWORDS) ||
          matchesKeyword(ariaLabel, OTP_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.OTP,
          source: 'autocomplete/label',
          confidence: autocomplete === 'one-time-code' ? 1.0 : 0.80,
          privacyLevel: 3,
          reason: `OTP signal: autocomplete=${autocomplete}`,
        });
      }

      // Payment / credit card fields
      if (['cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-name', 'cc-type'].includes(autocomplete) ||
          matchesKeyword(name, PAYMENT_KEYWORDS) ||
          matchesKeyword(placeholder, PAYMENT_KEYWORDS) ||
          matchesKeyword(label, PAYMENT_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.PAYMENT_DATA,
          source: 'autocomplete/label',
          confidence: autocomplete.startsWith('cc-') ? 1.0 : 0.80,
          privacyLevel: 3,
          reason: `Payment signal: autocomplete=${autocomplete}`,
        });
      }

      // Account number fields
      if (matchesKeyword(name, ACCOUNT_KEYWORDS) ||
          matchesKeyword(placeholder, ACCOUNT_KEYWORDS) ||
          matchesKeyword(label, ACCOUNT_KEYWORDS) ||
          matchesKeyword(ariaLabel, ACCOUNT_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.ACCOUNT_NUMBER,
          source: 'label/name',
          confidence: 0.75,
          privacyLevel: 3,
          reason: 'Account number signal from label/name',
        });
      }

      // Government ID fields
      if (matchesKeyword(name, GOV_ID_KEYWORDS) ||
          matchesKeyword(placeholder, GOV_ID_KEYWORDS) ||
          matchesKeyword(label, GOV_ID_KEYWORDS) ||
          matchesKeyword(ariaLabel, GOV_ID_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.GOVERNMENT_ID,
          source: 'label/name',
          confidence: 0.75,
          privacyLevel: 3,
          reason: 'Government ID signal from label/name',
        });
      }

      // Name fields (lower confidence — common false positives)
      if (autocomplete === 'name' || autocomplete === 'given-name' ||
          autocomplete === 'family-name' || autocomplete === 'additional-name' ||
          matchesKeyword(name, NAME_KEYWORDS) ||
          matchesKeyword(label, NAME_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.NAME,
          source: 'autocomplete/label',
          confidence: autocomplete.includes('name') ? 0.90 : 0.65,
          privacyLevel: 2,
          reason: `Name signal: autocomplete=${autocomplete}`,
        });
      }

      // Address fields
      if (['street-address', 'address-line1', 'address-line2', 'address-level1',
           'address-level2', 'country', 'country-name', 'postal-code'].includes(autocomplete) ||
          matchesKeyword(name, ADDRESS_KEYWORDS) ||
          matchesKeyword(label, ADDRESS_KEYWORDS)) {
        findings.push({
          category: PII_CATEGORY.ADDRESS,
          source: 'autocomplete/label',
          confidence: autocomplete.includes('address') ? 0.90 : 0.70,
          privacyLevel: 2,
          reason: `Address signal: autocomplete=${autocomplete}`,
        });
      }

      // ── Value-based pattern matching (Layer 2 lite — text patterns) ──
      const value = el.value || '';
      if (value.length > 0) {
        const valueFindings = detectPatternsInText(value);
        for (const vf of valueFindings) {
          // Avoid duplicate category detections
          if (!findings.some(f => f.category === vf.category)) {
            findings.push(vf);
          }
        }
      }
    }

    // ─── Text content checks (for non-input elements) ───────────────
    const text = el.text || '';
    if (text.length > 0 && el.type !== ELEMENT_TYPE.INPUT && el.type !== ELEMENT_TYPE.TEXTAREA) {
      const textFindings = detectPatternsInText(text);
      for (const tf of textFindings) {
        findings.push(tf);
      }
    }

    // ─── Application-specific privacy hints ─────────────────────────
    if (el.privacyHint) {
      const hintCategory = el.privacyHint.toUpperCase();
      if (PII_CATEGORY[hintCategory]) {
        findings.push({
          category: PII_CATEGORY[hintCategory],
          source: 'data-attribute',
          confidence: 1.0,
          privacyLevel: 3,
          reason: `Explicit data-sensitive="${el.privacyHint}" attribute`,
        });
      }
    }

    return findings;
  }


  // ─── Keyword Lists for Label/Name Matching ─────────────────────────────────

  const EMAIL_KEYWORDS    = ['email', 'e-mail', 'mail', 'correo'];
  const PHONE_KEYWORDS    = ['phone', 'mobile', 'tel', 'cell', 'contact number', 'whatsapp'];
  const OTP_KEYWORDS      = ['otp', 'one-time', 'verification code', 'verify', 'pin', '2fa', 'mfa', 'totp'];
  const PAYMENT_KEYWORDS  = ['card', 'credit', 'debit', 'cvv', 'cvc', 'expiry', 'payment', 'billing'];
  const ACCOUNT_KEYWORDS  = ['account', 'acct', 'consumer id', 'customer id', 'member id', 'subscriber'];
  const GOV_ID_KEYWORDS   = ['aadhaar', 'aadhar', 'pan', 'passport', 'voter', 'driving licence',
                             'license', 'ssn', 'social security', 'national id', 'tax id', 'tin'];
  const NAME_KEYWORDS     = ['full name', 'first name', 'last name', 'surname', 'given name',
                             'family name', 'your name', 'username'];
  const ADDRESS_KEYWORDS  = ['address', 'street', 'city', 'state', 'zip', 'postal', 'pin code',
                             'pincode', 'locality', 'district'];


  /** Check if a text string matches any of the keywords */
  function matchesKeyword(text, keywords) {
    if (!text) return false;
    return keywords.some(kw => text.includes(kw));
  }


  // ─── Text Pattern Detection (Layer 2 lite) ────────────────────────────────

  /**
   * Detect common PII patterns in a raw text string.
   * These are conservative regex patterns — the full OCR pipeline (Layer 2)
   * and visual detection (Layer 3) will provide deeper coverage later.
   */
  function detectPatternsInText(text) {
    const findings = [];
    if (!text || text.length < 3) return findings;

    // Email pattern
    if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) {
      findings.push({
        category: PII_CATEGORY.EMAIL,
        source: 'text-pattern',
        confidence: 0.95,
        privacyLevel: 2,
        reason: 'Email pattern detected in text',
      });
    }

    // Phone number patterns (Indian + international)
    if (/(?:\+?\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/.test(text) &&
        /\d/.test(text) && text.replace(/\D/g, '').length >= 10) {
      findings.push({
        category: PII_CATEGORY.PHONE,
        source: 'text-pattern',
        confidence: 0.70,
        privacyLevel: 2,
        reason: 'Phone number pattern detected in text',
      });
    }

    // Aadhaar pattern (12 digits, often formatted as XXXX XXXX XXXX)
    if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text) && text.replace(/\D/g, '').length === 12) {
      findings.push({
        category: PII_CATEGORY.GOVERNMENT_ID,
        source: 'text-pattern',
        confidence: 0.70,
        privacyLevel: 3,
        reason: 'Aadhaar-like 12-digit pattern detected',
      });
    }

    // PAN pattern (ABCDE1234F)
    if (/\b[A-Z]{5}\d{4}[A-Z]\b/.test(text)) {
      findings.push({
        category: PII_CATEGORY.GOVERNMENT_ID,
        source: 'text-pattern',
        confidence: 0.85,
        privacyLevel: 3,
        reason: 'PAN-like pattern detected',
      });
    }

    // Credit card pattern (13-19 digits, possibly grouped)
    if (/\b(?:\d[ -]*?){13,19}\b/.test(text)) {
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
        findings.push({
          category: PII_CATEGORY.PAYMENT_DATA,
          source: 'text-pattern',
          confidence: 0.85,
          privacyLevel: 3,
          reason: 'Credit card number pattern (Luhn valid)',
        });
      }
    }

    return findings;
  }

  /** Luhn algorithm check for credit card numbers */
  function luhnCheck(numStr) {
    let sum = 0;
    let alternate = false;
    for (let i = numStr.length - 1; i >= 0; i--) {
      let n = parseInt(numStr[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Browser Action Executor (Section 14 & 15 of blueprint)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a validated browser action from the server's structured plan.
   * 
   * SAFETY: This function performs a second local policy check before
   * executing any action, especially TYPE actions into sensitive fields.
   * The background worker validates first; this is the defense-in-depth layer.
   */
  function executeAction(action) {
    const t0 = now();
    audit('action_execution_started', { actionType: action.type });

    try {
      switch (action.type) {
        case ACTION_TYPE.CLICK:
          return executeClick(action);
        case ACTION_TYPE.SCROLL:
          return executeScroll(action);
        case ACTION_TYPE.NAVIGATE:
          return executeNavigate(action);
        case ACTION_TYPE.FOCUS:
          return executeFocus(action);
        case ACTION_TYPE.TYPE:
          return executeType(action);
        case ACTION_TYPE.SELECT:
          return executeSelect(action);
        case ACTION_TYPE.WAIT:
          return executeWait(action);
        case ACTION_TYPE.PRESS_KEY:
          return executePressKey(action);
        default:
          return { success: false, error: `Unknown action type: ${action.type}` };
      }
    } catch (err) {
      audit('action_execution_error', { error: err.message });
      return { success: false, error: err.message };
    } finally {
      const elapsed = now() - t0;
      audit('action_execution_complete', {
        actionType: action.type,
        elapsedMs: Math.round(elapsed * 100) / 100,
      });
    }
  }

  /** Resolve a target element from various selectors */
  function resolveTarget(target) {
    if (!target) return null;

    // By CSS selector
    if (target.selector) {
      const el = document.querySelector(target.selector);
      if (el) return el;
    }

    // By text content + optional tag
    if (target.text) {
      const candidates = document.querySelectorAll(target.tag || '*');
      for (const el of candidates) {
        if (el.textContent.trim().includes(target.text.trim())) {
          if (isInViewport(el) && !isVisuallyHidden(el)) return el;
        }
      }
    }

    // By bounding box center (find element at point)
    if (target.bbox && target.bbox.length === 4) {
      const [x, y, w, h] = target.bbox;
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const el = document.elementFromPoint(centerX, centerY);
      if (el) return el;
    }

    return null;
  }

  function executeClick(action) {
    const el = resolveTarget(action.target);
    if (!el) return { success: false, error: 'Target element not found' };

    // Scroll into view if needed
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Dispatch real mouse events for frameworks that listen to them
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.click();

    return { success: true, target: buildCSSSelector(el) };
  }

  function executeScroll(action) {
    const amount = action.amount || 300;
    const direction = (action.direction || 'DOWN').toUpperCase();
    const options = { behavior: 'smooth' };

    switch (direction) {
      case 'DOWN':  window.scrollBy({ ...options, top: amount }); break;
      case 'UP':    window.scrollBy({ ...options, top: -amount }); break;
      case 'LEFT':  window.scrollBy({ ...options, left: -amount }); break;
      case 'RIGHT': window.scrollBy({ ...options, left: amount }); break;
    }

    return { success: true, direction, amount };
  }

  function executeNavigate(action) {
    if (action.url) {
      window.location.href = action.url;
      return { success: true, url: action.url };
    }
    if (action.back) {
      window.history.back();
      return { success: true, back: true };
    }
    if (action.forward) {
      window.history.forward();
      return { success: true, forward: true };
    }
    return { success: false, error: 'No navigation target specified' };
  }

  function executeFocus(action) {
    const el = resolveTarget(action.target);
    if (!el) return { success: false, error: 'Target element not found' };
    el.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { success: true, target: buildCSSSelector(el) };
  }

  function executeType(action) {
    const el = resolveTarget(action.target);
    if (!el) return { success: false, error: 'Target element not found' };

    // ─── SAFETY CHECK: Block typing into sensitive fields ───────────
    const inputType = (el.type || '').toLowerCase();
    const autocomplete = (el.autocomplete || '').toLowerCase();

    if (BLOCKED_INPUT_TYPES.includes(inputType) || BLOCKED_INPUT_TYPES.includes(autocomplete)) {
      audit('action_blocked', {
        reason: 'Attempted TYPE into sensitive field',
        inputType,
        autocomplete,
      });
      return {
        success: false,
        blocked: true,
        error: `BLOCKED: Cannot type into sensitive field (type=${inputType}, autocomplete=${autocomplete})`,
      };
    }

    // Also check label-based heuristics
    const label = resolveLabel(el) || '';
    const sensitiveLabels = [...OTP_KEYWORDS, 'password', 'secret', 'cvv', 'cvc'];
    if (sensitiveLabels.some(kw => label.toLowerCase().includes(kw))) {
      audit('action_blocked', {
        reason: 'Attempted TYPE into field with sensitive label',
        label,
      });
      return {
        success: false,
        blocked: true,
        error: `BLOCKED: Cannot type into field labelled "${label}"`,
      };
    }

    // Focus and clear if requested
    el.focus();
    if (action.clear) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Sanitize text: strip instruction phrases if present in typed string
    let text = action.text || '';
    text = text.replace(/\s*(?:and\s+press\s+enter|and\s+hit\s+enter|and\s+press\s+return|\\n|\n)\s*/gi, '').trim();

    // Simulate key-by-key input for framework compatibility (React, Angular, YouTube SPAs)
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set || Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, (action.clear ? '' : el.value) + text);
    } else {
      el.value = (action.clear ? '' : el.value) + text;
    }

    // Trigger 'input' and 'change' events so YouTube and SPAs register the typed text
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, target: buildCSSSelector(el), length: text.length };
  }

  function executeSelect(action) {
    const el = resolveTarget(action.target);
    if (!el || el.tagName.toLowerCase() !== 'select') {
      return { success: false, error: 'Target is not a <select> element' };
    }

    const option = Array.from(el.options).find(o =>
      o.value === action.value || o.text.trim() === action.text
    );
    if (!option) return { success: false, error: 'Option not found' };

    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, value: option.value, text: option.text };
  }

  function executeWait(action) {
    const ms = Math.min(action.duration || 1000, 10000); // cap at 10s
    return new Promise(resolve => {
      setTimeout(() => resolve({ success: true, waitedMs: ms }), ms);
    });
  }

  /**
   * Execute a PRESS_KEY action — dispatches synthetic keydown, keypress (for printable/Enter),
   * and keyup events on the target element (or activeElement / body as fallback).
   * Designed to trigger YouTube and other SPA event listeners reliably.
   */
  function executePressKey(action) {
    const keyName = action.key || 'Enter';
    const el = resolveTarget(action.target) || document.activeElement || document.body;

    // Map common key names to their codes and keyCode values
    const keyMap = {
      'Enter':     { code: 'Enter',     keyCode: 13 },
      'Escape':    { code: 'Escape',    keyCode: 27 },
      'Tab':       { code: 'Tab',       keyCode: 9  },
      'Backspace': { code: 'Backspace', keyCode: 8  },
      'ArrowDown': { code: 'ArrowDown', keyCode: 40 },
      'ArrowUp':   { code: 'ArrowUp',   keyCode: 38 },
      'ArrowLeft': { code: 'ArrowLeft', keyCode: 37 },
      'ArrowRight':{ code: 'ArrowRight',keyCode: 39 },
      'Space':     { code: 'Space',     keyCode: 32 },
    };

    const mapped = keyMap[keyName] || { code: keyName, keyCode: 0 };

    const commonProps = {
      key: keyName,
      code: mapped.code,
      keyCode: mapped.keyCode,
      which: mapped.keyCode,
      bubbles: true,
      cancelable: true,
    };

    // Dispatch synthetic keydown event
    el.dispatchEvent(new KeyboardEvent('keydown', commonProps));

    // Dispatch keypress (for Enter and printable keys — some sites listen for it)
    if (keyName === 'Enter' || keyName.length === 1) {
      el.dispatchEvent(new KeyboardEvent('keypress', commonProps));
    }

    // Dispatch keyup
    el.dispatchEvent(new KeyboardEvent('keyup', commonProps));

    // Dedicated submission handler for Enter on YouTube and standard web forms
    if (keyName === 'Enter') {
      if (el.form) {
        const submitBtn = el.form.querySelector('[type="submit"], button:not([type="button"]):not([type="reset"]), #search-icon-legacy');
        if (submitBtn) {
          submitBtn.click();
        } else if (typeof el.form.requestSubmit === 'function') {
          try { el.form.requestSubmit(); } catch (_) { el.form.submit(); }
        } else {
          el.form.submit();
        }
      } else {
        // Fallback for YouTube or SPA search inputs without a formal <form>
        const searchBtn = document.querySelector('#search-icon-legacy, button[id*="search"], button[aria-label*="Search" i]');
        if (searchBtn && (el.tagName === 'INPUT' || el.getAttribute('role') === 'textbox' || el.name === 'search_query' || el.id === 'search')) {
          searchBtn.click();
        }
      }
    }

    return { success: true, key: keyName, target: buildCSSSelector(el) };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // Message Handler — Communication with Background Service Worker
  // ═══════════════════════════════════════════════════════════════════════════

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    switch (message.type) {
      // ─── Background requests DOM extraction ─────────────────────────
      case MSG.EXTRACT_DOM: {
        const domContext = extractDOM();
        const piiResult = scanDOMForPII(domContext);
        sendResponse({
          success: true,
          domContext,
          piiResult,
        });
        return false; // synchronous response
      }

      // ─── Background requests action execution ──────────────────────
      case MSG.EXECUTE_ACTION: {
        const action = message.payload;
        Promise.resolve(executeAction(action))
          .then(result => sendResponse({ success: true, result }))
          .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open for async response
      }

      // ─── Background requests page state info ──────────────────────
      case MSG.GET_PIPELINE_STATE: {
        sendResponse({
          success: true,
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
        });
        return false;
      }

      default:
        return false;
    }
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════════════════════════════════

  audit('content_script_loaded', {
    url: window.location.href,
    title: document.title,
  });

  // Expose for debugging in development (removed in production build)
  return {
    extractDOM,
    scanDOMForPII,
    executeAction,
    _version: '0.1.0',
  };
})();
