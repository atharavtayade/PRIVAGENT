/**
 * PRIVAGENT — Offscreen Document Coordinator
 * 
 * Bridges Chrome Service Worker messages to HTML5 Canvas and Web Worker resources.
 * 
 * Handles:
 *   1. Image Redaction Requests (visual-redactor.js)
 *   2. Local Vision Worker Inference (vision-worker.js)
 */

import { VisualRedactor } from './visual-redactor.js';

const MSG = Object.freeze({
  OFFSCREEN_REDACT_IMAGE:     'privagent:offscreen-redact-image',
  OFFSCREEN_VISION_INFERENCE: 'privagent:offscreen-vision-inference',
  OFFSCREEN_READY:            'privagent:offscreen-ready',
});

// Create singleton redactor
const redactor = new VisualRedactor();

// Create vision worker
let visionWorker = null;
let pendingWorkerMessages = new Map();
let messageSeq = 0;

function initVisionWorker() {
  try {
    visionWorker = new Worker(chrome.runtime.getURL('offscreen/vision-worker.js'));
    
    visionWorker.onmessage = (event) => {
      const { id, success, ...data } = event.data;
      const resolver = pendingWorkerMessages.get(id);
      if (resolver) {
        pendingWorkerMessages.delete(id);
        if (success) {
          resolver.resolve(data);
        } else {
          resolver.reject(new Error(data.error || 'Vision worker error'));
        }
      }
    };

    visionWorker.onerror = (err) => {
      console.error('[Offscreen] Vision Worker error:', err);
    };

    // Initialize worker with hardware detection
    const initId = ++messageSeq;
    visionWorker.postMessage({ id: initId, type: 'INIT', payload: {} });
  } catch (err) {
    console.warn('[Offscreen] Could not instantiate Vision Worker:', err);
  }
}

initVisionWorker();

// Post message to worker with promise
function callVisionWorker(type, payload) {
  if (!visionWorker) {
    return Promise.reject(new Error('Vision worker not initialized'));
  }
  return new Promise((resolve, reject) => {
    const id = ++messageSeq;
    pendingWorkerMessages.set(id, { resolve, reject });
    visionWorker.postMessage({ id, type, payload });

    // 15s timeout
    setTimeout(() => {
      if (pendingWorkerMessages.has(id)) {
        pendingWorkerMessages.delete(id);
        reject(new Error('Vision worker request timed out'));
      }
    }, 15000);
  });
}

// Listen for messages from background service-worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    // ─── 1. Apply Visual Redaction onto Canvas ───────────────────────
    case MSG.OFFSCREEN_REDACT_IMAGE: {
      const { imageDataUrl, redactions } = message.payload;
      redactor.redactImage(imageDataUrl, redactions)
        .then(result => {
          sendResponse({ success: true, ...result });
        })
        .catch(err => {
          console.error('[Offscreen] Redaction failure:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // asynchronous sendResponse
    }

    // ─── 2. Run Vision Inference via Worker ─────────────────────────
    case MSG.OFFSCREEN_VISION_INFERENCE: {
      const { width, height, domDetections } = message.payload;
      callVisionWorker('INFER', { width, height, domDetections })
        .then(result => {
          sendResponse({ success: true, ...result });
        })
        .catch(err => {
          console.error('[Offscreen] Vision inference failure:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;
    }

    default:
      return false;
  }
});

console.log('[PRIVAGENT] Offscreen Document Coordinator active.');
