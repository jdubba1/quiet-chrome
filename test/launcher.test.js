import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  install,
  uninstall,
  launcherPath,
  loginPath,
  configure,
  bundleId,
  doctor,
  flag,
} from "../src/launcher.js";
import {
  readConfig,
  writeConfig,
  configPath,
  changeConfig,
  validateConfig,
} from "../src/config.js";
import { installOptions } from "../src/options.js";

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "quiet-chrome-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const chrome = join(home, 'A & B "Chrome".app');
  mkdirSync(join(chrome, "Contents", "Resources"), { recursive: true });
  writeFileSync(join(chrome, "Contents", "Resources", "app.icns"), "icon");
  const calls = [];
  let running = false;
  const exec = (file, args) => {
    calls.push([file, args]);
    if (file.endsWith("PlistBuddy")) {
      const contents = readFileSync(args[2], "utf8");
      const key = args[1].split(":")[1];
      const match = contents.match(
        new RegExp(`<key>${key}</key><string>(.*?)</string>`),
      );
      if (!match) throw new Error("Missing plist key");
      return match[1];
    }
    if (file.endsWith("quiet-chrome-helper")) {
      if (args[0] === "--is-running" && !running)
        throw Object.assign(new Error("not running"), { status: 1 });
      if (args[0] === "--stop") running = false;
      if (args[0] === "--reload" && readConfig(home).dockMode === "standard")
        running = false;
    }
    if (file === "/usr/bin/open") running = true;
    return "";
  };
  return { home, chrome, exec, calls };
}

test("standard installation preserves Chrome, creates config, and does not start a resident process", (t) => {
  const f = fixture(t);
  const app = install(f);
  assert.equal(
    readFileSync(
      join(app, "Contents", "Resources", "QuietChrome.icns"),
      "utf8",
    ),
    "icon",
  );
  assert.match(
    readFileSync(join(app, "Contents", "Info.plist"), "utf8"),
    /A &amp; B &quot;Chrome&quot;/,
  );
  assert.deepEqual(readConfig(f.home), {
    dockMode: "standard",
    startAtLogin: false,
  });
  assert.ok(!f.calls.some(([file]) => file === "/usr/bin/open"));
  assert.ok(!existsSync(loginPath(f.home)));
  assert.equal(install(f), app);
  assert.equal(uninstall(f), true);
  assert.equal(uninstall(f), false);
  assert.ok(existsSync(f.chrome));
  assert.ok(existsSync(configPath(f.home)));
});

test("failed build preserves an existing launcher and saved preferences", (t) => {
  const f = fixture(t);
  const app = install(f);
  writeFileSync(join(app, "sentinel"), "keep");
  assert.throws(
    () =>
      install({
        ...f,
        exec(file, args) {
          if (file.endsWith("codesign")) throw new Error("signing failed");
          return f.exec(file, args);
        },
      }),
    /signing failed/,
  );
  assert.equal(readFileSync(join(app, "sentinel"), "utf8"), "keep");
  assert.deepEqual(readConfig(f.home), {
    dockMode: "standard",
    startAtLogin: false,
  });
});

test("install and uninstall refuse unrelated apps and broken symlinks", (t) => {
  const f = fixture(t);
  const app = launcherPath(f.home);
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "sentinel"), "keep");
  assert.throws(() => install(f), /Refusing/);
  assert.throws(() => uninstall(f), /Refusing/);
  assert.equal(readFileSync(join(app, "sentinel"), "utf8"), "keep");
  rmSync(app, { recursive: true });
  symlinkSync(join(f.home, "missing-target"), app);
  assert.throws(() => install(f), /Refusing/);
  assert.throws(() => uninstall(f), /Refusing/);
});

test("auto mode preserves preferences on reinstall and never reopens an already running helper", (t) => {
  const f = fixture(t);
  install({ ...f, config: { dockMode: "auto", startAtLogin: true } });
  assert.ok(existsSync(loginPath(f.home)));
  assert.match(readFileSync(loginPath(f.home), "utf8"), /--background/);
  assert.equal(f.calls.filter(([file]) => file === "/usr/bin/open").length, 1);
  configure({ dockMode: "auto", startAtLogin: true }, f);
  assert.equal(f.calls.filter(([file]) => file === "/usr/bin/open").length, 1);
  install(f);
  assert.deepEqual(readConfig(f.home), {
    dockMode: "auto",
    startAtLogin: true,
  });
  configure(changeConfig(readConfig(f.home), "dockMode", "standard"), f);
  assert.ok(!existsSync(loginPath(f.home)));
  assert.deepEqual(readConfig(f.home), {
    dockMode: "standard",
    startAtLogin: false,
  });
  uninstall(f);
  assert.ok(
    f.calls.some(
      ([file, args]) =>
        file.endsWith("quiet-chrome-helper") && args[0] === "--stop",
    ),
  );
});

