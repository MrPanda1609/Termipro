const { app, BrowserWindow, ipcMain, dialog, shell: electronShell, Menu, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

const SETTINGS_DIR = path.join(app.getPath('userData'), 'Termipro');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const WORKSPACES_FILE = path.join(SETTINGS_DIR, 'workspaces.json');
const COMMAND_HISTORY_FILE = path.join(SETTINGS_DIR, 'command-history.json');

const DEFAULT_SETTINGS = {
  font: { family: 'Cascadia Code', size: 14 },
  cursor: { style: 'bar', blink: true },
  shell: 'PowerShell',
  windowOpacity: 100,
  scrollbackLines: 11000,
  workingDirectory: os.homedir(),
  colorTheme: 'GitHub Dark',
};

const COMMAND_SUGGESTIONS = [
  'cd',
  'dir',
  'ls',
  'pwd',
  'mkdir',
  'rmdir',
  'copy',
  'move',
  'del',
  'clear',
  'cls',
  'git',
  'npm',
  'node',
  'bun',
  'code',
  'gh',
];

function getAssetPath(...parts) {
  return path.join(__dirname, '..', ...parts);
}

function normalizePathPart(value) {
  return String(value || '').replace(/^['"]|['"]$/g, '');
}

function getAutocompleteSuggestions({ input = '', cwd = '' }) {
  const line = String(input).trimStart();
  if (!line) return [];

  const cdMatch = line.match(/^cd\s+(.+)?$/i);
  if (cdMatch) {
    const rawQuery = normalizePathPart(cdMatch[1] || '');
    const lastSlash = Math.max(rawQuery.lastIndexOf('/'), rawQuery.lastIndexOf('\\'));
    const parentPart = lastSlash >= 0 ? rawQuery.slice(0, lastSlash + 1) : '';
    const namePart = lastSlash >= 0 ? rawQuery.slice(lastSlash + 1) : rawQuery;
    const baseDir = path.resolve(cwd || os.homedir(), parentPart || '.');

    try {
      return fs.readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(namePart.toLowerCase()))
        .slice(0, 8)
        .map((entry) => {
          const value = `${parentPart}${entry.name}`;
          const escaped = /\s/.test(value) ? `"${value}"` : value;
          return {
            label: entry.name,
            detail: baseDir,
            insertText: escaped,
            replaceFrom: line.length - rawQuery.length,
          };
        });
    } catch {
      return [];
    }
  }

  if (!line.includes(' ')) {
    return COMMAND_SUGGESTIONS
      .filter((cmd) => cmd.startsWith(line.toLowerCase()))
      .slice(0, 8)
      .map((cmd) => ({
        label: cmd,
        detail: 'command',
        insertText: cmd,
        replaceFrom: 0,
      }));
  }

  return [];
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
let tray = null;
let isQuitting = false;
const shellMap = {};

function readJsonFile(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJsonFile(filePath, value) {
  ensureDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeDirKey(dir) {
  return path.resolve(dir || os.homedir()).toLowerCase();
}

function findProjectRoot(dir) {
  let current = path.resolve(dir || os.homedir());
  while (true) {
    if (['.git', 'package.json', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt', 'pyproject.toml', 'Cargo.toml'].some((name) => fs.existsSync(path.join(current, name)))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(dir || os.homedir());
    current = parent;
  }
}

function getCommandHistory() {
  return readJsonFile(COMMAND_HISTORY_FILE, { folders: {}, projects: {} });
}

function rememberCommand(cwd, command) {
  const clean = String(command || '').trim();
  if (!clean || clean.length > 500) return;

  const dir = cwd || os.homedir();
  const folderKey = normalizeDirKey(dir);
  const projectKey = normalizeDirKey(findProjectRoot(dir));
  const history = getCommandHistory();

  for (const [group, key] of [['folders', folderKey], ['projects', projectKey]]) {
    const previous = Array.isArray(history[group]?.[key]) ? history[group][key] : [];
    history[group] = history[group] || {};
    history[group][key] = [clean, ...previous.filter((item) => item !== clean)].slice(0, 20);
  }

  writeJsonFile(COMMAND_HISTORY_FILE, history);
}

function getQuickCommands(cwd) {
  const dir = cwd || os.homedir();
  const history = getCommandHistory();
  const folderKey = normalizeDirKey(dir);
  const projectRoot = findProjectRoot(dir);
  const projectKey = normalizeDirKey(projectRoot);

  return {
    folder: history.folders?.[folderKey] || [],
    project: history.projects?.[projectKey] || [],
    projectRoot,
  };
}

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

function getUpdateErrorMessage(error) {
  const message = String(error?.message || error || 'Unknown update error');

  if (message.includes('404') || message.includes('Cannot find latest.yml') || message.includes('releases.atom')) {
    return 'Cannot reach the update feed. Make the GitHub repository public, or use a public update host.';
  }
  if (message.includes('ENOENT') || message.includes('not found')) {
    return 'Update files are missing from the GitHub release. Please check latest.yml and installer assets.';
  }
  if (message.includes('sha512')) {
    return 'The downloaded update did not match the published checksum.';
  }

  return message.split('\n')[0].slice(0, 220);
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
  autoUpdater.on('error', (error) => sendUpdateStatus({ state: 'error', message: getUpdateErrorMessage(error) }));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

function setupTray() {
  if (tray) return;

  tray = new Tray(getAssetPath('pic', 'icon.png'));
  tray.setToolTip('Termipro');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Termipro', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        mainWindow?.close();
      },
    },
  ]));
  tray.on('double-click', showMainWindow);
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
  mainWindow.on('close', (event) => {
    if (isQuitting) return;

    const { response } = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Hide to tray', 'Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Close Termipro?',
      message: 'Do you want to keep Termipro running in the background?',
      detail: 'Hide to tray keeps all terminal processes running. Quit closes Termipro and stops terminal sessions.',
    });

    if (response === 0) {
      event.preventDefault();
      setupTray();
      mainWindow.hide();
      return;
    }
    if (response === 2) {
      event.preventDefault();
      return;
    }

    isQuitting = true;
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    mainWindow.webContents.once('did-finish-load', () => {
      autoUpdater.checkForUpdates().catch((error) => sendUpdateStatus({
        state: 'error',
        message: getUpdateErrorMessage(error),
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

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getTermiproPromptPowerShell() {
  const appName = psQuote('Termipro');
  const version = psQuote(`v${app.getVersion()}`);
  return [
    'function global:prompt {',
    '  $p = $executionContext.SessionState.Path.CurrentLocation.Path',
    '  Write-Host $p -NoNewline -ForegroundColor Yellow',
    "  Write-Host ' > ' -NoNewline -ForegroundColor DarkGray",
    `  Write-Host ${appName} -NoNewline -ForegroundColor Cyan`,
    "  Write-Host ' > ' -NoNewline -ForegroundColor DarkGray",
    `  Write-Host ${version} -NoNewline -ForegroundColor Green`,
    '  return "`n> "',
    '}',
  ].join('; ');
}

function getTermiproPromptCmd() {
  const version = app.getVersion();
  return [
    '$E[38;2;255;166;87m$P$E[0m',
    '$E[38;2;139;148;158m $G $E[0m',
    '$E[38;2;88;166;255mTermipro$E[0m',
    '$E[38;2;139;148;158m $G $E[0m',
    `$E[38;2;126;231;135mv${version}$E[0m`,
    '$_$G$S',
  ].join('');
}

function getShellCommand(id) {
  switch (id) {
    case 'cmd': return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/K', `prompt ${getTermiproPromptCmd()}`] };
    case 'git-bash': return { cmd: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'] };
    case 'wsl': return { cmd: 'wsl.exe', args: [] };
    default: return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', getTermiproPromptPowerShell()] };
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
      if (shellMap[tabId]?.proc === proc) {
        delete shellMap[tabId];
      }
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
      if (entry.inputBuffer.trim().length > 0) {
        entry.dirty = true;
        rememberCommand(entry.cwd, entry.inputBuffer);
      }
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

ipcMain.handle('get-autocomplete-suggestions', (_, opts) => getAutocompleteSuggestions(opts || {}));

ipcMain.handle('get-quick-commands', (_, cwd) => getQuickCommands(cwd));

ipcMain.handle('remember-command', (_, { cwd, command }) => {
  rememberCommand(cwd, command);
  return getQuickCommands(cwd);
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
  try {
    await autoUpdater.checkForUpdates();
    return { skipped: false };
  } catch (error) {
    const message = getUpdateErrorMessage(error);
    sendUpdateStatus({ state: 'error', message });
    return { skipped: false, error: message };
  }
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
app.on('before-quit', () => {
  isQuitting = true;
  Object.values(shellMap).forEach(({ proc }) => proc?.kill());
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
