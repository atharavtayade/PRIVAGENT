/**
 * PRIVAGENT — Popup Controller
 */

import { MSG } from '../shared/constants.js';

const popupTaskInput = document.getElementById('popupTaskInput');
const btnPopupRun = document.getElementById('btnPopupRun');
const btnOpenSidepanel = document.getElementById('btnOpenSidepanel');
const summaryState = document.getElementById('summaryState');

document.addEventListener('DOMContentLoaded', () => {
  // Query status from service worker
  chrome.runtime.sendMessage({ type: MSG.GET_PIPELINE_STATE }, (resp) => {
    if (resp?.pipelineState) {
      summaryState.textContent = resp.pipelineState;
    }
  });

  // Run task
  btnPopupRun.addEventListener('click', () => {
    const task = popupTaskInput.value.trim();
    if (!task) return;

    chrome.runtime.sendMessage({
      type: MSG.TASK_SUBMIT,
      payload: { task }
    }, () => {
      // Auto open side panel to observe live execution
      chrome.runtime.sendMessage({ type: MSG.OPEN_SIDEPANEL });
      window.close();
    });
  });

  popupTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnPopupRun.click();
  });

  // Open side panel
  btnOpenSidepanel.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MSG.OPEN_SIDEPANEL });
    window.close();
  });
});
