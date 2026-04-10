let region = null;
let thumbItems = [];
let lbIndex = -1; // current lightbox index

// --- Load persisted settings ---
(async function initSettings() {
  const settings = await window.api.loadSettings();
  if (settings) {
    if (settings.interval != null) document.getElementById('interval').value = settings.interval;
    if (settings.thresholdPct != null) document.getElementById('threshold').value = settings.thresholdPct;
    if (settings.pixelThreshold != null) document.getElementById('pixel-threshold').value = settings.pixelThreshold;
  }
})();

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

  // Persist settings as new defaults
  window.api.saveSettings({
    interval: config.interval,
    thresholdPct: config.thresholdPct,
    pixelThreshold: config.pixelThreshold,
  });

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

    // In trim mode, handle clicks for range selection only
    if (trimMode) {
      const thumbEl = e.target.closest('.thumb-item');
      if (thumbEl) {
        const idx = Array.from(grid.children).indexOf(thumbEl);
        if (idx >= 0) onThumbnailClickInTrimMode(idx);
      }
      e.preventDefault();
      return;
    }

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

// ============================================================
// --- Trim Mode ---
// ============================================================

let trimMode = false;
let trimGroups = [];     // { id, startIdx, endIdx, crop, color }
let trimPhase = null;    // null | 'start' | 'end'
let trimPendingStart = -1;
let trimGroupCounter = 0;
const TRIM_COLORS = ['#4CAF50','#FF9800','#2196F3','#9C27B0','#F44336','#00BCD4','#795548','#607D8B'];

function enterTrimMode() {
  trimMode = true;
  trimPhase = 'start';
  trimGroups = [];
  trimGroupCounter = 0;
  trimPendingStart = -1;

  document.getElementById('normal-toolbar').style.display = 'none';
  document.getElementById('trim-toolbar').style.display = 'block';
  updateTrimStepGuide();
  renderTrimIndicators();
}

function exitTrimMode() {
  if (trimGroups.length > 0) {
    if (!confirm('トリミングモードを終了します。\n設定したトリミング内容は保存されません。よろしいですか？')) {
      return;
    }
  }
  trimMode = false;
  trimPhase = null;
  trimGroups = [];
  trimPendingStart = -1;

  document.getElementById('trim-toolbar').style.display = 'none';
  document.getElementById('normal-toolbar').style.display = 'flex';
  clearTrimIndicators();
}

function updateTrimStepGuide() {
  const s1 = document.getElementById('trim-step-1');
  const s2 = document.getElementById('trim-step-2');
  const s3 = document.getElementById('trim-step-3');
  const inst = document.getElementById('trim-instruction');

  // Reset
  [s1, s2, s3].forEach(s => { s.className = 'trim-step'; });

  if (trimPhase === 'start') {
    s1.classList.add('active');
    inst.textContent = trimGroups.length > 0
      ? '次のグループの開始画像をクリック、または既存グループをクリックして編集'
      : '';
  } else if (trimPhase === 'end') {
    s1.classList.add('done');
    s2.classList.add('active');
    inst.textContent = '同じ画像をクリックすると1枚だけのグループになります';
  }
}

function getGroupForIndex(idx) {
  return trimGroups.find(g => idx >= g.startIdx && idx <= g.endIdx);
}

function onThumbnailClickInTrimMode(idx) {
  if (trimPhase === 'start') {
    if (getGroupForIndex(idx)) {
      const g = getGroupForIndex(idx);
      openCropEditor(g);
      return;
    }
    trimPendingStart = idx;
    trimPhase = 'end';
    updateTrimStepGuide();
    renderTrimIndicators();
  } else if (trimPhase === 'end') {
    let startIdx = Math.min(trimPendingStart, idx);
    let endIdx = Math.max(trimPendingStart, idx);

    for (let i = startIdx; i <= endIdx; i++) {
      if (getGroupForIndex(i)) {
        alert('指定した範囲は既存のグループと重なっています。\n別の範囲を選択するか、既存グループを削除してください。');
        trimPhase = 'start';
        trimPendingStart = -1;
        updateTrimStepGuide();
        renderTrimIndicators();
        return;
      }
    }

    const color = TRIM_COLORS[trimGroupCounter % TRIM_COLORS.length];
    const group = { id: trimGroupCounter++, startIdx, endIdx, crop: null, color };
    trimGroups.push(group);

    trimPhase = 'start';
    trimPendingStart = -1;
    renderTrimIndicators();
    openCropEditor(group);
  }
}

