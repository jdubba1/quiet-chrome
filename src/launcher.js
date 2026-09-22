import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const flag = "--silent-debugger-extension-api";
export const bundleId = "sh.jimbo.chrome-quiet";
export const run = (file, args) =>
  execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const shellQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const appleString = (s) =>
  '"' + s.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
export const launcherPath = (home = homedir()) =>
  join(home, "Applications", "Chrome Quiet.app");
const plistPath = (app) => join(app, "Contents", "Info.plist");

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

export function launcherScript(chrome) {
  // No Apple Events are sent to Chrome. Only inspect its process and use Launch Services.
  const processCheck =
    "/usr/bin/pgrep -x 'Google Chrome' | while IFS= read -r pid; do /bin/ps -p \"$pid\" -o command=; done; true";
  return `on run
    set chromeProcesses to do shell script ${appleString(processCheck)}
    if chromeProcesses is not "" then
        repeat with chromeProcess in paragraphs of chromeProcesses
            if chromeProcess does not contain ${appleString(flag)} then
                display dialog "Chrome is already running without the quiet flag. Quit Chrome with Command-Q, then open Chrome Quiet again. Your current session has not been interrupted." buttons {"OK"} default button "OK" with title "Chrome Quiet"
                return
            end if
        end repeat
    end if
    do shell script ${appleString("/usr/bin/open -a " + shellQuote(chrome) + " --args " + flag)}
end run
`;
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
  // lstat also catches broken symlinks, which existsSync alone does not.
  let stat;
  try {
    stat = lstatSync(app);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink() || !isOwned(app, exec)) {
    throw new Error(
      `Refusing to change ${app}: it was not installed by chrome-quiet. Move or rename it first.`,
    );
  }
}

export function install({
  home = homedir(),
  chrome = findChrome(home),
  exec = run,
} = {}) {
  const app = launcherPath(home);
  refuseForeign(app, exec);
  mkdirSync(join(home, "Applications"), { recursive: true });
  const staging = mkdtempSync(join(home, "Applications", ".chrome-quiet-"));
  const built = join(staging, "Chrome Quiet.app");
  const backup = join(staging, "previous.app");
  let movedOld = false;
  try {
    exec("/usr/bin/osacompile", ["-o", built, "-e", launcherScript(chrome)]);
    const plist = plistPath(built);
    exec("/usr/libexec/PlistBuddy", [
      "-c",
      `Add :CFBundleIdentifier string ${bundleId}`,
      plist,
    ]);
    exec("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :CFBundleIconFile ChromeQuiet.icns",
      plist,
    ]);
    // The generated asset catalog otherwise overrides CFBundleIconFile.
    exec("/usr/libexec/PlistBuddy", ["-c", "Delete :CFBundleIconName", plist]);
    copyFileSync(
      join(chrome, "Contents", "Resources", "app.icns"),
      join(built, "Contents", "Resources", "ChromeQuiet.icns"),
    );
    exec("/usr/bin/codesign", ["--force", "--sign", "-", built]);
    exec("/usr/bin/codesign", ["--verify", built]);
    refuseForeign(app, exec);
    if (existsSync(app)) {
      renameSync(app, backup);
      movedOld = true;
    }
    try {
      renameSync(built, app);
    } catch (error) {
      if (movedOld) {
        renameSync(backup, app);
        movedOld = false;
      }
      throw error;
    }
  } finally {
    // If a rollback itself fails, preserve the previous app for recovery.
    if (!movedOld || existsSync(app))
      rmSync(staging, { recursive: true, force: true });
  }
  return app;
}

export function uninstall({ home = homedir(), exec = run } = {}) {
  const app = launcherPath(home);
  refuseForeign(app, exec);
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
    `Launcher: ${isOwned(app, exec) ? app : "not installed by chrome-quiet"}`,
  );
  let pids;
  try {
    pids = exec("/usr/bin/pgrep", ["-x", "Google Chrome"]);
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (!pids)
    lines.push("Chrome is not running. Open Chrome Quiet to start it.");
  else {
    const processes = pids
      .split(/\s+/)
      .map((pid) => exec("/bin/ps", ["-p", pid, "-o", "command="]));
    const quiet = processes.every((command) =>
      command.split(/\s+/).includes(flag),
    );
    lines.push(
      quiet
        ? "Quiet flag: active on all Chrome processes."
        : "Quiet flag: missing. Quit Chrome with Command-Q, then open Chrome Quiet.",
    );
  }
  lines.push(
    "This checks the launch flag, not whether your Chrome version still honors it.",
  );
  return lines.join("\n");
}
