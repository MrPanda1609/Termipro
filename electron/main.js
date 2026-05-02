const { app, BrowserWindow, ipcMain, dialog, shell: electronShell, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

const SETTINGS_DIR = path.join(app.getPath('userData'), 'Termipro');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const WORKSPACES_FILE = path.join(SETTINGS_DIR, 'workspaces.json');

const DEFAULT_SETTINGS = {
  font: { family: 'Cascadia Code', size: 14 },
  cursor: { style: 'bar', blink: true },
  shell: 'PowerShell',
  windowOpacity: 100,
  scrollbackLines: 11000,
  workingDirectory: os.homedir(),
  colorTheme: 'GitHub Dark',
};

function getAssetPath(...parts) {
  return path.join(__dirname, '..', ...parts);
}

function ensureDir() {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

function loadSettings() {
  try {
    ensureDir();
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  ensureDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

let mainWindow = null;
const shellMap = {};

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

function setupAutoUpdater() {
  if (process.env.NODE_ENV === 'development') return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({
    state: 'downloading',
    percent: Math.round(progress.percent || 0),
  }));
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({ state: 'downloaded', version: info.version });
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Termipro update ready',
      message: `Termipro ${info.version} has been downloaded.`,
      detail: 'Restart Termipro to install the update.',
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });
  autoUpdater.on('error', (error) => sendUpdateStatus({ state: 'error', message: error.message }));
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    icon: getAssetPath('pic', 'icon.png'),
    backgroundColor: '#0d1117',
    opacity: Math.max(0.5, Math.min(1, loadSettings().windowOpacity / 100)),
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      autoUpdater.checkForUpdates().catch((error) => sendUpdateStatus({
        state: 'error',
        message: error.message,
      }));
    });
  }
}

// ── Settings IPC ──

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, settings) => {
  saveSettings(settings);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(Math.max(0.5, Math.min(1, settings.windowOpacity / 100)));
  }
  return loadSettings();
});

ipcMain.handle('select-directory', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: loadSettings().workingDirectory,
  });
  return r.canceled ? null : r.filePaths[0];
});

// ── Shell detection ──

ipcMain.handle('get-installed-shells', () => {
  const shells = [
    { id: 'PowerShell', name: 'PowerShell' },
    { id: 'cmd', name: 'Command Prompt' },
  ];
  if (fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')) {
    shells.push({ id: 'git-bash', name: 'Git Bash' });
  }
  try {
    require('child_process').execSync('wsl --status', { stdio: 'ignore' });
    shells.push({ id: 'wsl', name: 'WSL' });
  } catch {}
  return shells;
});

// ── PTY IPC ──

function getShellCommand(id) {
  switch (id) {
    case 'cmd': return { cmd: process.env.ComSpec || 'cmd.exe', args: [] };
    case 'git-bash': return { cmd: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] };
    case 'wsl': return { cmd: 'wsl.exe', args: [] };
    default: return { cmd: 'powershell.exe', args: ['-NoLogo'] };
  }
}

ipcMain.handle('create-shell', (_, { cwd, cols, rows, tabId, shell }) => {
  const settings = loadSettings();
  const dir = cwd || settings.workingDirectory || process.env.USERPROFILE || os.homedir();
  const { cmd, args } = getShellCommand(shell || settings.shell);

  try {
    const proc = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols: cols || 120,
      rows: rows || 30,
      cwd: dir,
      env: process.env,
    });

    shellMap[tabId] = { proc, cwd: dir, inputBuffer: '', dirty: false };

    proc.onData((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shell-data', { tabId, data });
      }
    });

    proc.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shell-exit', { tabId, exitCode });
      }
      delete shellMap[tabId];
    });

    return { success: true, cwd: dir };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('write-shell', (_, { tabId, data }) => {
  const entry = shellMap[tabId];
  if (!entry?.proc) return;

  for (const ch of String(data)) {
    if (ch === '\r' || ch === '\n') {
      if (entry.inputBuffer.trim().length > 0) entry.dirty = true;
      entry.inputBuffer = '';
    } else if (ch === '\b' || ch === '\x7f') {
      entry.inputBuffer = entry.inputBuffer.slice(0, -1);
    } else if (ch >= ' ' && ch !== '\x7f') {
      entry.inputBuffer += ch;
    }
  }

  entry.proc.write(data);
});

ipcMain.handle('is-shell-running', (_, tabId) => {
  return Boolean(shellMap[tabId]?.proc && shellMap[tabId]?.dirty);
});

ipcMain.handle('kill-shell', (_, tabId) => {
  shellMap[tabId]?.proc?.kill();
  delete shellMap[tabId];
});

ipcMain.handle('get-shell-cwd', (_, tabId) => {
  return shellMap[tabId]?.cwd || null;
});

ipcMain.handle('resize-pty', (_, { tabId, cols, rows }) => {
  shellMap[tabId]?.proc?.resize(cols, rows);
});

// ── Workspaces IPC ──

ipcMain.handle('get-workspaces', () => {
  try { return JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf-8')); }
  catch { return []; }
});

ipcMain.handle('save-workspaces', (_, ws) => {
  ensureDir();
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(ws, null, 2));
});

// ── Utility IPC ──

ipcMain.handle('open-folder', (_, folderPath) => {
  electronShell.showItemInFolder(folderPath);
});

ipcMain.handle('get-home-dir', () => os.homedir());

ipcMain.handle('check-for-updates', async () => {
  if (process.env.NODE_ENV === 'development') return { skipped: true };
  await autoUpdater.checkForUpdates();
  return { skipped: false };
});

// ── Window controls ──

ipcMain.handle('window-minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window-toggle-maximize', () => {
  if (!mainWindow) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return false;
  }
  mainWindow.maximize();
  return true;
});

ipcMain.handle('window-close', () => {
  mainWindow?.close();
});

// ── Lifecycle ──

app.whenReady().then(() => {
  setupAutoUpdater();
  createWindow();
});
app.on('window-all-closed', () => {
  Object.values(shellMap).forEach(({ proc }) => proc?.kill());
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
