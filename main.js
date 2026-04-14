const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

// Fix GPU cache access errors
app.setPath('userData', path.join(os.tmpdir(), 'screenshot-monitor'));

const { MonitoringLoop } = require('./src/capture');
const { exportToPdf } = require('./src/exporter');

let mainWindow = null;
let selectionWindow = null;
let overlayWindow = null;
let monitoringLoop = null;
let currentSessionDir = null;

function getScreenshotsRoot() {
  const root = path.join(app.getPath('exe'), '..', 'Screenshots');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

// Use app directory in dev mode
function getAppDir() {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }
  return __dirname;
}

function getScreenshotsRootDir() {
  const root = path.join(getAppDir(), 'Screenshots');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 320,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.loadFile(path.join(__dirname, 'src', 'windows', 'main.html'));

  mainWindow.on('close', () => {
    if (monitoringLoop) monitoringLoop.stop();
    destroyOverlay();
  });
}

// --- Region Selection ---

let selectionWindows = [];

function createSelectionWindow() {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays();
    selectionWindows = [];
    const primarySF = screen.getPrimaryDisplay().scaleFactor;

    displays.forEach((d) => {
      const targetBounds = {
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      };

      const dpiRatio = d.scaleFactor / primarySF;
      const initWidth = Math.round(targetBounds.width / dpiRatio);
      const initHeight = Math.round(targetBounds.height / dpiRatio);

      // 1px inset from display edges — a window that exactly covers the
      // display triggers Windows fullscreen optimizations, which on the
      // primary monitor switch DWM into an exclusive path where the
      // transparent/frameless window's dynamic content stops rendering.
      // Shrinking by 1px avoids that path entirely.
      const win = new BrowserWindow({
        x: targetBounds.x + 1,
        y: targetBounds.y + 1,
        width: Math.max(100, initWidth - 2),
        height: Math.max(100, initHeight - 2),
        show: false,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });
      win.setMenuBarVisibility(false);
      win.loadFile(path.join(__dirname, 'src', 'windows', 'selection.html'));

      win.once('ready-to-show', () => {
        // Re-enforce the inset bounds after DPI adjustments.
        win.setBounds({
          x: targetBounds.x + 1,
          y: targetBounds.y + 1,
          width: Math.max(100, targetBounds.width - 2),
          height: Math.max(100, targetBounds.height - 2),
        });
        win.show();
        const actual = win.getBounds();
        win.webContents.send('init-selection', {
          offsetX: actual.x,
          offsetY: actual.y,
          displayBounds: d.bounds,
          scaleFactor: d.scaleFactor,
        });
      });

      selectionWindows.push(win);
    });

    ipcMain.once('region-selected', (e, region) => {
      selectionWindows.forEach(w => {
        if (!w.isDestroyed()) w.destroy();
      });
      selectionWindows = [];
      resolve(region);
    });
  });
}

// --- Overlay ---

function createOverlayWindow(region, recording = true) {
  // Find the display that contains the region
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

  const primarySF = screen.getPrimaryDisplay().scaleFactor;
  // 1px inset — see createSelectionWindow for why (avoids Windows fullscreen
  // optimizations that break dynamic rendering of transparent windows on
  // the primary monitor).
  const targetBounds = {
    x: targetDisplay.bounds.x + 1,
    y: targetDisplay.bounds.y + 1,
    width: Math.max(100, targetDisplay.bounds.width - 2),
    height: Math.max(100, targetDisplay.bounds.height - 2),
  };
  const dpiRatio = targetDisplay.scaleFactor / primarySF;
  const initWidth = Math.round(targetBounds.width / dpiRatio);
  const initHeight = Math.round(targetBounds.height / dpiRatio);

  overlayWindow = new BrowserWindow({
    x: targetBounds.x,
    y: targetBounds.y,
    width: initWidth,
    height: initHeight,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'src', 'windows', 'overlay.html'));

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.setBounds(targetBounds);
    overlayWindow.show();
    // Use the ACTUAL window origin (Windows may have adjusted it) so the
    // renderer's toLocal() matches the real window position.
    const actual = overlayWindow.getBounds();
    overlayWindow.webContents.send('init-overlay', {
      region,
      winOffset: { x: actual.x, y: actual.y },
      displayBounds: targetDisplay.bounds,
      scaleFactor: targetDisplay.scaleFactor,
      recording,
    });
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  // Toggle ignore based on cursor over interactive elements
  ipcMain.removeAllListeners('set-ignore-mouse');
  ipcMain.on('set-ignore-mouse', (e, ignore) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (ignore) {
        overlayWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        overlayWindow.setIgnoreMouseEvents(false);
      }
    }
  });
}

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
}

// --- IPC Handlers ---

ipcMain.handle('select-region', async () => {
  // Remove previous preview overlay
  destroyOverlay();
  latestRegion = null;
  if (mainWindow) mainWindow.hide();
  const region = await createSelectionWindow();
  if (mainWindow) mainWindow.show();
  // Show preview overlay (red border + handles, no control panel)
  if (region) {
    latestRegion = region;
    createOverlayWindow(region, false);
  }
  return region;
});

