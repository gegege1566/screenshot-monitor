const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectRegion: () => ipcRenderer.invoke('select-region'),
  startMonitoring: (config) => ipcRenderer.invoke('start-monitoring', config),
  stopMonitoring: () => ipcRenderer.invoke('stop-monitoring'),
  pauseMonitoring: () => ipcRenderer.send('pause-monitoring'),
  resumeMonitoring: () => ipcRenderer.send('resume-monitoring'),
  exportPdf: (imagePaths, outputPath) => ipcRenderer.invoke('export-pdf', imagePaths, outputPath),
  loadFolder: () => ipcRenderer.invoke('load-folder'),
  saveFileDialog: (defaultName) => ipcRenderer.invoke('save-file-dialog', defaultName),
  getScreenshotsRoot: () => ipcRenderer.invoke('get-screenshots-root'),
  onCapture: (callback) => ipcRenderer.on('capture', (e, path) => callback(path)),
  onRegionUpdated: (callback) => ipcRenderer.on('region-updated', (e, r) => callback(r)),
  resetWindow: () => ipcRenderer.send('reset-window'),
  onMonitoringStopped: (callback) => ipcRenderer.on('monitoring-stopped', () => callback()),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
