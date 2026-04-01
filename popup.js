document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('filterToggle');
  const autoLoadToggle = document.getElementById('autoLoadToggle');
  const compressedToggle = document.getElementById('compressedToggle');
  const hiddenCountEl = document.getElementById('hiddenCount');
  const scannedCountEl = document.getElementById('scannedCount');
  const sensitivitySlider = document.getElementById('sensitivitySlider');
  const sensitivityValue = document.getElementById('sensitivityValue');

  const sensitivityLabels = { 1: 'Relaxed', 2: 'Medium', 3: 'Strict' };

  function updateCounts() {
    chrome.storage.local.get(['hiddenCount', 'scannedCount'], (data) => {
      hiddenCountEl.textContent = data.hiddenCount || 0;
      scannedCountEl.textContent = data.scannedCount || 0;
    });
  }

  function resetCountsUI() {
    hiddenCountEl.textContent = '0';
    scannedCountEl.textContent = '0';
  }

  function sendMessage(msg) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, msg);
      }
    });
  }

  // Load saved state
  chrome.storage.local.get(['filterEnabled', 'autoLoadMore', 'compressedBroetry', 'sensitivity'], (data) => {
    toggle.checked = data.filterEnabled !== false;
    autoLoadToggle.checked = data.autoLoadMore === true;
    compressedToggle.checked = data.compressedBroetry === true;
    sensitivitySlider.value = data.sensitivity || 2;
    sensitivityValue.textContent = sensitivityLabels[data.sensitivity || 2];
  });

  // Load current counts
  updateCounts();

  // Filter toggle
  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    chrome.storage.local.set({ filterEnabled: enabled });
    resetCountsUI();
    sendMessage({ type: 'TOGGLE_FILTER', enabled });
  });

  // Auto-load-more toggle
  autoLoadToggle.addEventListener('change', () => {
    const enabled = autoLoadToggle.checked;
    chrome.storage.local.set({ autoLoadMore: enabled });
    sendMessage({ type: 'TOGGLE_AUTO_LOAD', enabled });
  });

  // Compressed broetry toggle
  compressedToggle.addEventListener('change', () => {
    const enabled = compressedToggle.checked;
    chrome.storage.local.set({ compressedBroetry: enabled });
    resetCountsUI();
    sendMessage({ type: 'TOGGLE_COMPRESSED_BROETRY', enabled });
  });

  // Sensitivity slider
  sensitivitySlider.addEventListener('input', () => {
    const val = parseInt(sensitivitySlider.value);
    sensitivityValue.textContent = sensitivityLabels[val];
    chrome.storage.local.set({ sensitivity: val });
    resetCountsUI();
    sendMessage({ type: 'SET_SENSITIVITY', sensitivity: val });
  });

  // Poll for live count updates
  setInterval(updateCounts, 1000);
});
