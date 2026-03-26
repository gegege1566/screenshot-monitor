const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
}

// --- Region Selection ---

let selectionWindows = [];

function createSelectionWindow() {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays();
    selectionWindows = [];

    // Create one selection window per display
    displays.forEach(d => {
      const win = new BrowserWindow({
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        fullscreen: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });
      win.setMenuBarVisibility(false);
      win.loadFile(path.join(__dirname, 'src', 'windows', 'selection.html'));

      win.webContents.on('did-finish-load', () => {
        win.webContents.send('init-selection', {
          offsetX: d.bounds.x,
          offsetY: d.bounds.y,
        });
      });

      selectionWindows.push(win);
    });

    ipcMain.once('region-selected', (e, region) => {
      // Destroy all selection windows
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

  overlayWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
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

  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('init-overlay', {
      region,
      winOffset: { x: targetDisplay.bounds.x, y: targetDisplay.bounds.y },
      recording,
    });
    // Click-through on transparent areas, forward events for CSS pointer-events
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
  if (mainWindow) mainWindow.hide();
  const region = await createSelectionWindow();
  if (mainWindow) mainWindow.show();
  // Show preview overlay (red border + handles, no control panel)
  if (region) {
    createOverlayWindow(region, false);
  }
  return region;
});

ipcMain.handle('start-monitoring', async (e, config) => {
  const { region, interval, thresholdPct, pixelThreshold } = config;

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

  // Start monitoring loop
  monitoringLoop = new MonitoringLoop(
    region,
    currentSessionDir,
    { interval, thresholdPct, pixelThreshold },
    (filepath) => {
      // Flash overlay
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('flash');
      }
      // Notify main window
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

ipcMain.on('region-update', (e, region) => {
  if (monitoringLoop) {
    monitoringLoop.updateRegion(region);
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

// --- App Lifecycle ---

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (monitoringLoop) monitoringLoop.stop();
  app.quit();
});
