import { useState } from 'react';
import { useStore } from '../store/index.jsx';
import { COLOR_THEMES, getThemePreviewColors } from '../themes/index.jsx';
import logoUrl from '../../pic/logo.png';

const FONT_FAMILIES = [
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Ubuntu Mono',
  'Courier New',
  'monospace',
];

export default function SettingsPanel({ open, onClose }) {
  const { settings, updateSettings, updateNested, installedShells } = useStore();
  const [browseHover, setBrowseHover] = useState(false);

  const themeEntries = Object.entries(COLOR_THEMES);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: '#0d1117',
        borderLeft: '1px solid #21262d',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        opacity: open ? 1 : 0,
        transition: 'transform 0.25s ease-out, opacity 0.2s ease-out',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid #21262d',
      }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#c9d1d9' }}>Settings</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            fontSize: 20,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

        <Section title="Application">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            border: '1px solid #30363d',
            borderRadius: 8,
            background: '#161b22',
          }}>
            <img src={logoUrl} alt="Termipro" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 8 }} />
            <div>
              <div style={{ color: '#c9d1d9', fontWeight: 600, fontSize: 13 }}>Termipro</div>
              <div style={{ color: '#8b949e', fontSize: 11 }}>Modern AI coding terminal</div>
            </div>
          </div>
        </Section>

        {/* ── FONT ── */}
        <Section title="Font">
          <Field label="Family">
            <select
              value={settings.font.family}
              onChange={(e) => updateNested('font', 'family', e.target.value)}
              style={selectStyle}
            >
              {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Size">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => updateNested('font', 'size', Math.max(8, settings.font.size - 1))}
                style={sizeBtnStyle}
              >
                −
              </button>
              <span style={{ color: '#c9d1d9', fontSize: 14, minWidth: 40, textAlign: 'center' }}>
                {settings.font.size}px
              </span>
              <button
                onClick={() => updateNested('font', 'size', Math.min(32, settings.font.size + 1))}
                style={sizeBtnStyle}
              >
                +
              </button>
            </div>
          </Field>
        </Section>

        {/* ── CURSOR ── */}
        <Section title="Cursor">
          <Field label="Style">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { id: 'bar', label: '| Bar' },
                { id: 'block', label: '█ Block' },
                { id: 'underline', label: '‾ Underline' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => updateNested('cursor', 'style', s.id)}
                  style={{
                    ...cursorBtnStyle,
                    ...(settings.cursor.style === s.id ? cursorBtnActive : {}),
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Blink">
            <Toggle
              checked={settings.cursor.blink}
              onChange={(v) => updateNested('cursor', 'blink', v)}
            />
          </Field>
        </Section>

        {/* ── SHELL ── */}
        <Section title="Shell">
          <Field label="Program">
            <select
              value={settings.shell}
              onChange={(e) => updateSettings({ shell: e.target.value })}
              style={selectStyle}
            >
              {installedShells.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ── WINDOW OPACITY ── */}
        <Section title="Window Opacity">
          <SliderField
            value={settings.windowOpacity}
            min={50}
            max={100}
            step={5}
            onChange={(v) => updateSettings({ windowOpacity: v })}
            display={`${settings.windowOpacity}%`}
          />
        </Section>

        {/* ── SCROLLBACK LINES ── */}
        <Section title="Scrollback Lines">
          <SliderField
            value={settings.scrollbackLines}
            min={1000}
            max={50000}
            step={1000}
            onChange={(v) => updateSettings({ scrollbackLines: v })}
            display={settings.scrollbackLines.toLocaleString()}
          />
        </Section>

        {/* ── WORKING DIRECTORY ── */}
        <Section title="Default Working Directory">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={settings.workingDirectory}
              onChange={(e) => updateSettings({ workingDirectory: e.target.value })}
              style={{
                ...inputStyle,
                flex: 1,
              }}
            />
            <button
              onClick={async () => {
                const dir = await window.electron.selectDirectory();
                if (dir) updateSettings({ workingDirectory: dir });
              }}
              onMouseEnter={() => setBrowseHover(true)}
              onMouseLeave={() => setBrowseHover(false)}
              style={{
                ...browseBtnStyle,
                ...(browseHover ? browseBtnHover : {}),
              }}
            >
              Browse
            </button>
          </div>
        </Section>

        {/* ── COLOR THEME ── */}
        <Section title="Color Theme">
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}>
            {themeEntries.map(([name]) => (
              <ThemeSwatch
                key={name}
                name={name}
                active={settings.colorTheme === name}
                onClick={() => updateSettings({ colorTheme: name })}
              />
            ))}
          </div>
        </Section>

      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#8b949e',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: 'block',
        fontSize: 12,
        color: '#8b949e',
        marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function SliderField({ value, min, max, step, onChange, display }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: '#58a6ff' }}
      />
      <span style={{ color: '#8b949e', fontSize: 12, minWidth: 50, textAlign: 'right' }}>
        {display}
      </span>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? '#238636' : '#30363d',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute',
        top: 2,
        left: checked ? 22 : 2,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
      }} />
    </div>
  );
}

function ThemeSwatch({ name, active, onClick }) {
  const colors = getThemePreviewColors(name);
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '10px 8px',
        borderRadius: 8,
        border: active ? '2px solid #58a6ff' : '2px solid transparent',
        background: active ? 'rgba(88, 166, 255, 0.08)' : 'rgba(255,255,255,0.02)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', gap: 2 }}>
        {colors.map((c, i) => (
          <div key={i} style={{ width: 18, height: 14, borderRadius: 2, background: c }} />
        ))}
      </div>
      <span style={{ fontSize: 11, color: active ? '#58a6ff' : '#8b949e' }}>
        {name}
      </span>
    </button>
  );
}

// ── Shared styles ──

const selectStyle = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  color: '#c9d1d9',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  outline: 'none',
  cursor: 'pointer',
};

const sizeBtnStyle = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 16,
  color: '#c9d1d9',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
};

const cursorBtnStyle = {
  padding: '6px 12px',
  fontSize: 12,
  color: '#8b949e',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const cursorBtnActive = {
  color: '#58a6ff',
  borderColor: '#58a6ff',
  background: 'rgba(88, 166, 255, 0.08)',
};

const inputStyle = {
  padding: '7px 10px',
  fontSize: 13,
  color: '#c9d1d9',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  outline: 'none',
};

const browseBtnStyle = {
  padding: '7px 14px',
  fontSize: 13,
  color: '#c9d1d9',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'all 0.15s',
};

const browseBtnHover = {
  borderColor: '#58a6ff',
  color: '#58a6ff',
};
