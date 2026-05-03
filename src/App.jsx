import { useState, useEffect, useCallback, useRef } from 'react';
import { StoreProvider, useStore } from './store/index.jsx';
import TabBar from './components/TabBar.jsx';
import TerminalPanel from './components/TerminalPanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';

// Electron IPC bridge
if (!window.electron) {
  window.electron = {
    getSettings: () => window.require('electron').ipcRenderer.invoke('get-settings'),
    saveSettings: (s) => window.require('electron').ipcRenderer.invoke('save-settings', s),
    selectDirectory: () => window.require('electron').ipcRenderer.invoke('select-directory'),
    getInstalledShells: () => window.require('electron').ipcRenderer.invoke('get-installed-shells'),
    createPty: (opts) => window.require('electron').ipcRenderer.invoke('create-shell', opts),
    writePty: (opts) => window.require('electron').ipcRenderer.invoke('write-shell', opts),
    isShellRunning: (tabId) => window.require('electron').ipcRenderer.invoke('is-shell-running', tabId),
    killShell: (tabId) => window.require('electron').ipcRenderer.invoke('kill-shell', tabId),
    runCommand: (opts) => window.require('electron').ipcRenderer.invoke('run-command', opts),
    resizePty: (opts) => window.require('electron').ipcRenderer.invoke('resize-pty', opts),
    getAutocompleteSuggestions: (opts) => window.require('electron').ipcRenderer.invoke('get-autocomplete-suggestions', opts),
    getQuickCommands: (cwd) => window.require('electron').ipcRenderer.invoke('get-quick-commands', cwd),
    rememberCommand: (opts) => window.require('electron').ipcRenderer.invoke('remember-command', opts),
    getRecentFolders: () => window.require('electron').ipcRenderer.invoke('get-recent-folders'),
    rememberFolder: (dir) => window.require('electron').ipcRenderer.invoke('remember-folder', dir),
    readClipboardText: () => window.require('electron').clipboard.readText(),
    hasClipboardImage: () => !window.require('electron').clipboard.readImage().isEmpty(),
    minimizeWindow: () => window.require('electron').ipcRenderer.invoke('window-minimize'),
    toggleMaximizeWindow: () => window.require('electron').ipcRenderer.invoke('window-toggle-maximize'),
    closeWindow: () => window.require('electron').ipcRenderer.invoke('window-close'),
    hideToTray: () => window.require('electron').ipcRenderer.invoke('hide-to-tray'),
    quitApp: () => window.require('electron').ipcRenderer.invoke('quit-app'),
    getWorkspaces: () => window.require('electron').ipcRenderer.invoke('get-workspaces'),
    saveWorkspaces: (ws) => window.require('electron').ipcRenderer.invoke('save-workspaces', ws),
    checkForUpdates: () => window.require('electron').ipcRenderer.invoke('check-for-updates'),
    installUpdateNow: () => window.require('electron').ipcRenderer.invoke('install-update-now'),
    offUpdateStatus: (cb) => window.require('electron').ipcRenderer.removeListener('update-status', cb),
    offCloseRequest: (cb) => window.require('electron').ipcRenderer.removeListener('app-close-request', cb),
    onPtyData: (cb) => window.require('electron').ipcRenderer.on('shell-data', (_, d) => cb(d)),
    onShellClear: (cb) => window.require('electron').ipcRenderer.on('shell-clear', (_, d) => cb(d)),
    onPtyExit: (cb) => window.require('electron').ipcRenderer.on('shell-exit', (_, d) => cb(d)),
    onUpdateStatus: (cb) => window.require('electron').ipcRenderer.on('update-status', (_, d) => cb(d)),
    onCloseRequest: (cb) => window.require('electron').ipcRenderer.on('app-close-request', cb),
  };
}