function renderTrimIndicators() {
  clearTrimIndicators();
  const items = document.querySelectorAll('.thumb-item');

  items.forEach((el, idx) => {
    const group = getGroupForIndex(idx);
    if (group) {
      const indicator = document.createElement('div');
      indicator.className = 'trim-indicator';
      indicator.style.background = group.color;

      if (idx === group.startIdx && idx === group.endIdx) {
        indicator.textContent = `G${group.id + 1}`;
      } else if (idx === group.startIdx) {
        indicator.textContent = `G${group.id + 1} \u25b8`;
      } else if (idx === group.endIdx) {
        indicator.textContent = `\u25c2 G${group.id + 1}`;
      } else {
        indicator.textContent = '\u2500';
      }
      el.appendChild(indicator);
    }

    if (trimPhase === 'end' && idx === trimPendingStart) {
      el.classList.add('trim-start-pending');
    } else {
      el.classList.remove('trim-start-pending');
    }
  });

  updateTrimGroupList();
  updateApplyButton();
}

function clearTrimIndicators() {
  document.querySelectorAll('.trim-indicator').forEach(e => e.remove());
  document.querySelectorAll('.trim-start-pending').forEach(e => e.classList.remove('trim-start-pending'));
}

function updateApplyButton() {
  const btn = document.getElementById('btn-apply-trim');
  const hasValid = trimGroups.some(g => g.crop);
  btn.disabled = !hasValid;
}

function updateTrimGroupList() {
  const list = document.getElementById('trim-group-list');
  list.innerHTML = '';

  trimGroups.forEach(g => {
    const div = document.createElement('div');
    div.className = 'trim-group-item';

    const colorDot = document.createElement('span');
    colorDot.className = 'trim-group-color';
    colorDot.style.background = g.color;
    div.appendChild(colorDot);

    const label = document.createElement('span');
    label.textContent = `G${g.id + 1}: ${g.startIdx + 1}\u301c${g.endIdx + 1}枚目`;
    div.appendChild(label);

    const cropInfo = document.createElement('span');
    cropInfo.className = 'trim-group-crop';
    cropInfo.textContent = g.crop ? `${g.crop.width}x${g.crop.height}` : '\u672a\u8a2d\u5b9a';
    div.appendChild(cropInfo);

    const editBtn = document.createElement('button');
    editBtn.className = 'trim-group-edit';
    editBtn.textContent = '\u7de8\u96c6';
    editBtn.onclick = () => openCropEditor(g);
    div.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'trim-group-delete';
    delBtn.textContent = '\u00d7';
    delBtn.onclick = () => { trimGroups = trimGroups.filter(x => x.id !== g.id); renderTrimIndicators(); };
    div.appendChild(delBtn);

    list.appendChild(div);
  });
}

// ============================================================
// --- Crop Editor ---
// ============================================================

let cropEditorGroup = null;
let cropRect = null;        // { x, y, w, h } in display px
let cropScale = 1;
let cropImgEl = null;
let cropCurrentIdx = -1;    // current image index being previewed

function openCropEditor(group) {
  cropEditorGroup = group;
  cropRect = null;
  cropCurrentIdx = group.startIdx;

  const modal = document.getElementById('crop-editor');
  modal.style.display = 'flex';

  // Step 3 active
  const s1 = document.getElementById('trim-step-1');
  const s2 = document.getElementById('trim-step-2');
  const s3 = document.getElementById('trim-step-3');
  if (s1) { s1.className = 'trim-step done'; }
  if (s2) { s2.className = 'trim-step done'; }
  if (s3) { s3.className = 'trim-step active'; }
  document.getElementById('trim-instruction').textContent = '';

  document.getElementById('crop-range-info').textContent =
    `G${group.id + 1} : ${group.startIdx + 1}\u301c${group.endIdx + 1}\u679a\u76ee (${group.endIdx - group.startIdx + 1}\u679a)`;
  document.getElementById('crop-dimensions').textContent = '';

  const sel = document.getElementById('crop-selection');
  sel.style.display = 'none';

  loadCropImage(cropCurrentIdx);
  updateCropNav();
}

