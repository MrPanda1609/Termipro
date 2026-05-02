# Termipro

Termipro is a Windows desktop terminal built with Electron, React, Vite, xterm.js, and node-pty.

## Features

- PowerShell, Command Prompt, Git Bash, and WSL detection.
- Multi-tab terminal UI.
- Theme, font, cursor, opacity, scrollback, and working-directory settings.
- Windows installer that creates Desktop and Start Menu shortcuts.
- Auto-update check on app startup through GitHub Releases.

## Install as a Windows app

1. Open the latest release: https://github.com/MrPanda1609/Termipro/releases/latest
2. Download `Termipro Setup x.y.z.exe`.
3. Run the installer.
4. Keep `Create Desktop Shortcut` enabled during installation.
5. Launch Termipro from the Desktop shortcut or Start Menu.

Termipro checks for updates each time it starts. If a newer GitHub Release is available, the app downloads it and asks to restart when the update is ready.

## Development setup

Requirements:

- Windows 10/11
- Node.js 18 or newer
- npm

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Build the web and Electron bundles:

```bash
npm run build
npm run build:electron
```

Build the Windows installer:

```bash
npm run electron:build
```

The installer is generated in `release/`.

## Publishing releases for auto-update

Auto-update uses `electron-updater` with the GitHub provider configured for `MrPanda1609/Termipro`.

1. Update the version in `package.json`.
2. Build the release:

   ```bash
   npm run electron:build
   ```

3. Create a GitHub Release tag that matches the version, for example `v1.0.1`.
4. Upload these generated files from `release/` to the GitHub Release:
   - `Termipro Setup x.y.z.exe`
   - `latest.yml`
   - the matching `.blockmap` files, if generated
5. Publish the release.

Existing installed copies will detect the new release the next time Termipro opens.

## Useful commands

```bash
npm run dev             # run Vite + Electron in development
npm run build           # build renderer
npm run build:electron  # build Electron main process
npm run electron:build  # build installer in release/
```

## Notes

- Git Bash is detected from `C:\Program Files\Git\bin\bash.exe`.
- WSL is shown when `wsl --status` succeeds.
- Settings are stored under the app user-data directory.
