import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { useStore } from '../store/index.jsx';
import { getThemeColors } from '../themes/index.jsx';

function enforceCursorPreferences(data, settings) {
  if (!settings.cursor.blink) return data;

  const style = settings.cursor.style === 'underline'
    ? '3'
    : settings.cursor.style === 'bar'
      ? '5'
      : '1';

  // DECSCUSR: 0/1 blinking block, 2 steady block, 3 blinking underline,
  // 4 steady underline, 5 blinking bar, 6 steady bar. Luma currently emits
  // steady block (\x1b[2 q); normalize cursor-shape requests to Termipro's
  // blinking preference so the app setting remains authoritative.
  return data.replace(/\x1b\[(?:\d+)? q/g, `\x1b[${style} q`);
}

function getInputValue(input) {
  return typeof input === 'string' ? input : '';
}

export default function TerminalPanel({ tabId, active, cwd, shell, onCwdChange }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const resizeCommitRef = useRef(null);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  const tabIdRef = useRef(tabId);
  const cwdRef = useRef(cwd);
  const inputRef = useRef('');
  const suggestionsRef = useRef([]);
  const selectedSuggestionRef = useRef(0);
  const suggestionTimerRef = useRef(null);
  const { settings } = useStore();
  const settingsRef = useRef(settings);
  const theme = getThemeColors(settings.colorTheme);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  settingsRef.current = settings;
  cwdRef.current = cwd;
  suggestionsRef.current = suggestions;
  selectedSuggestionRef.current = selectedSuggestion;

  useEffect(() => {
    tabIdRef.current = tabId;
  }, [tabId]);

  const hideSuggestions = () => {
    suggestionsRef.current = [];
    selectedSuggestionRef.current = 0;
    setSuggestions([]);
    setSelectedSuggestion(0);
  };

  const scheduleSuggestions = () => {
    clearTimeout(suggestionTimerRef.current);
    const input = getInputValue(inputRef.current);
    if (!input.trim()) {
      hideSuggestions();
      return;
    }

    suggestionTimerRef.current = setTimeout(async () => {
      const items = await window.electron.getAutocompleteSuggestions?.({ input, cwd: cwdRef.current });
      if (inputRef.current !== input) return;
      suggestionsRef.current = items || [];
      selectedSuggestionRef.current = 0;
      setSuggestions(suggestionsRef.current);
      setSelectedSuggestion(0);
    }, 120);
  };

  const trackInput = (data) => {
    for (const ch of String(data)) {
      if (ch === '\r' || ch === '\n') {
        inputRef.current = '';
        hideSuggestions();
      } else if (ch === '\b' || ch === '\x7f') {
        inputRef.current = inputRef.current.slice(0, -1);
      } else if (ch >= ' ' && ch !== '\x7f') {
        inputRef.current += ch;
      }
    }
    scheduleSuggestions();
  };

  const applySuggestion = (suggestion = suggestionsRef.current[selectedSuggestionRef.current]) => {
    if (!suggestion) return;

    const input = getInputValue(inputRef.current);
    const replaceFrom = Math.max(0, Math.min(input.length, suggestion.replaceFrom ?? 0));
    const nextInput = `${input.slice(0, replaceFrom)}${suggestion.insertText}`;
    const eraseCount = input.length - replaceFrom;
    const data = `${'\x7f'.repeat(eraseCount)}${suggestion.insertText}`;

    inputRef.current = nextInput;
    window.electron.writePty({ tabId: tabIdRef.current, data });
    hideSuggestions();
    terminalRef.current?.focus();
  };

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const term = new Terminal({
      fontFamily: settings.font.family,
      fontSize: settings.font.size,
      cursorStyle: settings.cursor.style,
      cursorBlink: settings.cursor.blink,
      scrollback: settings.scrollbackLines,
      theme,
      convertEol: true,
      allowProposedApi: true,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      windowsMode: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    containerRef.current.style.setProperty('--term-bg', theme.background);
    fitAddon.fit();
    term.focus();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    const onDataHandler = ({ tabId: tId, data }) => {
      if (tId === tabIdRef.current) term.write(enforceCursorPreferences(data, settingsRef.current));
    };
    const onExitHandler = ({ tabId: tId, exitCode }) => {
      if (tId === tabIdRef.current) {
        term.write(`\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      }
    };

    window.electron.onPtyData(onDataHandler);
    window.electron.onPtyExit(onExitHandler);

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;

      if (suggestionsRef.current.length > 0) {
        if (event.key === 'ArrowDown') {
          const next = (selectedSuggestionRef.current + 1) % suggestionsRef.current.length;
          selectedSuggestionRef.current = next;
          setSelectedSuggestion(next);
          event.preventDefault();
          return false;
        }
        if (event.key === 'ArrowUp') {
          const next = (selectedSuggestionRef.current - 1 + suggestionsRef.current.length) % suggestionsRef.current.length;
          selectedSuggestionRef.current = next;
          setSelectedSuggestion(next);
          event.preventDefault();
          return false;
        }
        if (event.key === 'Tab' || event.key === 'Enter') {
          applySuggestion();
          event.preventDefault();
          return false;
        }
        if (event.key === 'Escape') {
          hideSuggestions();
          event.preventDefault();
          return false;
        }
      }

      // Luma uses Alt+Enter for multiline. Termipro maps Shift+Enter to the
      // same terminal sequence so AI chat input feels natural.
      if (event.key === 'Enter' && event.shiftKey) {
        window.electron.writePty({ tabId: tabIdRef.current, data: '\x1b\r' });
        event.preventDefault();
        return false;
      }

      // Luma reads Ctrl+V as "paste image". If clipboard has text, we must not
      // forward raw Ctrl+V or Luma may attach a stale image instead of pasting
      // text. Use xterm paste so bracketed-paste text reaches the CLI.
      if (event.key.toLowerCase() === 'v' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        const text = window.electron.readClipboardText?.() || '';
        if (text.length > 0) {
          term.paste(text);
        } else if (window.electron.hasClipboardImage?.()) {
          window.electron.writePty({ tabId: tabIdRef.current, data: '\x16' });
        } else {
          term.paste('');
        }

        event.preventDefault();
        return false;
      }

      return true;
    });

    const dataDisposable = term.onData((data) => {
      trackInput(data);
      window.electron.writePty({ tabId: tabIdRef.current, data });
    });

    const resize = () => {
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(() => {
        fitAddon.fit();
        if (lastSizeRef.current.cols !== term.cols || lastSizeRef.current.rows !== term.rows) {
          const nextSize = { cols: term.cols, rows: term.rows };
          lastSizeRef.current = nextSize;
          clearTimeout(resizeCommitRef.current);
          resizeCommitRef.current = setTimeout(() => {
            window.electron.resizePty({ tabId: tabIdRef.current, cols: nextSize.cols, rows: nextSize.rows });
          }, 400);
        }
      });
    };

    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    const focus = () => term.focus();
    const scrollByPointer = (event) => {
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const maxLine = Math.max(0, term.buffer.active.length - term.rows);
      term.scrollToLine(Math.round(maxLine * ratio));
    };
    const onScrollbarMouseDown = (event) => {
      const rect = containerRef.current.getBoundingClientRect();
      if (event.clientX < rect.right - 16) return;

      event.preventDefault();
      event.stopPropagation();
      scrollByPointer(event);

      const onMouseMove = (moveEvent) => scrollByPointer(moveEvent);
      const onMouseUp = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        term.focus();
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
    containerRef.current.addEventListener('mousedown', focus);
    containerRef.current.addEventListener('mousedown', onScrollbarMouseDown, true);
    containerRef.current.addEventListener('click', focus);

    lastSizeRef.current = { cols: term.cols, rows: term.rows };
    window.electron.createPty({ cwd, tabId, shell, cols: term.cols, rows: term.rows }).then(async (result) => {
      if (!result?.success) {
        term.write(`\r\n\x1b[31mFailed to start shell: ${result?.error || 'unknown error'}\x1b[0m\r\n`);
        return;
      }
      if (result.cwd) onCwdChange?.(result.cwd);
      resize();
    });

    return () => {
      if (resizeFrameRef.current) cancelAnimationFrame(resizeFrameRef.current);
      clearTimeout(resizeCommitRef.current);
      clearTimeout(suggestionTimerRef.current);
      containerRef.current?.removeEventListener('mousedown', focus);
      containerRef.current?.removeEventListener('mousedown', onScrollbarMouseDown, true);
      containerRef.current?.removeEventListener('click', focus);
      dataDisposable?.dispose?.();
      ro.disconnect();
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.fontFamily = settings.font.family;
    term.options.fontSize = settings.font.size;
    term.options.cursorStyle = settings.cursor.style;
    term.options.cursorBlink = settings.cursor.blink;
    term.options.scrollback = settings.scrollbackLines;
    const nextTheme = getThemeColors(settings.colorTheme);
    term.options.theme = nextTheme;
    containerRef.current?.style.setProperty('--term-bg', nextTheme.background);
    fitAddonRef.current?.fit();
  }, [settings]);

  useEffect(() => {
    if (!active) return;
    const term = terminalRef.current;
    if (!term) return;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      term.focus();
      if (lastSizeRef.current.cols !== term.cols || lastSizeRef.current.rows !== term.rows) {
        const nextSize = { cols: term.cols, rows: term.rows };
        lastSizeRef.current = nextSize;
        clearTimeout(resizeCommitRef.current);
        resizeCommitRef.current = setTimeout(() => {
          window.electron.resizePty({ tabId: tabIdRef.current, cols: nextSize.cols, rows: nextSize.rows });
        }, 400);
      }
    });
  }, [active]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        display: active ? 'block' : 'none',
        background: theme.background,
        padding: '8px 12px',
      }}
    >
      {active && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            minWidth: 260,
            maxWidth: 520,
            padding: 6,
            borderRadius: 9,
            border: `1px solid ${theme.brightBlack}`,
            background: 'rgba(22, 27, 34, 0.98)',
            boxShadow: '0 14px 34px rgba(0, 0, 0, 0.35)',
            zIndex: 10,
          }}
        >
          {suggestions.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applySuggestion(item);
              }}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                padding: '7px 9px',
                border: 'none',
                borderRadius: 7,
                color: index === selectedSuggestion ? theme.brightWhite : theme.foreground,
                background: index === selectedSuggestion ? 'rgba(88, 166, 255, 0.18)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: settings.font.family,
                fontSize: 12,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
              <span style={{ color: theme.brightBlack, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
