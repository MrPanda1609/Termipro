import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const StoreContext = createContext();

const DEFAULT_SETTINGS = {
  font: { family: 'Cascadia Code', size: 14 },
  cursor: { style: 'bar', blink: true },
  shell: 'PowerShell',
  windowOpacity: 100,
  scrollbackLines: 11000,
  workingDirectory: '',
  colorTheme: 'GitHub Dark',
};

export function StoreProvider({ children }) {
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [installedShells, setInstalledShells] = useState([]);

  // Load initial data
  useEffect(() => {
    Promise.all([
      window.electron.getSettings(),
      window.electron.getWorkspaces(),
      window.electron.getInstalledShells(),
    ]).then(([s, w, sh]) => {
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setWorkspaces(w);
      setInstalledShells(sh);
      setSettingsLoaded(true);
    });
  }, []);

  const updateSettings = useCallback(async (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    await window.electron.saveSettings(next);
  }, [settings]);

  const updateNested = useCallback(async (key, nestedKey, value) => {
    const next = {
      ...settings,
      [key]: { ...settings[key], [nestedKey]: value },
    };
    setSettings(next);
    await window.electron.saveSettings(next);
  }, [settings]);

  const updateWorkspace = useCallback(async (ws) => {
    const next = [...workspaces, ws];
    setWorkspaces(next);
    await window.electron.saveWorkspaces(next);
  }, [workspaces]);

  return (
    <StoreContext.Provider value={{
      settings,
      settingsLoaded,
      workspaces,
      installedShells,
      updateSettings,
      updateNested,
      updateWorkspace,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
