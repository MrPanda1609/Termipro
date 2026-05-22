import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { useStore } from '../store/index.jsx';
import { getThemeColors } from '../themes/index.jsx';

// Sequences that toggle the alternate screen buffer. CLIs like Claude Code,
// Augment, Luma enter this buffer to draw full-screen pickers / option menus.
// While the alt buffer is active we must stop rewriting CSI sequences and
// stop popping Termipro's own autocomplete, otherwise the menu gets corrupted.
const ALT_ENTER_RE = /\x1b\[\?(?:1049|1047|47)h/;
const ALT_EXIT_RE = /\x1b\[\?(?:1049|1047|47)l/;

function enforceCursorPreferences(data, settings) {
  if (!settings.cursor.blink) return data;

  const style = settings.cursor.style === 'underline'
    ? '3'
    : settings.cursor.style === 'bar'
      ? '5'
      : '1';

  // DECSCUSR: 0/1 blinking block, 2 steady block, 3 blinking underline,
  // 4 steady underline, 5 blinking bar, 6 steady bar. Luma / Claude / Augment
  // emit steady shapes inside their TUI — rewrite so the chat caret keeps
  // blinking per user preference. DECTCEM (show/hide) is untouched so the CLI
  // can still hide the cursor while drawing menus.
  return data.replace(/\x1b\[(?:\d+)? q/g, `\x1b[${style} q`);
}

function getWindowsPtyConfig() {
  if (typeof window === 'undefined') return undefined;
  try {
    const os = window.require?.('os');
    if (!os || os.platform() !== 'win32') return undefined;
    const release = String(os.release() || '');
    const parts = release.split('.').map((n) => parseInt(n, 10));
    const buildNumber = Number.isFinite(parts[2]) ? parts[2] : 0;
    return { backend: 'conpty', buildNumber };
  } catch {
    return undefined;
  }
}

function getInputValue(input) {
  return typeof input === 'string' ? input : '';
}

function isImageFile(file) {
  const filePath = getFilePath(file);
  return file?.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(filePath || file?.name || '');
}

function getFilePath(file) {
  return window.electron?.getPathForFile?.(file) || file?.path || file?.webkitRelativePath || file?.name || '';
}

function quotePath(filePath) {
  const value = String(filePath || '');
  if (!value) return '';
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
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
  // True while the PTY is drawing on the alternate screen buffer (TUI / menu).
  const altScreenRef = useRef(false);
  const { settings } = useStore();
  const settingsRef = useRef(settings);
  const theme = getThemeColors(settings.colorTheme);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [suggestionPosition, setSuggestionPosition] = useState({ left: 12, top: 36 });
  const [contextMenu, setContextMenu] = useState(null);

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

  const updateSuggestionPosition = () => {
    const term = terminalRef.current;
    const container = containerRef.current;
    if (!term || !container) return;

    const cell = term._core?._renderService?.dimensions?.css?.cell;
    const cellWidth = cell?.width || Math.max(7, settingsRef.current.font.size * 0.6);
    const cellHeight = cell?.height || Math.max(16, settingsRef.current.font.size * 1.35);
    const left = 12 + Math.min(Math.max(0, container.clientWidth - 292), Math.max(0, term.buffer.active.cursorX * cellWidth));
    const top = 8 + Math.min(Math.max(0, container.clientHeight - 220), Math.max(0, (term.buffer.active.cursorY + 1) * cellHeight + 4));

    setSuggestionPosition({ left, top });
  };

  const scheduleSuggestions = () => {
    clearTimeout(suggestionTimerRef.current);
    // Don't fight the CLI for screen space while it's drawing a menu.
    if (altScreenRef.current) {
      hideSuggestions();
      return;
    }
    const input = getInputValue(inputRef.current);
    if (!input.trim()) {
      hideSuggestions();
      return;
    }

    suggestionTimerRef.current = setTimeout(async () => {
      if (altScreenRef.current) return;
      const items = await window.electron.getAutocompleteSuggestions?.({ input, cwd: cwdRef.current });
      if (inputRef.current !== input) return;
      updateSuggestionPosition();
      suggestionsRef.current = items || [];
      selectedSuggestionRef.current = 0;
      setSuggestions(suggestionsRef.current);
      setSelectedSuggestion(0);
    }, 120);
  };

  const trackInput = (data) => {
    // While a TUI menu owns the buffer the user is navigating with arrows /
    // escape sequences; treating those as shell input would both pollute the
    // suggestion list and ghost-type into the picker.
    if (altScreenRef.current) {
      if (suggestionsRef.current.length) hideSuggestions();
      return;
    }
    const str = String(data);
    // Skip raw escape sequences (arrow keys, function keys, paste markers).
    if (str.charCodeAt(0) === 0x1b) return;
    for (const ch of str) {
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

  const sendImageToCli = (filePath) => {
    if (!window.electron.writeClipboardImage?.(filePath)) return false;
    window.electron.writePty({ tabId: tabIdRef.current, data: '\x16' });
    terminalRef.current?.focus();
    return true;
  };

  const sendFilePathsToTerminal = (files) => {
    const paths = files.map(getFilePath).filter(Boolean).map(quotePath).join(' ');
    if (!paths) return;
    inputRef.current += paths;
    window.electron.writePty({ tabId: tabIdRef.current, data: paths });
    terminalRef.current?.focus();
  };

  const handleDroppedFiles = (files) => {
    if (!active || !files?.length) return;
    const image = files.find(isImageFile);
    const imagePath = getFilePath(image);
    if (imagePath && sendImageToCli(imagePath)) return;
    sendFilePathsToTerminal(files);
  };

  const copySelection = () => {
    const term = terminalRef.current;
    if (!term) return false;
    const sel = term.getSelection();
    if (!sel) return false;
    window.require('electron').clipboard.writeText(sel);
    term.clearSelection();
    return true;
  };

  const pasteFromClipboard = () => {
    const term = terminalRef.current;
    if (!term) return;
    const text = window.electron.readClipboardText?.() || '';
    if (text.length > 0) {
      if (term.modes?.bracketedPasteMode) {
        term.paste(text);
      } else {
        window.electron.writePty({ tabId: tabIdRef.current, data: text });
      }
    } else if (window.electron.hasClipboardImage?.()) {
      window.electron.writePty({ tabId: tabIdRef.current, data: '\x16' });
    }
    term.focus();
  };

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const windowsPty = getWindowsPtyConfig();
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
      // On Win11 conpty (build >= 21376) xterm should keep reflow on so option
      // pickers from Claude / Augment / Luma render their boxes correctly.
      // The deprecated `windowsMode` flag forced reflow off and broke menus.
      ...(windowsPty ? { windowsPty } : {}),
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

    const updateAltScreen = () => {
      const next = term.buffer.active.type === 'alternate';
      if (next === altScreenRef.current) return;
      altScreenRef.current = next;
      if (next) {
        // Entered TUI: drop our autocomplete and forget the half-typed input.
        inputRef.current = '';
        clearTimeout(suggestionTimerRef.current);
        hideSuggestions();
      }
    };

    const onDataHandler = ({ tabId: tId, data }) => {
      if (tId !== tabIdRef.current) return;
      const mightToggleAlt = ALT_ENTER_RE.test(data) || ALT_EXIT_RE.test(data);
      term.write(enforceCursorPreferences(data, settingsRef.current), () => {
        if (mightToggleAlt) updateAltScreen();
      });
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

      // Shift+Enter: soft newline for AI chat. Bare LF works in Claude Code,
      // Augment, Luma and falls back to a literal newline in normal shells.
      // We must intercept before xterm translates Enter to CR, otherwise
      // the CLI sees a submit instead of a continuation.
      if (event.key === 'Enter' && event.shiftKey) {
        const bracketed = term.modes?.bracketedPasteMode;
        const payload = bracketed ? '\x1b[200~\n\x1b[201~' : '\n';
        window.electron.writePty({ tabId: tabIdRef.current, data: payload });
        event.preventDefault();
        return false;
      }

      // Ctrl+V: clipboard-aware paste.
      //   image-only -> forward ^V so the CLI reads the bitmap itself.
      //   text       -> call term.paste so xterm wraps it in bracketed paste
      //                 (or sends raw) according to the CLI's current mode.
      // Returning false stops xterm from also sending a raw ^V byte, which
      // was producing the "no image in clipboard" line in Claude before text.
      if (event.key.toLowerCase() === 'v' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        const text = window.electron.readClipboardText?.() || '';
        if (text.length > 0) {
          term.paste(text);
        } else if (window.electron.hasClipboardImage?.()) {
          window.electron.writePty({ tabId: tabIdRef.current, data: '\x16' });
        }
        event.preventDefault();
        return false;
      }

      // Ctrl+C: copy when there is a selection, otherwise let xterm send SIGINT.
      if (event.key.toLowerCase() === 'c' && event.ctrlKey && !event.shiftKey && !event.altKey) {
        const sel = term.getSelection();
        if (sel) {
          window.require('electron').clipboard.writeText(sel);
          term.clearSelection();
          event.preventDefault();
          return false;
        }
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
          // Short debounce so a CLI redrawing its popup picks up the new size
          // immediately. The previous 400ms latency caused menus to wrap at
          // the old width while the user was still resizing.
          resizeCommitRef.current = setTimeout(() => {
            window.electron.resizePty({ tabId: tabIdRef.current, cols: nextSize.cols, rows: nextSize.rows });
          }, 60);
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

    const onContextMenu = (event) => {
      event.preventDefault();
      const hasSel = Boolean(term.getSelection());
      setContextMenu({ x: event.clientX, y: event.clientY, hasSel });
    };
    containerRef.current.addEventListener('contextmenu', onContextMenu);

    const onDragOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleDroppedFiles(Array.from(event.dataTransfer.files || []));
    };
    containerRef.current.addEventListener('dragover', onDragOver);
    containerRef.current.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);

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
      containerRef.current?.removeEventListener('contextmenu', onContextMenu);
      containerRef.current?.removeEventListener('dragover', onDragOver);
      containerRef.current?.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
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
        }, 60);
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
            left: suggestionPosition.left,
            top: suggestionPosition.top,
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
      {active && contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 500,
            minWidth: 160,
            padding: 6,
            borderRadius: 9,
            border: `1px solid ${theme.brightBlack}`,
            background: 'rgba(22, 27, 34, 0.98)',
            boxShadow: '0 14px 34px rgba(0,0,0,0.45)',
          }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.hasSel && (
            <button
              onMouseDown={(e) => { e.preventDefault(); copySelection(); setContextMenu(null); }}
              style={ctxItemStyle(theme)}
            >
              Copy
            </button>
          )}
          <button
            onMouseDown={(e) => { e.preventDefault(); pasteFromClipboard(); setContextMenu(null); }}
            style={ctxItemStyle(theme)}
          >
            Paste
          </button>
        </div>
      )}
    </div>
  );
}

function ctxItemStyle(theme) {
  return {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    textAlign: 'left',
    color: theme.foreground,
    background: 'transparent',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    fontSize: 13,
  };
}
