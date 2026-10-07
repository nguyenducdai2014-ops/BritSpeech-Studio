const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;
const DEFAULT_PORT = process.env.PORT || 3000;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function getAudioLibraryDir() {
  const userDir = app.getPath('userData');
  const libraryDir = path.join(userDir, 'Audio Library');
  if (!fs.existsSync(libraryDir)) {
    try {
      fs.mkdirSync(libraryDir, { recursive: true });
    } catch (e) {
      console.error('Failed to create Audio Library directory:', e);
    }
  }
  return libraryDir;
}

function resolveGeminiApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }

  // Check in portable directory (if running as portable exe)
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    const envPath = path.join(portableDir, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
        if (match) return match[1];
      } catch (e) {}
    }
  }

  // Check in user data directory
  const userDataEnv = path.join(app.getPath('userData'), '.env');
  if (fs.existsSync(userDataEnv)) {
    try {
      const content = fs.readFileSync(userDataEnv, 'utf8');
      const match = content.match(/GEMINI_API_KEY=["']?([^"'\r\n]+)["']?/);
      if (match) return match[1];
    } catch (e) {}
  }

  return '';
}

function startLocalServer() {
  return new Promise((resolve) => {
    const isDev = !app.isPackaged;
    const serverScript = isDev
      ? path.join(__dirname, '../server.ts')
      : path.join(__dirname, '../dist-server/server.cjs');

    const env = {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(DEFAULT_PORT),
      GEMINI_API_KEY: resolveGeminiApiKey(),
      AUDIO_LIBRARY_DIR: getAudioLibraryDir(),
    };

    if (isDev) {
      try {
        serverProcess = fork(serverScript, [], {
          env,
          execArgv: ['--import', 'tsx'],
          silent: false,
        });
      } catch (err) {
        console.error('Failed to spawn dev server:', err);
      }
    } else {
      if (fs.existsSync(serverScript)) {
        serverProcess = fork(serverScript, [], {
          env,
          silent: false,
        });
      } else {
        console.warn('Packaged server bundle not found at:', serverScript);
      }
    }

    if (serverProcess) {
      serverProcess.on('error', (err) => {
        console.error('Local server process error:', err);
      });
      serverProcess.on('exit', (code, signal) => {
        console.log(`Local server process exited with code ${code}, signal ${signal}`);
      });
    }

    // Probe server readiness
    const startTime = Date.now();
    const timeout = 12000;

    function checkServer() {
      const req = http.get(`http://localhost:${DEFAULT_PORT}/api/ping`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(checkServer, 250);
        }
      });

      req.on('error', () => {
        if (Date.now() - startTime > timeout) {
          console.warn('Server readiness probe timed out; attempting to display window.');
          resolve();
        } else {
          setTimeout(checkServer, 250);
        }
      });
    }

    setTimeout(checkServer, 400);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'BritSpeech Studio',
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://localhost:${DEFAULT_PORT}`).catch((err) => {
    console.error('Failed to load local server URL:', err);
    dialog.showErrorBox(
      'BritSpeech Studio Error',
      'BritSpeech Studio could not connect to its local service on port ' + DEFAULT_PORT + '.'
    );
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('voicestudio:check-status', async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    const res = await fetch('http://localhost:3900/health', { signal: controller.signal });
    clearTimeout(timeoutId);
    return { available: res.ok, url: 'http://localhost:3900' };
  } catch (err) {
    return { available: false, error: 'VoiceStudio is not active on http://localhost:3900' };
  }
});

ipcMain.handle('audiolibrary:get-path', () => {
  return getAudioLibraryDir();
});

ipcMain.handle('audiolibrary:save-file', async (_event, { filename, base64Data }) => {
  try {
    const dir = getAudioLibraryDir();
    const filePath = path.join(dir, filename);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  try {
    await startLocalServer();
    createWindow();
  } catch (err) {
    dialog.showErrorBox('Startup Error', 'BritSpeech Studio could not start its local service.\n' + err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
    serverProcess = null;
  }
});