function loadCropImage(idx) {
  const img = document.getElementById('crop-img');
  img.src = `file://${thumbItems[idx].filepath.replace(/\\/g, '/')}?t=${Date.now()}`;

  img.onload = () => {
    cropImgEl = img;
    cropScale = img.naturalWidth / img.clientWidth;
    document.getElementById('crop-dimensions').textContent =
      `\u753b\u50cf\u30b5\u30a4\u30ba: ${img.naturalWidth} \u00d7 ${img.naturalHeight}`;

    // Restore existing crop rect if group has one
    if (cropEditorGroup.crop) {
      cropRect = {
        x: cropEditorGroup.crop.left / cropScale,
        y: cropEditorGroup.crop.top / cropScale,
        w: cropEditorGroup.crop.width / cropScale,
        h: cropEditorGroup.crop.height / cropScale,
      };
    }
    updateCropSelection();
  };
}

function updateCropNav() {
  if (!cropEditorGroup) return;
  const g = cropEditorGroup;
  const posInGroup = cropCurrentIdx - g.startIdx + 1;
  const total = g.endIdx - g.startIdx + 1;

  document.getElementById('crop-nav-counter').textContent =
    `${posInGroup} / ${total}\u679a\u76ee`;

  // Timestamp
  const name = thumbItems[cropCurrentIdx].filepath.replace(/\\/g, '/').split('/').pop().replace(/\.\w+$/, '');
  let display = name;
  if (name.startsWith('screenshot_') && name.length >= 24) {
    const ts = name.substring(11);
    display = `${ts.substring(4,6)}/${ts.substring(6,8)} ${ts.substring(8,10)}:${ts.substring(10,12)}:${ts.substring(12,14)}`;
  }
  document.getElementById('crop-nav-timestamp').textContent = display;

  // Nav buttons
  document.getElementById('crop-prev').disabled = (cropCurrentIdx <= g.startIdx);
  document.getElementById('crop-next').disabled = (cropCurrentIdx >= g.endIdx);

  // Selection toggle
  updateCropSelToggle();
}

function updateCropSelToggle() {
  const btn = document.getElementById('crop-sel-toggle');
  const item = thumbItems[cropCurrentIdx];
  if (item.selected) {
    btn.textContent = '\u2714 \u9078\u629e\u4e2d';
    btn.className = 'crop-sel-toggle is-selected';
  } else {
    btn.textContent = '\u2716 \u975e\u9078\u629e';
    btn.className = 'crop-sel-toggle is-deselected';
  }
}

function cropToggleSelection() {
  toggleSelection(cropCurrentIdx);
  updateCropSelToggle();
}

function cropPrev() {
  if (!cropEditorGroup || cropCurrentIdx <= cropEditorGroup.startIdx) return;
  cropCurrentIdx--;
  loadCropImage(cropCurrentIdx);
  updateCropNav();
}

function cropNext() {
  if (!cropEditorGroup || cropCurrentIdx >= cropEditorGroup.endIdx) return;
  cropCurrentIdx++;
  loadCropImage(cropCurrentIdx);
  updateCropNav();
}

function confirmCropEditor() {
  if (!cropRect || Math.abs(cropRect.w) < 5 || Math.abs(cropRect.h) < 5) {
    alert('\u30c8\u30ea\u30df\u30f3\u30b0\u7bc4\u56f2\u3092\u30c9\u30e9\u30c3\u30b0\u3067\u63cf\u753b\u3057\u3066\u304f\u3060\u3055\u3044');
    return;
  }

  const r = normalizeCropRect(cropRect);

  cropEditorGroup.crop = {
    left: Math.round(r.x * cropScale),
    top: Math.round(r.y * cropScale),
    width: Math.round(r.w * cropScale),
    height: Math.round(r.h * cropScale),
  };

  document.getElementById('crop-editor').style.display = 'none';
  cropEditorGroup = null;
  cropCurrentIdx = -1;
  trimPhase = 'start';
  updateTrimStepGuide();
  renderTrimIndicators();
}

