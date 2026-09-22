# Quiet Chrome

Launch your existing Chrome without the “started debugging this browser” banner.

Same Chrome, same profiles, extensions, logins, and updates. A dependency-free setup CLI with an optional native Dock helper.

## Install

Requires **macOS 13+**, **Node.js 20+**, and **Google Chrome** in `/Applications` or `~/Applications`. Apple Silicon and Intel are supported. The native helper is included; you do not need Xcode or a compiler.

```sh
npx quiet-chrome@latest install
```

The first interactive install asks which Dock behavior you want:

- **Standard (default):** launch Chrome and exit. No resident process. Pin the launcher if you like, or open it through Spotlight. A pinned launcher and running Chrome have separate icons.
- **Auto-hide:** keep a small native helper running. Quiet Chrome appears in the Dock while Chrome is closed and hides while Chrome runs. **Unpin both Chrome and Quiet Chrome** so only their running icons appear. Their Dock position may change. The installer never edits your Dock pins.

Auto-hide also asks whether to start the helper at login. That is **off by default**. Starting the helper at login does not open Chrome. Without login startup, open Quiet Chrome yourself after signing in.

The installer creates `~/Applications/Quiet Chrome.app`, using Chrome's icon from your local installation. It does not close or restart Chrome. **Quit Chrome with Command-Q**, then open Quiet Chrome for the quiet flag to take effect. In Finder, use **Go → Go to Folder → `~/Applications`** to find it.

Node.js is only needed for the CLI. Standard mode exits after launch; auto-hide runs a Swift/AppKit helper, not a Node process.

### Scripted install

```sh
npx quiet-chrome@latest install --dock-mode auto --start-at-login --yes
npx quiet-chrome@latest install --dock-mode auto --no-start-at-login --yes
npx quiet-chrome@latest install --dock-mode standard --yes
```

Reinstalls preserve saved preferences unless flags override them. Noninteractive installs do not prompt; they use saved preferences or the standard-mode defaults. `--yes` skips prompts, **not** safety checks, and never enables login startup by itself.

## Configuration

Settings live at `~/.config/quiet-chrome/config.json`:

```json
{
  "dockMode": "standard",
  "startAtLogin": false
}
```

```sh
npx quiet-chrome config show
npx quiet-chrome config set dockMode auto
npx quiet-chrome config set startAtLogin true
npx quiet-chrome config set dockMode standard
```

CLI edits apply immediately to an installed launcher. Selecting `standard` stops the helper and turns off login startup. Set `dockMode` to `auto` before enabling `startAtLogin`. If you edit JSON yourself, run `npx quiet-chrome config apply` to apply it.

Login startup uses `~/Library/LaunchAgents/sh.jimbo.quiet-chrome.login.plist`. It starts the helper in background mode on your next login. There is no KeepAlive job or polling loop. macOS Login Items settings can disable the startup item.

If you have the 0.1 launcher installed, run `npx quiet-chrome@latest install` to upgrade it before changing Dock modes.

## How it works

Chrome starts with `--silent-debugger-extension-api`. If it is already running without that flag, the launcher asks you to quit it first. Opening another window cannot change flags on the existing process.

The flag suppresses the extension debugging banner **for all extensions**, not just one agent. It does not remove extension permissions, add a tab activity indicator, or distinguish which agent is working. You lose the banner's visible notice and stop control; manage extension access in Chrome's Extensions settings when needed.

This relies on a Chromium command-line switch, not a permanent preference. Chrome may change or remove it. [Chromium implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/debugger/debugger_api.cc).

Auto-hide uses macOS application launch/quit notifications to change its Dock visibility. It does not monitor tabs, read browser data, or need Accessibility or Automation permissions. In one Apple Silicon/macOS 27 test, the idle helper used about **10 MB physical footprint**, about **33–57 MB resident memory**, and **0% sampled idle CPU**. Memory varies with macOS, hardware, and state; these are measurements, not limits.

## Check your setup

```sh
npx quiet-chrome doctor
```

Reports the Chrome location, launcher, config, login file, resident helper's Dock state, and whether Chrome processes include the flag. It checks process arguments, not the banner itself.

Chrome updates normally. An update, automatic relaunch, or another shortcut may start it without the flag. If the banner returns, quit Chrome and reopen Quiet Chrome. Rerun `install` if you move Chrome or want to refresh its icon.

## Uninstall

```sh
npx quiet-chrome uninstall
```

Stops the helper and removes only this CLI's launcher and login item. Saved JSON preferences are kept for reinstalls. Chrome and its data stay intact. Quit Chrome and reopen the regular Chrome app to restore the banner. Remove any leftover launcher shortcut from your Dock.

Install and uninstall refuse to overwrite or delete a different app named Quiet Chrome, including a manually created launcher. Move or rename that app first.

## Development

```sh
npm run build:native  # macOS with Xcode Command Line Tools
npm run check
node bin/quiet-chrome.js --help
```

The native build produces a universal arm64/x86_64 executable from `native/QuietChrome.swift`. The installer copies it into an app bundle and signs that local bundle ad hoc. No runtime or development npm dependencies. Unit tests use temporary fixtures and never restart your browser.

[Overview](https://jimbo.sh/quiet-chrome) · [Issues](https://github.com/jdubba1/quiet-chrome/issues)

MIT licensed. Independent project, not affiliated with Google. Chrome and its icon belong to Google; the icon is not distributed in this package.
