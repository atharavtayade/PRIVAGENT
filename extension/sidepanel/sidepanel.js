/**
 * PRIVAGENT — Sidepanel Controller
 * 
 * Signature SIH Dashboard orchestrating:
 *   - Human View vs AI Server View live screen visualization
 *   - Synchronized redaction inspection tooltip
 *   - Live Privacy Firewall Gate status
 *   - Client-side latency metrics tracking (5 official evaluation pillars)
 *   - Observable execution audit timeline
 */

import { MSG, PIPELINE_STATE, POLICY_MODE } from '../shared/constants.js';

// DOM Elements
const taskInput = document.getElementById('taskInput');
const btnRunTask = document.getElementById('btnRunTask');
const btnAbortTask = document.getElementById('btnAbortTask');
const policySelect = document.getElementById('policySelect');
const firewallBadge = document.getElementById('firewallBadge');
const firewallStatusText = document.getElementById('firewallStatusText');

// Stepper
const stepCapture = document.getElementById('stepCapture');
const stepDetect = document.getElementById('stepDetect');
const stepRedact = document.getElementById('stepRedact');
const stepTransmit = document.getElementById('stepTransmit');
const stepExecute = document.getElementById('stepExecute');

// Split View
const splitViewport = document.getElementById('splitViewport');
const humanPane = document.getElementById('humanPane');
const aiPane = document.getElementById('aiPane');
const humanImg = document.getElementById('humanImg');
const aiImg = document.getElementById('aiImg');
const humanOverlay = document.getElementById('humanOverlay');
const aiOverlay = document.getElementById('aiOverlay');
const inspectorBar = document.getElementById('inspectorBar');

// Toggles
const toggleSplit = document.getElementById('toggleSplit');
const toggleHuman = document.getElementById('toggleHuman');
const toggleAi = document.getElementById('toggleAi');

// Metrics
const iterationBadge = document.getElementById('iterationBadge');
const metricPiiCount = document.getElementById('metricPiiCount');
const metricRedactCount = document.getElementById('metricRedactCount');
const metricLocalMs = document.getElementById('metricLocalMs');
const metricRawSent = document.getElementById('metricRawSent');

// Timeline
const timelineList = document.getElementById('timelineList');
const btnClearAudit = document.getElementById('btnClearAudit');

let currentRedactions = [];

// ─── Initialize ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  loadInitialState();
});

function setupEventListeners() {
  btnRunTask.addEventListener('click', handleRunTask);
  btnAbortTask.addEventListener('click', handleAbortTask);
  btnClearAudit.addEventListener('click', () => {
    timelineList.innerHTML = '<div class="timeline-empty">Audit log cleared.</div>';
  });

  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleRunTask();
  });

  // Policy selector
  policySelect.addEventListener('change', () => {
    const mode = policySelect.value;
    chrome.storage.local.set({ privagent_policy: { mode } });
    appendAuditEntry({
      timestamp: new Date().toISOString(),
      event: 'policy_changed',
      mode,
    });
  });

  // View toggles
  toggleSplit.addEventListener('click', () => setViewMode('split'));
  toggleHuman.addEventListener('click', () => setViewMode('human'));
  toggleAi.addEventListener('click', () => setViewMode('ai'));
}

function setViewMode(mode) {
  [toggleSplit, toggleHuman, toggleAi].forEach(b => b.classList.remove('active'));

  if (mode === 'split') {
    toggleSplit.classList.add('active');
    splitViewport.style.gridTemplateColumns = '1fr 1fr';
    humanPane.style.display = 'flex';
    aiPane.style.display = 'flex';
  } else if (mode === 'human') {
    toggleHuman.classList.add('active');
    splitViewport.style.gridTemplateColumns = '1fr';
    humanPane.style.display = 'flex';
    aiPane.style.display = 'none';
  } else if (mode === 'ai') {
    toggleAi.classList.add('active');
    splitViewport.style.gridTemplateColumns = '1fr';
    humanPane.style.display = 'none';
    aiPane.style.display = 'flex';
  }
}