function ConfirmDialog({ dialog, onClose }) {
  if (!dialog) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(1, 4, 9, 0.62)', backdropFilter: 'blur(8px)' }}>
      <div style={{ width: 430, padding: 20, borderRadius: 16, border: '1px solid rgba(88, 166, 255, 0.22)', background: 'linear-gradient(180deg, #161b22, #0d1117)', boxShadow: '0 24px 70px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(88,166,255,0.14)', color: '#58a6ff', fontSize: 20 }}>{dialog.icon || '?'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#f0f6fc', fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{dialog.title}</div>
            <div style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{dialog.message}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          {dialog.actions.map((action) => (
            <button
              key={action.id}
              onClick={() => onClose(action.id)}
              style={{
                padding: '8px 13px',
                borderRadius: 9,
                border: action.primary ? '1px solid #2ea043' : '1px solid #30363d',
                background: action.primary ? '#238636' : '#161b22',
                color: action.danger ? '#ff7b72' : '#f0f6fc',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const { settingsLoaded, installedShells, updateSettings } = useStore();
  const [tabs, setTabs] = useState([{ id: 1, title: 'PowerShell', cwd: null, shell: 'PowerShell', sessionKey: 0 }]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const updatePromptedRef = useRef(false);
  const [nextTabId, setNextTabId] = useState(2);
  const settingsOpenRef = useRef(false);
  const settingsPanelRef = useRef(null);
  const settingsButtonRef = useRef(null);
  settingsOpenRef.current = settingsOpen;

  const askDialog = useCallback((options) => new Promise((resolve) => {
    setDialog({ ...options, resolve });
  }), []);

  const closeDialog = useCallback((result) => {
    setDialog(current => {
      current?.resolve?.(result);
      return null;
    });
  }, []);

  const createTab = useCallback((shell = 'PowerShell', title = 'PowerShell', cwd = null) => {
    const id = nextTabId;
    setNextTabId(id + 1);
    setTabs(prev => [...prev, { id, title, cwd, shell, sessionKey: 0 }]);
    setActiveTabId(id);
  }, [nextTabId]);

  const closeTab = useCallback(async (id) => {
    const tab = tabs.find(t => t.id === id);
    const running = await window.electron.isShellRunning(id);
    if (running) {
      const action = await askDialog({
        icon: '×',
        title: `Close ${tab?.title || 'terminal'}?`,
        message: 'A shell/process is still running in this tab. Closing it will stop that terminal session.',
        actions: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'close', label: 'Close tab', danger: true, primary: true },
        ],
      });
      if (action !== 'close') return;
      await window.electron.killShell(id);
    }

    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeTabId, askDialog, tabs]);

  const updateTabCwd = useCallback((id, cwd) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, cwd } : t));
  }, []);

  const runQuickCommand = useCallback((command) => {
    if (!activeTabId) return;
    window.electron.writePty({ tabId: activeTabId, data: `${command}\r` });
  }, [activeTabId]);

  const openWorkspaceFolder = useCallback(async (dir) => {
    if (!dir) return;

    await updateSettings({ workingDirectory: dir });
    await window.electron.rememberFolder(dir);

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) {
      createTab('PowerShell', 'PowerShell', dir);
      return;
    }

    const running = await window.electron.isShellRunning(activeTab.id);
    if (running) {
      const action = await askDialog({
        icon: '↗',
        title: 'Open folder in new tab?',
        message: 'The current tab has an active shell/process, so Termipro will not change its working directory in-place.',
        actions: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'new-tab', label: 'Open new tab', primary: true },
        ],
      });
      if (action === 'new-tab') createTab(activeTab.shell || 'PowerShell', activeTab.title || 'PowerShell', dir);
      return;
    }

    await window.electron.killShell(activeTab.id);
    setTabs(prev => prev.map(tab => tab.id === activeTab.id
      ? { ...tab, cwd: dir, sessionKey: (tab.sessionKey || 0) + 1 }
      : tab
    ));
  }, [activeTabId, askDialog, createTab, tabs, updateSettings]);

  const chooseWorkspaceFolder = useCallback(async () => {
    const dir = await window.electron.selectDirectory();
    if (dir) openWorkspaceFolder(dir);
  }, [openWorkspaceFolder]);

  useEffect(() => {
    const handler = () => {
      askDialog({
        icon: '▣',
        title: 'Close Termipro?',
        message: 'Hide to tray keeps all terminal processes running. Quit closes Termipro and stops terminal sessions.',
        actions: [
          { id: 'cancel', label: 'Cancel' },
          { id: 'quit', label: 'Quit', danger: true },
          { id: 'hide', label: 'Hide to tray', primary: true },
        ],
      }).then((action) => {
        if (action === 'hide') window.electron.hideToTray();
        if (action === 'quit') window.electron.quitApp();
      });
    };
    window.electron.onCloseRequest?.(handler);
    return () => window.electron.offCloseRequest?.(handler);
  }, [askDialog]);

  useEffect(() => {
    if (!settingsOpen) return;

    const onPointerDown = (event) => {
      if (settingsPanelRef.current?.contains(event.target)) return;
      if (settingsButtonRef.current?.contains(event.target)) return;
      setSettingsOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [settingsOpen]);

  useEffect(() => {
    const handler = (status) => {
      if (status?.state !== 'downloaded' || updatePromptedRef.current) return;
      updatePromptedRef.current = true;
      askDialog({
        icon: '↑',
        title: `Termipro ${status.version || ''} is ready`,
        message: 'The update has been downloaded. Restart now to install silently and reopen Termipro automatically.',
        actions: [
          { id: 'later', label: 'Later' },
          { id: 'restart', label: 'Restart now', primary: true },
        ],
      }).then((action) => {
        if (action === 'restart') window.electron.installUpdateNow();
      });
    };
    window.electron.onUpdateStatus?.(handler);
    return () => window.electron.offUpdateStatus?.(handler);
  }, [askDialog]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === ',') {
          e.preventDefault();
          setSettingsOpen(prev => !prev);
        } else if (e.key === 't') {
          e.preventDefault();
          createTab();
        } else if (e.key === 'w' && tabs.length > 1) {
          e.preventDefault();
          closeTab(activeTabId);
        }
      }
      if (e.key === 'Escape' && settingsOpenRef.current) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, tabs.length, createTab, closeTab]);

  if (!settingsLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0d1117' }}>
        <div style={{ color: '#8b949e', fontSize: 14 }}>Loading Termipro...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117', position: 'relative' }}>
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={setActiveTabId}
        onClose={closeTab}
        onAdd={createTab}
        shells={installedShells}
        activeTab={tabs.find(t => t.id === activeTabId)}
        onChooseFolder={chooseWorkspaceFolder}
        onOpenFolder={openWorkspaceFolder}
        onRunQuickCommand={runQuickCommand}
        settingsButtonRef={settingsButtonRef}
        onToggleSettings={() => setSettingsOpen(prev => !prev)}
      />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {tabs.map(tab => (
          <TerminalPanel
            key={`${tab.id}-${tab.sessionKey || 0}`}
            tabId={tab.id}
            active={tab.id === activeTabId}
            cwd={tab.cwd}
            shell={tab.shell}
            onCwdChange={(cwd) => updateTabCwd(tab.id, cwd)}
          />
        ))}
        {tabs.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#484f58', fontSize: 16 }}>
            Click <span style={{ margin: '0 4px', fontSize: 20 }}>+</span> to open a new terminal
          </div>
        )}
      </div>
      <SettingsPanel ref={settingsPanelRef} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConfirmDialog dialog={dialog} onClose={closeDialog} />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}
