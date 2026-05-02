import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { getThemeColors } from '../themes/index.jsx';

export function useTerminal(containerRef, tabId, settings) {
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const [terminal, setTerminal] = useState(null);

  const createTerminal = useCallback(() => {
    if (terminalRef.current || !containerRef.current) return;

    const term = new Terminal({
      fontFamily: settings.font.family,
      fontSize: settings.font.size,
      cursorStyle: settings.cursor.style,
      cursorBlink: settings.cursor.blink,
      scrollback: settings.scrollbackLines,
      theme: getThemeColors(settings.colorTheme),
      allowProposedApi: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();
    fitAddonRef.current = fitAddon;
    terminalRef.current = term;

    // Listen for resize
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(containerRef.current);

    setTerminal(term);
    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, settings]);

  // Apply settings changes
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = terminalRef.current;
    const theme = getThemeColors(settings.colorTheme);
    term.options.fontFamily = settings.font.family;
    term.options.fontSize = settings.font.size;
    term.options.cursorStyle = settings.cursor.style;
    term.options.cursorBlink = settings.cursor.blink;
    term.options.scrollback = settings.scrollbackLines;
    term.options.theme = theme;
    fitAddonRef.current?.fit();
  }, [settings]);

  return { terminal, fitAddon: fitAddonRef.current, createTerminal };
}