// ─── Actions ────────────────────────────────────────────────────────────────
function handleRunTask() {
  const task = taskInput.value.trim();
  if (!task) return;

  btnRunTask.classList.add('hidden');
  btnAbortTask.classList.remove('hidden');

  appendAuditEntry({
    timestamp: new Date().toISOString(),
    event: 'task_submitted',
    task,
  });

  chrome.runtime.sendMessage({
    type: MSG.TASK_SUBMIT,
    payload: { task },
  }, (resp) => {
    if (chrome.runtime.lastError || !resp?.success) {
      appendAuditEntry({
        timestamp: new Date().toISOString(),
        event: 'task_start_error',
        error: chrome.runtime.lastError?.message || resp?.error,
      });
      resetTaskControls();
    }
  });
}

function handleAbortTask() {
  chrome.runtime.sendMessage({ type: MSG.TASK_ABORT }, () => {
    resetTaskControls();
    appendAuditEntry({
      timestamp: new Date().toISOString(),
      event: 'task_aborted',
    });
  });
}

function resetTaskControls() {
  btnRunTask.classList.remove('hidden');
  btnAbortTask.classList.add('hidden');
}

// ─── State & Status Listener ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;

  switch (message.type) {
    case MSG.AGENT_LOOP_STATUS:
      updateDashboard(message.payload);
      break;

    case MSG.TASK_STATUS:
      if (message.payload.status === 'complete' || message.payload.status === 'error') {
        resetTaskControls();
      }
      break;

    case MSG.AUDIT_EVENT:
      appendAuditEntry(message.payload);
      break;
  }
});

async function loadInitialState() {
  try {
    chrome.runtime.sendMessage({ type: MSG.PRIVACY_STATUS }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.policyMode) policySelect.value = response.policyMode;
      updateDashboard(response);

      if (response.auditLog && Array.isArray(response.auditLog)) {
        timelineList.innerHTML = '';
        response.auditLog.forEach(appendAuditEntry);
      }
    });
  } catch (_) {}
}

function updateDashboard(data) {
  if (!data) return;

  // 1. Pipeline State & Stepper
  updateStepper(data.pipelineState);

  // 2. Firewall Badge Status
  if (data.networkAllowed) {
    firewallBadge.style.borderColor = 'rgba(6, 182, 212, 0.4)';
    firewallBadge.style.color = '#38bdf8';
    firewallStatusText.textContent = 'GATE: SANITIZED TRANSMISSION';
  } else {
    firewallBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    firewallBadge.style.color = '#10b981';
    firewallStatusText.textContent = 'GATE: SECURE (PROTECTED)';
  }

  // 3. Iteration
  if (data.iteration !== undefined) {
    iterationBadge.textContent = `Iter: ${data.iteration}/20`;
  }

  // 4. Metrics
  if (data.lastPiiScan) {
    metricPiiCount.textContent = data.lastPiiScan.detectionCount ?? 0;
    metricLocalMs.innerHTML = `${Math.round(data.lastPiiScan.scanMs || 0)} <span class="unit">ms</span>`;
  }

  if (data.privacy) {
    metricRedactCount.textContent = data.privacy.totalRedactions ?? 0;
  }

  // 5. Screenshots (Dual View)
  if (data.rawScreenshot) {
    humanImg.src = data.rawScreenshot;
    humanImg.alt = 'Human View — raw screen';
  } else {
    humanImg.removeAttribute('src');
    humanImg.alt = 'No screenshot available — using DOM-only perception';
  }
  if (data.sanitizedScreenshot) {
    aiImg.src = data.sanitizedScreenshot;
    aiImg.alt = 'AI Server View — sanitized screen';
  } else {
    aiImg.removeAttribute('src');
    aiImg.alt = 'No sanitized screenshot available';
  }

  // 6. Redactions & Interactive Overlays
  if (data.piiScan?.detections) {
    currentRedactions = data.piiScan.detections;
    renderBoundingOverlays(data.piiScan.detections);
  }
}