test("refuses unrelated login items before changing the app or config", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(
    loginPath(f.home),
    "<key>QuietChromeOwner</key><string>someone-else</string>",
  );
  assert.throws(() => install(f), /unrelated login item/);
  assert.throws(
    () => configure({ dockMode: "auto", startAtLogin: true }, f),
    /unrelated login item/,
  );
  assert.ok(!existsSync(configPath(f.home)));
  assert.ok(!existsSync(launcherPath(f.home)));
});

test("config validation rejects invalid edits without overwriting settings", (t) => {
  const f = fixture(t);
  writeConfig({ dockMode: "auto", startAtLogin: false }, f.home);
  assert.throws(
    () => changeConfig(readConfig(f.home), "dockMode", "whatever"),
    /dockMode/,
  );
  assert.throws(
    () => validateConfig({ dockMode: "standard", startAtLogin: true }),
    /requires/,
  );
  assert.throws(() => validateConfig({ extra: 1 }), /Unknown/);
  assert.throws(
    () => changeConfig(readConfig(f.home), "startAtLogin", "yes"),
    /true or false/,
  );
  assert.deepEqual(readConfig(f.home), {
    dockMode: "auto",
    startAtLogin: false,
  });
  writeFileSync(configPath(f.home), "{broken");
  assert.throws(() => install(f), /Invalid config/);
  assert.equal(readFileSync(configPath(f.home), "utf8"), "{broken");
});

test("install flags override saved config without silently enabling login", () => {
  const saved = { dockMode: "auto", startAtLogin: true };
  assert.deepEqual(installOptions([], saved).config, saved);
  assert.deepEqual(installOptions(["--dock-mode", "standard"], saved).config, {
    dockMode: "standard",
    startAtLogin: false,
  });
  assert.deepEqual(
    installOptions(["--dock-mode", "auto", "--yes"], {
      dockMode: "standard",
      startAtLogin: false,
    }).config,
    { dockMode: "auto", startAtLogin: false },
  );
  assert.throws(() => installOptions(["--dock-mode"], saved), /dockMode/);
  assert.throws(
    () => installOptions(["--start-at-login", "--no-start-at-login"], saved),
    /Repeated/,
  );
  assert.throws(() => installOptions(["--unknown"], saved), /Unknown/);
});

test("doctor distinguishes inactive, active, and mixed Chrome processes", (t) => {
  const f = fixture(t);
  const exec = (file, args) => {
    if (file.endsWith("pgrep")) return "10\n20";
    if (file.endsWith("/ps"))
      return "chrome" + (args[1] === "10" ? " " + flag : "");
    return f.exec(file, args);
  };
  assert.match(doctor({ ...f, exec }), /Quiet flag: missing/);
  assert.match(
    doctor({
      ...f,
      exec: (file, args) =>
        file.endsWith("/ps") ? `chrome ${flag}` : exec(file, args),
    }),
    /Quiet flag: active/,
  );
  assert.match(
    doctor({
      ...f,
      exec: (file, args) => {
        if (file.endsWith("pgrep"))
          throw Object.assign(new Error("none"), { status: 1 });
        return exec(file, args);
      },
    }),
    /Chrome is not running/,
  );
});

test("interactive setup offers auto mode and keeps login startup opt-in", async () => {
  const { selectPreferences } = await import("../src/install-prompt.js");
  const answers = ["2", ""];
  const questions = [];
  const options = installOptions([], {
    dockMode: "standard",
    startAtLogin: false,
  });
  const config = await selectPreferences({
    options,
    first: true,
    interactive: true,
    log: () => {},
    ask: async (q) => {
      questions.push(q);
      return answers.shift();
    },
  });
  assert.deepEqual(config, { dockMode: "auto", startAtLogin: false });
  assert.equal(questions.length, 2);
  assert.match(questions[1], /does not open Chrome/);
});

test("reinstall and noninteractive setup do not prompt or change saved choices", async () => {
  const { selectPreferences } = await import("../src/install-prompt.js");
  const saved = { dockMode: "auto", startAtLogin: true };
  for (const [first, interactive, flags] of [
    [false, true, []],
    [true, false, []],
    [true, true, ["--yes"]],
  ]) {
    const options = {
      ...installOptions(flags, saved),
      previousDockMode: saved.dockMode,
    };
    const config = await selectPreferences({
      options,
      first,
      interactive,
      log: () => {},
      ask: async () => {
        throw new Error("Unexpected prompt");
      },
    });
    assert.deepEqual(config, saved);
  }
});

test("failed first startup rolls back the app, config, and login item", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      install({
        ...f,
        config: { dockMode: "auto", startAtLogin: true },
        exec(file, args) {
          if (file === "/usr/bin/open") throw new Error("launch failed");
          return f.exec(file, args);
        },
      }),
    /launch failed/,
  );
  assert.ok(!existsSync(launcherPath(f.home)));
  assert.ok(!existsSync(configPath(f.home)));
  assert.ok(!existsSync(loginPath(f.home)));
});
