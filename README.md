# Quiet Chrome

Launch your existing Chrome without the “started debugging this browser” banner.

A small, dependency-free macOS setup CLI. Same Chrome, same profiles, extensions, logins, and updates. No background service. No browser modification.

## Install

Requires **macOS**, **Node.js 20+**, and **Google Chrome** in `/Applications` or `~/Applications`.

```sh
npx quiet-chrome install
```

1. Quit Chrome with **Command-Q**. The installer does not restart it for you.
2. In Finder, choose **Go → Go to Folder**, enter `~/Applications`, and open **Quiet Chrome**.
3. Drag **Quiet Chrome.app** into the Dock. Use that launcher when starting Chrome.

The launcher uses Chrome's icon, copied from your local installation. Node.js is only needed for the CLI, not for the installed launcher.

## How it works

Quiet Chrome creates `~/Applications/Quiet Chrome.app`, which launches Chrome with:

```sh
open -a 'Google Chrome' --args --silent-debugger-extension-api
```

If Chrome is already running without the flag, the launcher asks you to quit it first. Opening another Chrome window cannot change flags on the existing process.

The flag suppresses the extension debugging banner **for all extensions**, not just one agent. It does not remove extension permissions, add an activity indicator, or distinguish which agent is working. You lose the banner's visible notice and stop control; manage extension access in Chrome's Extensions settings when needed.

This relies on a Chromium command-line switch, not a supported preference. Chrome may change or remove it. [Chromium implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/debugger/debugger_api.cc).

## Check your setup

```sh
npx quiet-chrome doctor
```

Reports the Chrome location, launcher installation, and whether running Chrome processes include the flag. It checks process arguments, not the banner itself.

Chrome updates normally. The launcher opens the Chrome installed at setup time. An update, automatic relaunch, or another shortcut may start Chrome without the flag. If the banner returns, quit Chrome and reopen **Quiet Chrome**. If you move Chrome or want to refresh its icon, rerun `install`.

## Uninstall

```sh
npx quiet-chrome uninstall
```

Only removes the launcher installed by this CLI. Chrome and its data stay intact. Quit Chrome and reopen the regular Chrome app to restore the banner. Remove the old launcher shortcut from your Dock.

Install and uninstall refuse to overwrite or delete a different app named Quiet Chrome, including a manually created launcher. Move or rename that app first. Rerunning install updates a launcher previously installed by this CLI.

## Development

```sh
npm test
node bin/quiet-chrome.js --help
```

No runtime or development dependencies. Tests use temporary fixtures and never restart your browser.

[Overview](https://jimbo.sh/quiet-chrome) · [Issues](https://github.com/jdubba1/quiet-chrome/issues)

MIT licensed. Independent project, not affiliated with Google. Chrome and its icon belong to Google; the icon is not distributed in this package.
