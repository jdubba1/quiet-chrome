#!/usr/bin/env node
import { existsSync } from "node:fs";
import { release } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { install, uninstall, doctor, configure } from "../src/launcher.js";
import { readConfig, configPath, changeConfig } from "../src/config.js";
import { installOptions } from "../src/options.js";
import { selectPreferences } from "../src/install-prompt.js";
const args = process.argv.slice(2);
const command = args.shift() ?? "help";
const help = `quiet-chrome: quieter Chrome launches on macOS

  npx quiet-chrome install [--dock-mode standard|auto] [--start-at-login|--no-start-at-login] [--yes]
  npx quiet-chrome config show
  npx quiet-chrome config apply
  npx quiet-chrome config set dockMode standard|auto
  npx quiet-chrome config set startAtLogin true|false
  npx quiet-chrome doctor
  npx quiet-chrome uninstall

Standard: launch Chrome and exit (default).
Auto: a native helper stays running, hiding its Dock icon while Chrome runs.
Config: ~/.config/quiet-chrome/config.json
First interactive install asks for preferences. Reinstalls keep them.
Noninteractive installs use saved settings or defaults; flags override them.
Requires macOS 13+, Node.js 20+, and Google Chrome.
The flag hides debugging banners for ALL extensions. No tab activity dot is added.
`;

async function chooseInstall() {
  const saved = readConfig();
  const options = {
    ...installOptions(args, saved),
    previousDockMode: saved.dockMode,
  };
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  const rl =
    interactive && !options.yes
      ? createInterface({ input: stdin, output: stdout })
      : null;
  try {
    return await selectPreferences({
      options,
      first: !existsSync(configPath()),
      interactive,
      ask: (question) => rl.question(question),
      log: console.log,
    });
  } finally {
    rl?.close();
  }
}

try {
  if (["help", "--help", "-h"].includes(command)) {
    if (args.length) throw new Error("Unexpected arguments.");
    console.log(help);
  } else {
    if (process.platform !== "darwin")
      throw new Error("quiet-chrome currently supports macOS only.");
    if (command === "install") {
      if (Number(release().split(".")[0]) < 22)
        throw new Error("Quiet Chrome 0.2 requires macOS 13 or later.");
      const config = await chooseInstall();
      const path = install({ config });
      console.log(
        `Installed: ${path}\nConfig: ${configPath()}\nDock mode: ${config.dockMode}\nStart at login: ${config.startAtLogin}\n`,
      );
      if (config.dockMode === "auto")
        console.log(
          "The helper is running. Unpin BOTH Chrome and Quiet Chrome from the Dock.\nQuiet Chrome appears when Chrome is closed and hides while Chrome runs.\nIf login startup is off, open Quiet Chrome after signing in to start the helper.",
        );
      else
        console.log(
          "Quit Chrome with Command-Q, then open Quiet Chrome from ~/Applications.\nYou can pin Quiet Chrome in the Dock; it exits after opening Chrome.",
        );
      console.log(
        "\nExisting Chrome sessions were not restarted. All extension debugging banners are hidden\nwhen Chrome starts with the flag. Run quiet-chrome doctor to check it.",
      );
    } else if (command === "config") {
      if (args.length === 1 && args[0] === "show")
        console.log(
          `${configPath()}\n${JSON.stringify(readConfig(), null, 2)}`,
        );
      else if (args.length === 1 && args[0] === "apply")
        console.log(JSON.stringify(configure(readConfig()), null, 2));
      else if (args.length === 3 && args[0] === "set") {
        const config = configure(changeConfig(readConfig(), args[1], args[2]));
        console.log(JSON.stringify(config, null, 2));
        console.log(
          config.dockMode === "auto"
            ? "Unpin both Chrome and Quiet Chrome for automatic Dock visibility."
            : "Standard mode: no resident helper. Login startup is disabled.",
        );
      } else
        throw new Error(
          "Use config show or config set <dockMode|startAtLogin> <value>.",
        );
    } else if (command === "uninstall" && !args.length) {
      console.log(
        uninstall()
          ? "Removed Quiet Chrome and its login item. Saved config and Chrome data are untouched. Quit and reopen regular Chrome to restore banners."
          : "No quiet-chrome launcher is installed. Saved config was kept.",
      );
    } else if (command === "doctor" && !args.length) console.log(doctor());
    else
      throw new Error(
        "Unknown command or unexpected arguments. Run quiet-chrome --help.",
      );
  }
} catch (error) {
  console.error(`quiet-chrome: ${error.message}`);
  process.exitCode = 1;
}
