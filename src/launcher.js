import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  configPath,
  readConfig,
  validateConfig,
  writeConfig,
} from "./config.js";

export const flag = "--silent-debugger-extension-api";
export const bundleId = "sh.jimbo.quiet-chrome";
export const run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
export const launcherPath = (home = homedir()) =>
  join(home, "Applications", "Quiet Chrome.app");
export const loginPath = (home = homedir()) =>
  join(home, "Library", "LaunchAgents", `${bundleId}.login.plist`);
const plistPath = (app) => join(app, "Contents", "Info.plist");
const helperPath = (app) =>
  join(app, "Contents", "MacOS", "quiet-chrome-helper");
const nativeBinary = fileURLToPath(
  new URL("../native/quiet-chrome-helper", import.meta.url),
);
const xml = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const plist = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${body}</dict></plist>\n`;
const string = (key, value) =>
  `<key>${key}</key><string>${xml(value)}</string>`;

export function findChrome(home = homedir()) {
  const app = [
    "/Applications/Google Chrome.app",
    join(home, "Applications", "Google Chrome.app"),
  ].find((p) => existsSync(join(p, "Contents", "MacOS", "Google Chrome")));
  if (!app)
    throw new Error(
      "Google Chrome was not found in /Applications or ~/Applications. Install Chrome first.",
    );
  return app;
}

export function isOwned(app, exec = run) {
  if (!existsSync(app) || lstatSync(app).isSymbolicLink()) return false;
  try {
    return (
      exec("/usr/libexec/PlistBuddy", [
        "-c",
        "Print :CFBundleIdentifier",
        plistPath(app),
      ]) === bundleId
    );
  } catch {
    return false;
  }
}

function refuseForeign(app, exec) {
  let stat;
  try {
    stat = lstatSync(app);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !isOwned(app, exec))
    throw new Error(
      `Refusing to change ${app}: it was not installed by quiet-chrome. Move or rename it first.`,
    );
}

function checkLoginOwnership(home, exec) {
  const path = loginPath(home);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    exec("/usr/libexec/PlistBuddy", ["-c", "Print :QuietChromeOwner", path]) !==
      bundleId
  ) {
    throw new Error(`Refusing to change unrelated login item: ${path}`);
  }
}

function removeLogin(home, exec) {
  checkLoginOwnership(home, exec);
  const path = loginPath(home);
  if (!existsSync(path)) return;
  // RunAtLoad jobs may have already exited. bootout prevents another start this session.
  try {
    exec("/bin/launchctl", [
      "bootout",
      `gui/${process.getuid()}/${bundleId}.login`,
    ]);
  } catch (error) {
    if (![3, 113].includes(error.status)) throw error;
  }
  rmSync(path);
}

export function syncSettings(config, { home = homedir(), exec = run } = {}) {
  const app = launcherPath(home);
  if (!isOwned(app, exec)) {
    if (!config.startAtLogin) removeLogin(home, exec);
    return;
  }
  checkLoginOwnership(home, exec);
  if (config.startAtLogin) {
    const path = loginPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      plist(
        string("Label", bundleId + ".login") +
          string("QuietChromeOwner", bundleId) +
          `<key>ProgramArguments</key><array><string>${xml(helperPath(app))}</string><string>--background</string></array><key>RunAtLoad</key><true/>`,
      ),
      { mode: 0o600 },
    );
  } else removeLogin(home, exec);
  if (existsSync(helperPath(app))) {
    exec(helperPath(app), [
      config.dockMode === "standard" ? "--stop" : "--reload",
    ]);
    if (config.dockMode === "auto") {
      let running = true;
      try {
        exec(helperPath(app), ["--is-running"]);
      } catch (error) {
        if (error.status !== 1) throw error;
        running = false;
      }
      if (!running)
        exec("/usr/bin/open", ["-g", "-a", app, "--args", "--background"]);
    }
  }
}

export function configure(config, { home = homedir(), exec = run } = {}) {
  const validated = validateConfig(config);
  checkLoginOwnership(home, exec);
  const app = launcherPath(home);
  if (isOwned(app, exec) && !existsSync(helperPath(app))) {
    throw new Error(
      "This launcher predates Dock modes. Run quiet-chrome install to upgrade it first.",
    );
  }
  const previous = readConfig(home);
  writeConfig(validated, home);
  try {
    syncSettings(validated, { home, exec });
  } catch (error) {
    writeConfig(previous, home);
    try {
      syncSettings(previous, { home, exec });
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  }
  return validated;
}

export function install({
  home = homedir(),
  chrome = findChrome(home),
  exec = run,
  config = readConfig(home),
  binary = nativeBinary,
} = {}) {
  config = validateConfig(config);
  const app = launcherPath(home);
  refuseForeign(app, exec);
  checkLoginOwnership(home, exec);
  mkdirSync(join(home, "Applications"), { recursive: true });
  const staging = mkdtempSync(join(home, "Applications", ".quiet-chrome-"));
  const built = join(staging, "Quiet Chrome.app");
  const backup = join(staging, "previous.app");
  let movedOld = false;
  let installedNew = false;
  const previousConfig = readConfig(home);
  const hadConfig = existsSync(configPath(home));
  try {
    mkdirSync(join(built, "Contents", "MacOS"), { recursive: true });
    mkdirSync(join(built, "Contents", "Resources"));
    copyFileSync(binary, helperPath(built));
    writeFileSync(
      plistPath(built),
      plist(
        string("CFBundleIdentifier", bundleId) +
          string("CFBundleName", "Quiet Chrome") +
          string("CFBundleExecutable", "quiet-chrome-helper") +
          string("CFBundlePackageType", "APPL") +
          string("CFBundleIconFile", "QuietChrome.icns") +
          string("CFBundleVersion", "0.2.0") +
          string("LSMinimumSystemVersion", "13.0") +
          string("QuietChromePath", chrome) +
          string("QuietChromeConfigPath", configPath(home)) +
          `<key>LSUIElement</key><true/>`,
      ),
    );
    copyFileSync(
      join(chrome, "Contents", "Resources", "app.icns"),
      join(built, "Contents", "Resources", "QuietChrome.icns"),
    );
    exec("/usr/bin/codesign", ["--force", "--sign", "-", built]);
    exec("/usr/bin/codesign", ["--verify", built]);
    refuseForeign(app, exec);
    if (existsSync(helperPath(app))) exec(helperPath(app), ["--stop"]);
    if (existsSync(app)) {
      renameSync(app, backup);
      movedOld = true;
    }
    renameSync(built, app);
    installedNew = true;
    writeConfig(config, home);
    syncSettings(config, { home, exec });
  } catch (error) {
    if (installedNew) {
      try {
        exec(helperPath(app), ["--stop"]);
      } catch {
        /* Keep rollback available. */
      }
      rmSync(app, { recursive: true, force: true });
      if (hadConfig) writeConfig(previousConfig, home);
      else rmSync(configPath(home), { force: true });
    }
    if (movedOld) {
      renameSync(backup, app);
      movedOld = false;
    }
    try {
      syncSettings(previousConfig, { home, exec });
    } catch {
      /* Preserve the original failure. */
    }
    throw error;
  } finally {
    if (!movedOld || existsSync(app))
      rmSync(staging, { recursive: true, force: true });
  }
  return app;
}

export function uninstall({ home = homedir(), exec = run } = {}) {
  const app = launcherPath(home);
  refuseForeign(app, exec);
  checkLoginOwnership(home, exec);
  if (existsSync(helperPath(app))) exec(helperPath(app), ["--stop"]);
  removeLogin(home, exec);
  if (!existsSync(app)) return false;
  rmSync(app, { recursive: true });
  return true;
}

export function doctor({ home = homedir(), exec = run } = {}) {
  const lines = [];
  try {
    lines.push(`Chrome: ${findChrome(home)}`);
  } catch (error) {
    lines.push(error.message);
  }
  const app = launcherPath(home);
  lines.push(
    `Launcher: ${isOwned(app, exec) ? app : "not installed by quiet-chrome"}`,
  );
  if (isOwned(app, exec) && existsSync(helperPath(app)))
    lines.push(exec(helperPath(app), ["--status"]));
  const config = readConfig(home);
  lines.push(
    `Config: ${configPath(home)}`,
    `Dock mode: ${config.dockMode}`,
    `Start at login: ${config.startAtLogin}`,
    `Login file: ${existsSync(loginPath(home)) ? "present" : "absent"}`,
  );
  let pids;
  try {
    pids = exec("/usr/bin/pgrep", ["-x", "Google Chrome"]);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (!pids)
    lines.push("Chrome is not running. Open Quiet Chrome to start it.");
  else {
    const processes = pids
      .split(/\s+/)
      .map((pid) => exec("/bin/ps", ["-p", pid, "-o", "command="]));
    lines.push(
      processes.every((command) => command.split(/\s+/).includes(flag))
        ? "Quiet flag: active on all Chrome processes."
        : "Quiet flag: missing. Quit Chrome with Command-Q, then open Quiet Chrome.",
    );
  }
  lines.push(
    "This checks the launch flag, not whether your Chrome version still honors it.",
  );
  return lines.join("\n");
}