function cancelCropEditor() {
  const group = cropEditorGroup;
  if (group && !group.crop) {
    trimGroups = trimGroups.filter(g => g.id !== group.id);
  }
  document.getElementById('crop-editor').style.display = 'none';
  cropEditorGroup = null;
  cropCurrentIdx = -1;
  trimPhase = 'start';
  updateTrimStepGuide();
  renderTrimIndicators();
}

function normalizeCropRect(r) {
  let x = r.x, y = r.y, w = r.w, h = r.h;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

function updateCropSelection() {
  const sel = document.getElementById('crop-selection');
  if (!cropRect) { sel.style.display = 'none'; return; }

  const r = normalizeCropRect(cropRect);
  if (r.w < 2 && r.h < 2) { sel.style.display = 'none'; return; }

  sel.style.display = 'block';
  sel.style.left = r.x + 'px';
  sel.style.top = r.y + 'px';
  sel.style.width = r.w + 'px';
  sel.style.height = r.h + 'px';

  const actualW = Math.round(r.w * cropScale);
  const actualH = Math.round(r.h * cropScale);
  document.getElementById('crop-dimensions').textContent =
    `\u30c8\u30ea\u30df\u30f3\u30b0\u30b5\u30a4\u30ba: ${actualW} \u00d7 ${actualH} px`;
}

// Crop editor mouse handling
(function initCropEditor() {
  const wrapper = document.getElementById('crop-canvas-wrapper');
  let dragging = false;
  let dragType = null;
  let startMX, startMY;
  let startRect = null;

  wrapper.addEventListener('mousedown', (e) => {
    if (!cropEditorGroup) return;
    const img = document.getElementById('crop-img');
    const imgRect = img.getBoundingClientRect();
    const mx = e.clientX - imgRect.left;
    const my = e.clientY - imgRect.top;

    startMX = mx;
    startMY = my;

    if (cropRect) {
      const r = normalizeCropRect(cropRect);
      const handle = detectHandle(mx, my, r);
      if (handle) {
        dragType = handle;
        startRect = { ...r };
      } else if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        dragType = 'move';
        startRect = { ...r };
      } else {
        dragType = 'new';
        cropRect = { x: mx, y: my, w: 0, h: 0 };
      }
    } else {
      dragType = 'new';
      cropRect = { x: mx, y: my, w: 0, h: 0 };
    }

    dragging = true;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging || !cropEditorGroup) return;
    const img = document.getElementById('crop-img');
    const imgRect = img.getBoundingClientRect();
    const mx = e.clientX - imgRect.left;
    const my = e.clientY - imgRect.top;
    const dx = mx - startMX;
    const dy = my - startMY;

    const maxW = img.clientWidth;
    const maxH = img.clientHeight;

    if (dragType === 'new') {
      cropRect.w = clamp(mx, 0, maxW) - cropRect.x;
      cropRect.h = clamp(my, 0, maxH) - cropRect.y;
    } else if (dragType === 'move') {
      let nx = startRect.x + dx;
      let ny = startRect.y + dy;
      nx = clamp(nx, 0, maxW - startRect.w);
      ny = clamp(ny, 0, maxH - startRect.h);
      cropRect = { x: nx, y: ny, w: startRect.w, h: startRect.h };
    } else if (dragType === 'br') {
      cropRect = { x: startRect.x, y: startRect.y,
        w: Math.max(10, startRect.w + dx), h: Math.max(10, startRect.h + dy) };
    } else if (dragType === 'bl') {
      cropRect = { x: startRect.x + dx, y: startRect.y,
        w: Math.max(10, startRect.w - dx), h: Math.max(10, startRect.h + dy) };
    } else if (dragType === 'tr') {
      cropRect = { x: startRect.x, y: startRect.y + dy,
        w: Math.max(10, startRect.w + dx), h: Math.max(10, startRect.h - dy) };
    } else if (dragType === 'tl') {
      cropRect = { x: startRect.x + dx, y: startRect.y + dy,
        w: Math.max(10, startRect.w - dx), h: Math.max(10, startRect.h - dy) };
    }

    updateCropSelection();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    if (cropRect) {
      cropRect = normalizeCropRect(cropRect);
      updateCropSelection();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!cropEditorGroup) return;
    if (e.key === 'Escape') {
      cancelCropEditor();
    } else if (e.key === 'ArrowLeft') {
      cropPrev();
    } else if (e.key === 'ArrowRight') {
      cropNext();
    } else if (e.key === ' ') {
      e.preventDefault();
      cropToggleSelection();
    }
  });

  function detectHandle(mx, my, r) {
    const hs = 10;
    if (Math.abs(mx - r.x) < hs && Math.abs(my - r.y) < hs) return 'tl';
    if (Math.abs(mx - (r.x + r.w)) < hs && Math.abs(my - r.y) < hs) return 'tr';
    if (Math.abs(mx - r.x) < hs && Math.abs(my - (r.y + r.h)) < hs) return 'bl';
    if (Math.abs(mx - (r.x + r.w)) < hs && Math.abs(my - (r.y + r.h)) < hs) return 'br';
    return null;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
})();

