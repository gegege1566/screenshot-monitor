let region = null;
let thumbItems = [];
let lbIndex = -1; // current lightbox index

// Keep region in sync when overlay moves/resizes it
window.api.onRegionUpdated((r) => {
  region = r;
  document.getElementById('status').textContent =
    `領域: ${region.width}x${region.height} (${region.left}, ${region.top})`;
});

// --- Setup View ---

async function selectRegion() {
  const result = await window.api.selectRegion();
  if (result) {
    region = result;
    document.getElementById('status').textContent =
      `領域: ${region.width}x${region.height} (${region.left}, ${region.top})`;
    document.getElementById('btn-start').disabled = false;
  } else {
    document.getElementById('status').textContent = 'キャンセルされました';
  }
}

async function startMonitoring() {
  const config = {
    region,
    interval: parseFloat(document.getElementById('interval').value) || 3,
    thresholdPct: parseFloat(document.getElementById('threshold').value) || 15,
    pixelThreshold: parseInt(document.getElementById('pixel-threshold').value) || 30,
  };

  window.api.removeAllListeners('capture');
  window.api.removeAllListeners('monitoring-stopped');

  window.api.onMonitoringStopped(() => {
    showResults();
  });

  await window.api.startMonitoring(config);
}

async function loadFolder() {
  const result = await window.api.loadFolder();
  if (result && result.images.length > 0) {
    showResultsWithImages(result.images, result.folder);
  }
}

// --- Results View ---

function showResults() {
  window.api.removeAllListeners('capture');
  document.getElementById('setup-view').style.display = 'none';
  document.getElementById('results-view').style.display = 'flex';
}

function showResultsWithImages(imagePaths, sourceLabel) {
  document.getElementById('setup-view').style.display = 'none';
  document.getElementById('results-view').style.display = 'flex';

  thumbItems = imagePaths.map(filepath => ({
    filepath,
    selected: true,
  }));

  renderThumbnails();
  document.getElementById('source-label').textContent = sourceLabel || '';
  updateCount();
}

function renderThumbnails() {
  const grid = document.getElementById('thumbnail-grid');
  grid.innerHTML = '';

  thumbItems.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = `thumb-item ${item.selected ? 'selected' : 'deselected'}`;
    // Click handled by drag system - short click = toggle, drag = range select

    // Check mark
    const check = document.createElement('div');
    check.className = 'check-mark';
    check.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="7" x2="6" y2="10"/><line x1="6" y1="10" x2="11" y2="4"/></svg>';
    div.appendChild(check);

    const img = document.createElement('img');
    img.src = `file://${item.filepath.replace(/\\/g, '/')}`;
    img.loading = 'lazy';
    div.appendChild(img);

    // Zoom button with SVG icon
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'zoom-btn';
    zoomBtn.title = '拡大表示';
    zoomBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20"/></svg>';
    zoomBtn.onclick = (e) => {
      e.stopPropagation();
      openLightbox(idx);
    };
    div.appendChild(zoomBtn);

    // Timestamp
    const name = item.filepath.replace(/\\/g, '/').split('/').pop().replace(/\.\w+$/, '');
    let display = name;
    if (name.startsWith('screenshot_') && name.length >= 24) {
      const ts = name.substring(11);
      display = `${ts.substring(4,6)}/${ts.substring(6,8)} ${ts.substring(8,10)}:${ts.substring(10,12)}:${ts.substring(12,14)}`;
    }
    const label = document.createElement('div');
    label.className = 'timestamp';
    label.textContent = display;
    div.appendChild(label);

    grid.appendChild(div);
  });
}

function toggleSelection(idx) {
  thumbItems[idx].selected = !thumbItems[idx].selected;
  const items = document.querySelectorAll('.thumb-item');
  items[idx].className = `thumb-item ${thumbItems[idx].selected ? 'selected' : 'deselected'}`;
  updateCount();
  // Update lightbox button if open
  if (lbIndex === idx) {
    updateLbSelBtn();
  }
}

function selectAll() {
  thumbItems.forEach(it => it.selected = true);
  document.querySelectorAll('.thumb-item').forEach(el => {
    el.className = 'thumb-item selected';
  });
  updateCount();
}

function deselectAll() {
  thumbItems.forEach(it => it.selected = false);
  document.querySelectorAll('.thumb-item').forEach(el => {
    el.className = 'thumb-item deselected';
  });
  updateCount();
}

function updateCount() {
  const total = thumbItems.length;
  const selected = thumbItems.filter(it => it.selected).length;
  document.getElementById('count-label').textContent = `画像: ${total}  選択: ${selected}`;
}

async function exportPdf() {
  const selected = thumbItems.filter(it => it.selected).map(it => it.filepath).sort();
  if (!selected.length) {
    alert('画像が選択されていません');
    return;
  }

  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
  const outputPath = await window.api.saveFileDialog(`screenshots_${ts}.pdf`);
  if (!outputPath) return;

  const count = await window.api.exportPdf(selected, outputPath);
  alert(`${count}枚をPDFに書き出しました\n${outputPath}`);
}

function newSession() {
  thumbItems = [];
  region = null;
  document.getElementById('thumbnail-grid').innerHTML = '';
  document.getElementById('results-view').style.display = 'none';
  document.getElementById('setup-view').style.display = 'block';
  document.getElementById('btn-start').disabled = true;
  document.getElementById('status').textContent = 'キャプチャ領域を選択してください';
  window.api.resetWindow();
}

