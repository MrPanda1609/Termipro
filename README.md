<p align="center">
  <img src="pic/logo.png" alt="Termipro" width="120" />
</p>

<h1 align="center">Termipro</h1>

<p align="center">
  A polished Windows terminal built for AI coding workflows.
</p>

<p align="center">
  <a href="https://github.com/MrPanda1609/Termipro/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/MrPanda1609/Termipro?style=for-the-badge&label=release" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D4?style=for-the-badge&logo=windows" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-28-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=111" />
</p>

<p align="center">
  <a href="#download">Download</a>
  · <a href="#features">Features</a>
  · <a href="#demo">Demo</a>
  · <a href="#development">Development</a>
  · <a href="#releases--auto-update">Releases</a>
</p>

---

## Overview

Termipro is a desktop terminal for Windows that focuses on AI coding sessions: fast project switching, remembered commands, clean multi-tab shell access, automatic updates, and a polished UI around `xterm.js` + `node-pty`.

It is designed for developers who frequently work with AI coding CLIs, PowerShell, Git, Node.js, Bun, WSL, and project-specific workflows.

## Demo

GIFs are supported in GitHub README files. Add your recording here:

```text
docs/assets/demo.gif
```

Then uncomment this line:

<!-- <p align="center"><img src="docs/assets/demo.gif" alt="Termipro demo" width="900" /></p> -->

Recommended recording tools:

- ScreenToGif
- ShareX
- OBS Studio, exported to GIF or MP4

For best GitHub performance, keep the GIF under 10 MB.

## Features

### Terminal experience

- Multi-tab terminal UI.
- PowerShell, Command Prompt, Git Bash, and WSL detection.
- `xterm.js` rendering with resize support through `node-pty`.
- Colorful project prompt showing folder, app name, and version.
- Theme, font, cursor, opacity, and scrollback settings.
- Clipboard-aware paste behavior for AI coding CLIs.

### AI coding workflow

- Fast working-folder switcher.
- Recent folders dropdown with a `Choose...` fallback.
- Remembered commands per folder and per detected project.
- Quick command menu from the title bar.
- Autocomplete for common commands and `cd` directory targets.
- Click, arrow keys, `Tab`, or `Enter` to accept suggestions.

### Desktop app polish

- Windows installer with Desktop and Start Menu shortcuts.
- Auto-update through GitHub Releases.
- Silent update install after restart.
- Close-to-tray mode that keeps terminal processes running.
- In-app confirmation dialogs instead of default Windows message boxes.
- Dropdowns and Settings panel close automatically on outside click.

## Download

1. Open the latest release:
   <br />
   https://github.com/MrPanda1609/Termipro/releases/latest
2. Download the installer:
   ```text
   Termipro-Setup-x.y.z.exe
   ```
3. Run the installer.
4. Launch Termipro from the Desktop shortcut or Start Menu.

Termipro checks for updates when it starts. If a new version is available, it downloads the update and asks you to restart. The update installs silently and reopens Termipro automatically.

## Screenshots

Add screenshots to `docs/assets/` and update these paths:

```md
![Terminal](docs/assets/terminal.png)
![Settings](docs/assets/settings.png)
![Quick commands](docs/assets/quick-commands.png)
```

Suggested screenshots:

- Terminal with prompt and AI coding CLI.
- Recent folder dropdown.
- Quick commands menu.
- Settings panel.
- Update-ready modal.

## Keyboard and mouse notes

- `Ctrl + T`: new terminal tab.
- `Ctrl + W`: close current tab when multiple tabs exist.
- `Ctrl + ,`: open Settings.
- `Tab` / `Enter`: accept autocomplete suggestion.
- `ArrowUp` / `ArrowDown`: move through autocomplete suggestions.
- `Esc`: close Settings or autocomplete suggestions.

Some AI CLI tools implement their own mouse selection/copy behavior. If selection behaves differently inside a specific CLI, it is usually controlled by that CLI's mouse mode rather than the terminal renderer.

## Project detection

Termipro detects a project root by walking upward from the current folder and checking for common project markers:

- `.git`
- `package.json`
- `bun.lockb`
- `pnpm-lock.yaml`
- `yarn.lock`
- `requirements.txt`
- `pyproject.toml`
- `Cargo.toml`

Remembered commands are stored separately for:

- the current folder
- the detected project root

## Development

### Requirements

- Windows 10 or Windows 11
- Node.js 18 or newer
- npm
- Visual Studio Build Tools or Visual Studio Community with C++ build tools, required by `node-pty` when native rebuilds are needed

### Install dependencies

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Build renderer and Electron main process

```bash
npm run build
npm run build:electron
```

### Build Windows installer

```bash
npm run electron:build
```

Generated release files are written to:

```text
release/
```

## Releases & auto-update

Auto-update is powered by `electron-updater` and GitHub Releases.

The release assets must be publicly reachable. If the repository or release assets are private, installed apps cannot read `latest.yml` without authentication.

### Publish a new version

1. Update the version in `package.json`.
2. Build the installer:
   ```bash
   npm run electron:build
   ```
3. Create a GitHub Release using a tag like:
   ```text
   v1.0.9
   ```
4. Upload these files from `release/`:
   ```text
   Termipro-Setup-x.y.z.exe
   Termipro-Setup-x.y.z.exe.blockmap
   latest.yml
   ```
5. Publish the release.

Existing installed copies will detect the new version on startup or when the user clicks `Check for updates` in Settings.

## Useful commands

```bash
npm run dev             # Run Vite + Electron in development
npm run build           # Build the renderer
npm run build:electron  # Build Electron main process
npm run electron:build  # Build Windows installer
```

## Tech stack

- Electron
- React
- Vite
- xterm.js
- node-pty
- electron-builder
- electron-updater

## Data storage

Termipro stores user data under Electron's app user-data directory, including:

- settings
- workspaces
- recent folders
- remembered command history

## License

No license has been declared yet. Add a `LICENSE` file before distributing broadly.
