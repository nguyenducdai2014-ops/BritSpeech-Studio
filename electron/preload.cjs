const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  checkVoiceStudioStatus: () => ipcRenderer.invoke('voicestudio:check-status'),
  getAudioLibraryPath: () => ipcRenderer.invoke('audiolibrary:get-path'),
  saveAudioFile: (filename, base64Data) => ipcRenderer.invoke('audiolibrary:save-file', { filename, base64Data }),
});