// --- Lightbox ---

function openLightbox(idx) {
  lbIndex = idx;
  document.getElementById('lightbox').style.display = 'flex';
  updateLightbox();
  document.addEventListener('keydown', lbKeyHandler);
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  lbIndex = -1;
  document.removeEventListener('keydown', lbKeyHandler);
}

function lbPrev() {
  if (lbIndex > 0) {
    lbIndex--;
    updateLightbox();
  }
}

function lbNext() {
  if (lbIndex < thumbItems.length - 1) {
    lbIndex++;
    updateLightbox();
  }
}

function lbKeyHandler(e) {
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') lbPrev();
  else if (e.key === 'ArrowRight') lbNext();
  else if (e.key === ' ') { e.preventDefault(); lbToggleSelection(); }
}

function updateLightbox() {
  const item = thumbItems[lbIndex];
  document.getElementById('lb-img').src = `file://${item.filepath.replace(/\\/g, '/')}`;
  document.getElementById('lb-counter').textContent = `${lbIndex + 1} / ${thumbItems.length}`;

  const name = item.filepath.replace(/\\/g, '/').split('/').pop().replace(/\.\w+$/, '');
  let display = name;
  if (name.startsWith('screenshot_') && name.length >= 24) {
    const ts = name.substring(11);
    display = `${ts.substring(4,6)}/${ts.substring(6,8)} ${ts.substring(8,10)}:${ts.substring(10,12)}:${ts.substring(12,14)}`;
  }
  document.getElementById('lb-timestamp').textContent = display;

  document.getElementById('lb-prev').style.visibility = lbIndex > 0 ? 'visible' : 'hidden';
  document.getElementById('lb-next').style.visibility = lbIndex < thumbItems.length - 1 ? 'visible' : 'hidden';

  updateLbSelBtn();
}

function updateLbSelBtn() {
  const btn = document.getElementById('lb-toggle-sel');
  const check = document.getElementById('lb-check');
  const item = thumbItems[lbIndex];
  if (item.selected) {
    btn.textContent = '選択解除';
    btn.className = '';
    check.className = 'lb-check selected';
  } else {
    btn.textContent = '選択する';
    btn.className = 'is-deselected';
    check.className = 'lb-check deselected';
  }
}

function lbToggleSelection() {
  toggleSelection(lbIndex);
  updateLbSelBtn();
}

// Close lightbox on backdrop click
document.getElementById('lb-backdrop').addEventListener('click', closeLightbox);

// --- Drag to select/deselect + click to toggle ---
(function initDragSelect() {
  let dragging = false;
  let didDrag = false;
  let startX = 0, startY = 0;
  let dragMode = null;
  let clickTargetIdx = -1;
  const box = document.getElementById('drag-select-box');
  const grid = document.getElementById('thumbnail-grid');
  const container = document.getElementById('grid-container');

  // Left-drag: auto-detect mode from starting item
  // Start on selected item → deselect mode, start on deselected/background → select mode
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // left click only
    if (e.target.closest('.zoom-btn')) return;
    if (!grid.contains(e.target) && e.target !== grid && e.target !== container) return;

    dragging = true;
    didDrag = false;
    startX = e.clientX;
    startY = e.clientY;
    clickTargetIdx = -1;

    const thumbEl = e.target.closest('.thumb-item');
    if (thumbEl) {
      const idx = Array.from(grid.children).indexOf(thumbEl);
      clickTargetIdx = idx;
      dragMode = (idx >= 0 && thumbItems[idx].selected) ? 'deselect' : 'select';
    } else {
      dragMode = 'select';
    }

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);

    if (!didDrag && (dx > 5 || dy > 5)) {
      didDrag = true;
      box.style.display = 'block';
      if (dragMode === 'deselect') {
        box.style.borderColor = '#d94a4a';
        box.style.background = 'rgba(217, 74, 74, 0.1)';
      } else {
        box.style.borderColor = '#4a90d9';
        box.style.background = 'rgba(74, 144, 217, 0.1)';
      }
    }

    if (didDrag) {
      const cr = container.getBoundingClientRect();
      const x1 = Math.min(startX, e.clientX) - cr.left + container.scrollLeft;
      const y1 = Math.min(startY, e.clientY) - cr.top + container.scrollTop;
      box.style.left = x1 + 'px';
      box.style.top = y1 + 'px';
      box.style.width = Math.abs(e.clientX - startX) + 'px';
      box.style.height = Math.abs(e.clientY - startY) + 'px';
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    box.style.display = 'none';

    if (!didDrag) {
      // Short click - toggle the clicked item
      if (clickTargetIdx >= 0) {
        toggleSelection(clickTargetIdx);
      }
      return;
    }

    // Drag completed - apply range selection
    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);

    const items = document.querySelectorAll('.thumb-item');
    items.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      if (rect.right > x1 && rect.left < x2 && rect.bottom > y1 && rect.top < y2) {
        const shouldSelect = (dragMode === 'select');
        if (thumbItems[idx].selected !== shouldSelect) {
          toggleSelection(idx);
        }
      }
    });
  });
})();

// Listen for monitoring-stopped with image list
window.api.removeAllListeners('monitoring-stopped');
window.api.onMonitoringStopped(async () => {
  const root = await window.api.getScreenshotsRoot();
});