ipcMain.handle('start-monitoring', async (e, config) => {
  // Use the latest region if it was updated via overlay drag, otherwise use config
  const region = latestRegion || config.region;
  const { interval, thresholdPct, pixelThreshold } = config;

  // Create session directory
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
  const sessionName = `session_${ts}`;
  currentSessionDir = path.join(getScreenshotsRootDir(), sessionName);

  // Hide main window
  if (mainWindow) mainWindow.hide();

  // Switch existing preview overlay to recording mode, or create new
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('start-recording');
  } else {
    createOverlayWindow(region, true);
  }

  // Start monitoring loop. Red border is positioned OUTSIDE the region with
  // a 2px gap (see overlay.html updatePositions), so screenshots never
  // include it — no need to hide the overlay during each capture.
  monitoringLoop = new MonitoringLoop(
    region,
    currentSessionDir,
    { interval, thresholdPct, pixelThreshold },
    (filepath) => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('flash');
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture', filepath);
      }
    }
  );
  monitoringLoop.start();

  return true;
});

ipcMain.on('pause-monitoring', () => {
  if (monitoringLoop) monitoringLoop.pause();
});

ipcMain.on('resume-monitoring', () => {
  if (monitoringLoop) monitoringLoop.resume();
});

ipcMain.on('stop-monitoring', () => {
  if (monitoringLoop) {
    monitoringLoop.stop();
    monitoringLoop = null;
  }
  destroyOverlay();

  // Show main window with results
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setResizable(true);
    mainWindow.setSize(1000, 750);
    mainWindow.center();
    mainWindow.show();
    mainWindow.maximize();

    // Send image list
    if (currentSessionDir && fs.existsSync(currentSessionDir)) {
      const images = fs.readdirSync(currentSessionDir)
        .filter(f => f.endsWith('.png'))
        .sort()
        .map(f => path.join(currentSessionDir, f));
      mainWindow.webContents.executeJavaScript(
        `showResultsWithImages(${JSON.stringify(images)}, ${JSON.stringify(currentSessionDir)})`
      );
    }
  }
});

// Track the latest region so overlay moves are reflected in the next start-monitoring
let latestRegion = null;

ipcMain.on('region-update', (e, region) => {
  latestRegion = region;
  if (monitoringLoop) {
    monitoringLoop.updateRegion(region);
  }
  // Notify main window so its stored region stays in sync
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('region-updated', region);
  }
});

ipcMain.handle('load-folder', async () => {
  // Temporarily lower alwaysOnTop so dialog is visible
  if (mainWindow) mainWindow.setAlwaysOnTop(false);
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'スクリーンショットフォルダを選択',
    defaultPath: getScreenshotsRootDir(),
    properties: ['openDirectory'],
  });
  if (mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');

  if (result.canceled || !result.filePaths.length) return null;

  const folder = result.filePaths[0];
  const images = fs.readdirSync(folder)
    .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
    .sort()
    .map(f => path.join(folder, f));

  return { folder, images };
});

ipcMain.handle('export-pdf', async (e, imagePaths, outputPath) => {
  return await exportToPdf(imagePaths, outputPath);
});

ipcMain.handle('save-file-dialog', async (e, defaultName) => {
  if (mainWindow) mainWindow.setAlwaysOnTop(false);
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'PDF files', extensions: ['pdf'] }],
  });
  if (mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('get-screenshots-root', () => getScreenshotsRootDir());

// --- Settings Persistence ---

function getSettingsPath() {
  return path.join(getAppDir(), 'monitor-settings.json');
}

ipcMain.handle('load-settings', () => {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { /* ignore */ }
  return null;
});

ipcMain.handle('save-settings', (e, settings) => {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
    return true;
  } catch (e) { return false; }
});

// --- Manual Capture ---

ipcMain.on('manual-capture', () => {
  if (monitoringLoop) monitoringLoop.forceCapture();
});

// --- Apply Trims ---

ipcMain.handle('apply-trims', async (e, trimGroups) => {
  let count = 0;
  for (const group of trimGroups) {
    const { crop, imagePaths, refWidth, refHeight } = group;
    for (const imgPath of imagePaths) {
      try {
        const meta = await sharp(imgPath).metadata();

        // Scale crop proportionally if image size differs from reference
        const scaleX = (refWidth && refWidth > 0) ? meta.width / refWidth : 1;
        const scaleY = (refHeight && refHeight > 0) ? meta.height / refHeight : 1;

        const left = Math.max(0, Math.round(crop.left * scaleX));
        const top = Math.max(0, Math.round(crop.top * scaleY));
        let width = Math.round(crop.width * scaleX);
        let height = Math.round(crop.height * scaleY);
        if (left + width > meta.width) width = meta.width - left;
        if (top + height > meta.height) height = meta.height - top;
        if (width < 1 || height < 1) continue;

        const buf = await sharp(imgPath)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();
        fs.writeFileSync(imgPath, buf);
        count++;
      } catch (err) {
        console.error('Trim error:', imgPath, err);
      }
    }
  }
  return count;
});

ipcMain.on('reset-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.setSize(500, 320);
    mainWindow.center();
    mainWindow.setResizable(false);
  }
});

// --- App Lifecycle ---

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (monitoringLoop) monitoringLoop.stop();
  app.quit();
});
