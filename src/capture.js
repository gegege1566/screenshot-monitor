const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { desktopCapturer, screen } = require('electron');

class ChangeDetector {
  constructor(thresholdPct = 15, pixelThreshold = 30) {
    this.thresholdPct = thresholdPct;
    this.pixelThreshold = pixelThreshold;
  }

  hasChanged(currentBuf, previousBuf) {
    if (!previousBuf) return true;
    if (currentBuf.length !== previousBuf.length) return true;

    const len = currentBuf.length;
    let changedPixels = 0;
    const totalPixels = len / 3;

    for (let i = 0; i < len; i += 3) {
      const dr = Math.abs(currentBuf[i] - previousBuf[i]);
      const dg = Math.abs(currentBuf[i + 1] - previousBuf[i + 1]);
      const db = Math.abs(currentBuf[i + 2] - previousBuf[i + 2]);
      if (Math.max(dr, dg, db) > this.pixelThreshold) {
        changedPixels++;
      }
    }

    return (changedPixels / totalPixels) * 100 >= this.thresholdPct;
  }
}

async function captureScreen(region) {
  // Find which display contains the region center
  const displays = screen.getAllDisplays();
  const centerX = region.left + region.width / 2;
  const centerY = region.top + region.height / 2;

  let targetDisplay = displays[0];
  for (const d of displays) {
    if (centerX >= d.bounds.x && centerX < d.bounds.x + d.bounds.width &&
        centerY >= d.bounds.y && centerY < d.bounds.y + d.bounds.height) {
      targetDisplay = d;
      break;
    }
  }

  const scaleFactor = targetDisplay.scaleFactor || 1;
  const thumbW = Math.round(targetDisplay.bounds.width * scaleFactor);
  const thumbH = Math.round(targetDisplay.bounds.height * scaleFactor);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
  });

  if (sources.length === 0) {
    throw new Error('No screen sources found');
  }

  // Match source to target display by display id
  let source = sources[0];
  for (const s of sources) {
    if (s.display_id === String(targetDisplay.id)) {
      source = s;
      break;
    }
  }

  return {
    pngBuffer: source.thumbnail.toPNG(),
    offsetX: targetDisplay.bounds.x,
    offsetY: targetDisplay.bounds.y,
    scaleFactor,
  };
}

class MonitoringLoop {
  constructor(region, saveDir, settings, onCapture) {
    this.region = { ...region };
    this.saveDir = saveDir;
    this.settings = settings;
    this.onCapture = onCapture;
    this.previousBuf = null;
    this.paused = false;
    this.stopped = false;
    this.timer = null;
    this.detector = new ChangeDetector(settings.thresholdPct, settings.pixelThreshold);
    this.forceNext = false;

    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }
  }

  start() {
    this.stopped = false;
    this._tick();
  }

  async _tick() {
    if (this.stopped) return;

    if (!this.paused) {
      try {
        await this._capture();
      } catch (e) {
        console.error('Capture error:', e);
      }
    }

    if (!this.stopped) {
      this.timer = setTimeout(() => this._tick(), this.settings.interval * 1000);
    }
  }

  async _capture() {
    const { pngBuffer, offsetX, offsetY, scaleFactor } = await captureScreen(this.region);

    // Get actual image dimensions
    const metadata = await sharp(pngBuffer).metadata();
    const imgW = metadata.width;
    const imgH = metadata.height;

    // Convert screen coordinates to image pixel coordinates and clamp
    let left = Math.max(0, Math.round((this.region.left - offsetX) * scaleFactor));
    let top = Math.max(0, Math.round((this.region.top - offsetY) * scaleFactor));
    let width = Math.round(this.region.width * scaleFactor);
    let height = Math.round(this.region.height * scaleFactor);

    // Ensure we don't exceed image bounds
    if (left + width > imgW) width = imgW - left;
    if (top + height > imgH) height = imgH - top;
    if (width < 1 || height < 1) return;

    const extractRegion = { left, top, width, height };

    const cropped = await sharp(pngBuffer)
      .extract(extractRegion)
      .removeAlpha()
      .raw()
      .toBuffer();

    const forced = this.forceNext;
    if (forced) {
      this.forceNext = false;
      this.previousBuf = null;
    }

    if (forced || this.detector.hasChanged(cropped, this.previousBuf)) {
      const now = new Date();
      const pad = (n, d = 2) => String(n).padStart(d, '0');
      const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
                 `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const ms = pad(now.getMilliseconds(), 3);
      const filename = `screenshot_${ts}_${ms}.png`;
      const filepath = path.join(this.saveDir, filename);

      await sharp(pngBuffer)
        .extract(extractRegion)
        .png()
        .toFile(filepath);

      this.previousBuf = cropped;

      if (this.onCapture) {
        this.onCapture(filepath);
      }
    }
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  updateRegion(region) {
    this.region = { ...region };
    this.forceNext = true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { MonitoringLoop, ChangeDetector };