function updateStepper(state) {
  const steps = [stepCapture, stepDetect, stepRedact, stepTransmit, stepExecute];
  steps.forEach(s => s.classList.remove('active'));

  switch (state) {
    case PIPELINE_STATE.RAW_CONTEXT_CREATED:
      stepCapture.classList.add('active');
      break;
    case PIPELINE_STATE.PII_SCAN_COMPLETE:
      stepCapture.classList.add('active');
      stepDetect.classList.add('active');
      break;
    case PIPELINE_STATE.REDACTION_COMPLETE:
    case PIPELINE_STATE.SANITIZED_CONTEXT_READY:
      stepCapture.classList.add('active');
      stepDetect.classList.add('active');
      stepRedact.classList.add('active');
      break;
    case PIPELINE_STATE.NETWORK_REQUEST_ALLOWED:
    case PIPELINE_STATE.SERVER_RESPONSE_RECEIVED:
      stepCapture.classList.add('active');
      stepDetect.classList.add('active');
      stepRedact.classList.add('active');
      stepTransmit.classList.add('active');
      break;
    case PIPELINE_STATE.ACTION_VALIDATED:
    case PIPELINE_STATE.ACTION_EXECUTED:
      steps.forEach(s => s.classList.add('active'));
      break;
    // IDLE or unknown: all steps remain inactive (no false "active" indicators)
    default:
      break;
  }
}

// ─── Synchronized Inspection Overlays ───────────────────────────────────────
function renderBoundingOverlays(detections) {
  humanOverlay.innerHTML = '';
  if (!detections || detections.length === 0) return;

  const rect = humanImg.getBoundingClientRect();
  const naturalW = humanImg.naturalWidth || rect.width;
  const naturalH = humanImg.naturalHeight || rect.height;
  if (!naturalW || !naturalH) return;

  const scaleX = rect.width / naturalW;
  const scaleY = rect.height / naturalH;

  detections.forEach((det, idx) => {
    if (!det.bbox || det.bbox.length !== 4) return;
    const [x, y, w, h] = det.bbox;

    const box = document.createElement('div');
    box.className = 'highlight-box';
    box.style.left = `${x * scaleX}px`;
    box.style.top = `${y * scaleY}px`;
    box.style.width = `${w * scaleX}px`;
    box.style.height = `${h * scaleY}px`;

    box.addEventListener('mouseenter', () => {
      inspectorBar.innerHTML = `
        <span class="inspector-badge">[${det.category}]</span>
        &nbsp;Reason: ${det.reason || 'Protected field'} &bull;
        Level: ${det.privacyLevel || 2} &bull;
        Network: <strong>NEVER TRANSMITTED</strong>
      `;
    });

    box.addEventListener('mouseleave', () => {
      inspectorBar.innerHTML = '<span class="inspector-prompt">Hover or click any redacted region above for verification details</span>';
    });

    humanOverlay.appendChild(box);
  });
}

// ─── Audit Trail Renderer ───────────────────────────────────────────────────
function appendAuditEntry(entry) {
  if (!entry) return;

  // Clear placeholder if present
  const empty = timelineList.querySelector('.timeline-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  const isSecurity = entry.event?.includes('gate') || entry.event?.includes('redaction') || entry.event?.includes('blocked');
  item.className = `timeline-entry ${isSecurity ? 'security' : ''}`;

  const timeStr = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  const desc = entry.event || 'event';
  const detailStr = formatDetail(entry);

  item.innerHTML = `
    <span class="timeline-time">${timeStr}</span>
    <span class="timeline-msg"><strong>${desc}</strong> ${detailStr}</span>
  `;

  timelineList.appendChild(item);
  timelineList.scrollTop = timelineList.scrollHeight;
}

function formatDetail(entry) {
  const omit = ['timestamp', 'event', 'pipelineState', 'iteration', 'perfMs'];
  const keys = Object.keys(entry).filter(k => !omit.includes(k));
  if (keys.length === 0) return '';
  const parts = keys.map(k => `${k}=${JSON.stringify(entry[k])}`);
  return `(${parts.join(', ')})`;
}
