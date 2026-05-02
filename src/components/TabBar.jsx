import { useState } from 'react';
import { useStore } from '../store/index.jsx';
import { getThemeColors } from '../themes/index.jsx';

const DEFAULT_SHELLS = [
  { id: 'PowerShell', name: 'PowerShell' },
  { id: 'cmd', name: 'Command Prompt' },
];

export default function TabBar({ tabs, activeTabId, activeTab, onActivate, onClose, onAdd, shells = DEFAULT_SHELLS, onChooseFolder, onToggleSettings }) {
  const { settings } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = getThemeColors(settings.colorTheme);
  const surface = soften(theme.background, 0.08);
  const surface2 = soften(theme.background, 0.14);
  const border = soften(theme.background, 0.24);

  const createShell = (shell) => {
    setMenuOpen(false);
    onAdd(shell.id, shell.name);
  };

  return (
    <div style={{
      height: 40,
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      alignItems: 'stretch',
      background: `linear-gradient(180deg, ${surface2}, ${surface})`,
      borderBottom: `1px solid ${border}`,
      color: theme.foreground,
      WebkitAppRegion: 'drag',
      userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'end', gap: 4, minWidth: 0, paddingTop: 5, paddingLeft: 8 }}>
        <button
          className="titlebar-btn"
          onClick={onChooseFolder}
          style={folderButton(theme)}
          title={activeTab?.cwd ? `Change folder: ${activeTab.cwd}` : 'Choose working folder'}
        >
          <span style={{ fontSize: 15 }}>📁</span>
          <span style={{ maxWidth: 86, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {shortFolderName(activeTab?.cwd) || 'Folder'}
          </span>
        </button>

        {tabs.map(tab => {
          const active = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              style={{
                WebkitAppRegion: 'no-drag',
                height: 32,
                minWidth: 118,
                maxWidth: 220,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '0 10px 0 13px',
                color: active ? theme.foreground : theme.brightBlack,
                background: active ? theme.background : 'transparent',
                border: `1px solid ${active ? border : 'transparent'}`,
                borderBottomColor: active ? theme.background : 'transparent',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                fontSize: 13,
                outline: 'none',
              }}
              title={tab.cwd || tab.title}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  style={{ color: theme.brightBlack, fontSize: 16, lineHeight: 1, padding: '0 2px' }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', position: 'relative', WebkitAppRegion: 'no-drag' }}>
          <button className="titlebar-btn" onClick={() => onAdd('PowerShell', 'PowerShell')} style={addButton(theme)} title="New PowerShell tab (Ctrl+T)">+</button>
          <button className="titlebar-btn" onClick={() => setMenuOpen(v => !v)} style={dropButton(theme)} title="Choose terminal">▾</button>
          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: 34,
              left: 0,
              minWidth: 190,
              padding: 6,
              borderRadius: 9,
              border: `1px solid ${border}`,
              background: surface2,
              boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
              zIndex: 200,
            }}>
              {(shells.length ? shells : DEFAULT_SHELLS).map(shell => (
                <button
                  key={shell.id}
                  className="menu-item"
                  onClick={() => createShell(shell)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '8px 10px',
                    textAlign: 'left',
                    color: theme.foreground,
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 7,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {shell.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
        <button className="titlebar-btn" onClick={onToggleSettings} title="Settings (Ctrl+,)" style={iconButton(theme)}>⚙</button>
        <button className="window-btn" onClick={() => window.electron.minimizeWindow()} title="Minimize" style={windowButton(theme)}>─</button>
        <button className="window-btn" onClick={() => window.electron.toggleMaximizeWindow()} title="Maximize" style={windowButton(theme)}>□</button>
        <button className="window-btn window-btn-close" onClick={() => window.electron.closeWindow()} title="Close" style={closeButton(theme)}>×</button>
      </div>
    </div>
  );
}

function iconButton(theme) {
  return {
    width: 42,
    height: 38,
    color: theme.brightBlue || theme.blue,
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid rgba(255,255,255,0.08)`,
    borderRadius: 8,
    marginRight: 6,
    cursor: 'pointer',
    fontSize: 16,
  };
}

function addButton(theme) {
  return {
    width: 30,
    height: 32,
    color: theme.brightBlue || theme.blue,
    background: 'transparent',
    border: 'none',
    borderRadius: '7px 0 0 7px',
    cursor: 'pointer',
    fontSize: 20,
    lineHeight: 1,
  };
}

function folderButton(theme) {
  return {
    WebkitAppRegion: 'no-drag',
    height: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    maxWidth: 132,
    padding: '0 10px',
    color: theme.brightBlue || theme.blue,
    background: 'rgba(88, 166, 255, 0.08)',
    border: '1px solid rgba(88, 166, 255, 0.18)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    marginRight: 4,
  };
}

function dropButton(theme) {
  return {
    width: 26,
    height: 32,
    color: theme.brightBlue || theme.blue,
    background: 'rgba(88, 166, 255, 0.08)',
    border: `1px solid rgba(88, 166, 255, 0.18)`,
    borderLeft: 'none',
    borderRadius: '0 7px 7px 0',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1,
  };
}

function windowButton(theme) {
  return {
    width: 46,
    height: 40,
    color: theme.foreground,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
  };
}

function closeButton(theme) {
  return {
    ...windowButton(theme),
    fontSize: 22,
  };
}

function soften(hex, amount) {
  const value = hex.replace('#', '');
  const n = parseInt(value.length === 3 ? value.split('').map(x => x + x).join('') : value, 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + 255 * amount));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + 255 * amount));
  const b = Math.min(255, Math.round((n & 255) + 255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function folderName(folder) {
  if (!folder) return '';
  const normalized = folder.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || normalized;
}

function shortFolderName(folder) {
  const name = folderName(folder);
  if (name.length <= 14) return name;
  return `${name.slice(0, 6)}…${name.slice(-5)}`;
}
