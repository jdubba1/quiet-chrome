import { test } from "node:test";
import { execFileSync } from "node:child_process";
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
  launcherScript,
  bundleId,
  doctor,
  flag,
} from "../src/launcher.js";

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "chrome-quiet-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const chrome = join(home, "Chrome.app");
  mkdirSync(join(chrome, "Contents", "Resources"), { recursive: true });
  writeFileSync(join(chrome, "Contents", "Resources", "app.icns"), "icon");
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, args]);
    if (file.endsWith("osacompile")) {
      mkdirSync(join(args[1], "Contents", "Resources"), { recursive: true });
      writeFileSync(join(args[1], "Contents", "Info.plist"), "");
    }
    if (
      file.endsWith("PlistBuddy") &&
      args[1].startsWith("Add :CFBundleIdentifier")
    )
      writeFileSync(args[2], bundleId);
    if (file.endsWith("PlistBuddy") && args[1] === "Print :CFBundleIdentifier")
      return readFileSync(args[2], "utf8");
    return "";
  };
  return { home, chrome, exec, calls };
}

test("install copies the local icon, signs before replacing, and is safely repeatable", (t) => {
  const f = fixture(t);
  const app = install(f);
  assert.equal(
    readFileSync(
      join(app, "Contents", "Resources", "ChromeQuiet.icns"),
      "utf8",
    ),
    "icon",
  );
  assert.ok(
    f.calls.some(
      ([file, args]) => file.endsWith("codesign") && args[0] === "--verify",
    ),
  );
  assert.equal(install(f), app);
  assert.equal(uninstall(f), true);
  assert.equal(uninstall(f), false);
  assert.ok(existsSync(f.chrome));
});

test("failed compilation preserves an existing owned launcher", (t) => {
  const f = fixture(t);
  const app = install(f);
  writeFileSync(join(app, "sentinel"), "keep");
  assert.throws(
    () =>
      install({
        ...f,
        exec(file, args) {
          if (file.endsWith("osacompile")) throw new Error("compile failed");
          return f.exec(file, args);
        },
      }),
    /compile failed/,
  );
  assert.equal(readFileSync(join(app, "sentinel"), "utf8"), "keep");
});

test("install and uninstall refuse unrelated apps and symlinks", (t) => {
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

test("launcher quotes unusual paths and never sends quit or kill commands", () => {
  const path = "/Users/A ' \" $HOME `echo nope`/Google Chrome.app";
  const script = launcherScript(path);
  const literal = script.split("    do shell script ")[1].split("\n")[0];
  const command = JSON.parse(literal);
  const quotedPath = command.slice(
    "/usr/bin/open -a ".length,
    command.indexOf(" --args "),
  );
  assert.equal(
    execFileSync("/bin/sh", ["-c", "printf '%s' " + quotedPath], {
      encoding: "utf8",
    }),
    path,
  );
  assert.ok(script.includes(flag));
  assert.ok(script.includes("return\n"));
  assert.doesNotMatch(script, /tell application|killall|\/bin\/kill/);
});

test("doctor distinguishes inactive, active, and mixed Chrome processes", (t) => {
  const f = fixture(t);
  const exec = (file, args) => {
    if (file.endsWith("pgrep")) return "10\n20";
    if (file.endsWith("/ps"))
      return (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" +
        (args[1] === "10" ? " " + flag : "")
      );
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
