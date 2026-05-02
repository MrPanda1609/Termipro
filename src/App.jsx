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
    readClipboardText: () => window.require('electron').clipboard.readText(),
    hasClipboardImage: () => !window.require('electron').clipboard.readImage().isEmpty(),
    minimizeWindow: () => window.require('electron').ipcRenderer.invoke('window-minimize'),
    toggleMaximizeWindow: () => window.require('electron').ipcRenderer.invoke('window-toggle-maximize'),
    closeWindow: () => window.require('electron').ipcRenderer.invoke('window-close'),
    getWorkspaces: () => window.require('electron').ipcRenderer.invoke('get-workspaces'),
    saveWorkspaces: (ws) => window.require('electron').ipcRenderer.invoke('save-workspaces', ws),
    checkForUpdates: () => window.require('electron').ipcRenderer.invoke('check-for-updates'),
    offUpdateStatus: (cb) => window.require('electron').ipcRenderer.removeListener('update-status', cb),
    onPtyData: (cb) => window.require('electron').ipcRenderer.on('shell-data', (_, d) => cb(d)),
    onShellClear: (cb) => window.require('electron').ipcRenderer.on('shell-clear', (_, d) => cb(d)),
    onPtyExit: (cb) => window.require('electron').ipcRenderer.on('shell-exit', (_, d) => cb(d)),
    onUpdateStatus: (cb) => window.require('electron').ipcRenderer.on('update-status', (_, d) => cb(d)),
  };
}

function AppContent() {
  const { settingsLoaded, installedShells, updateSettings } = useStore();
  const [tabs, setTabs] = useState([{ id: 1, title: 'PowerShell', cwd: null, shell: 'PowerShell', sessionKey: 0 }]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nextTabId, setNextTabId] = useState(2);
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;

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
      const ok = window.confirm(`Close "${tab?.title || 'terminal'}"?\n\nA shell/process is still running in this tab.`);
      if (!ok) return;
      await window.electron.killShell(id);
    }

    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeTabId, tabs]);

  const updateTabCwd = useCallback((id, cwd) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, cwd } : t));
  }, []);

  const chooseWorkspaceFolder = useCallback(async () => {
    const dir = await window.electron.selectDirectory();
    if (!dir) return;

    await updateSettings({ workingDirectory: dir });

    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) {
      createTab('PowerShell', 'PowerShell', dir);
      return;
    }

    const running = await window.electron.isShellRunning(activeTab.id);
    if (running) {
      const openNew = window.confirm(
        `Open selected folder in a new tab?\n\nThe current tab has an active shell/process, so Termipro will not change its working directory in-place.`
      );
      if (openNew) createTab(activeTab.shell || 'PowerShell', activeTab.title || 'PowerShell', dir);
      return;
    }

    await window.electron.killShell(activeTab.id);
    setTabs(prev => prev.map(tab => tab.id === activeTab.id
      ? { ...tab, cwd: dir, sessionKey: (tab.sessionKey || 0) + 1 }
      : tab
    ));
  }, [activeTabId, createTab, tabs, updateSettings]);

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
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