// --- Apply All Trims ---

async function applyAllTrims() {
  const validGroups = trimGroups.filter(g => g.crop);
  if (validGroups.length === 0) {
    alert('\u30c8\u30ea\u30df\u30f3\u30b0\u304c\u8a2d\u5b9a\u3055\u308c\u305f\u30b0\u30eb\u30fc\u30d7\u304c\u3042\u308a\u307e\u305b\u3093');
    return;
  }

  const totalImages = validGroups.reduce((sum, g) => sum + (g.endIdx - g.startIdx + 1), 0);
  if (!confirm(
    `\u25b6 ${validGroups.length}\u30b0\u30eb\u30fc\u30d7\u3001\u8a08${totalImages}\u679a\u306e\u753b\u50cf\u3092\u30c8\u30ea\u30df\u30f3\u30b0\u3057\u307e\u3059\u3002\n\n\u203b \u3053\u306e\u64cd\u4f5c\u306f\u5143\u306e\u753b\u50cf\u3092\u4e0a\u66f8\u304d\u3057\u307e\u3059\u3002\u5143\u306b\u623b\u305b\u307e\u305b\u3093\u3002\n\u7d9a\u884c\u3057\u307e\u3059\u304b\uff1f`
  )) {
    return;
  }

  const trimData = validGroups.map(g => ({
    imagePaths: thumbItems.slice(g.startIdx, g.endIdx + 1).map(it => it.filepath),
    crop: g.crop,
  }));

  try {
    const count = await window.api.applyTrims(trimData);
    alert(`${count}\u679a\u306e\u753b\u50cf\u3092\u30c8\u30ea\u30df\u30f3\u30b0\u3057\u307e\u3057\u305f`);
    // Reset trim state without confirm dialog
    trimMode = false;
    trimPhase = null;
    trimGroups = [];
    trimPendingStart = -1;
    document.getElementById('trim-toolbar').style.display = 'none';
    document.getElementById('normal-toolbar').style.display = 'flex';
    clearTrimIndicators();
    reloadThumbnails();
  } catch (err) {
    alert('\u30c8\u30ea\u30df\u30f3\u30b0\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f: ' + err.message);
  }
}

function reloadThumbnails() {
  const ts = Date.now();
  document.querySelectorAll('.thumb-item img').forEach(img => {
    const src = img.src.split('?')[0];
    img.src = src + '?t=' + ts;
  });
  const lbImg = document.getElementById('lb-img');
  if (lbImg.src) {
    const src = lbImg.src.split('?')[0];
    lbImg.src = src + '?t=' + ts;
  }
}
