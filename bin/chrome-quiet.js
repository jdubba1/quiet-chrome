#!/usr/bin/env node
import { install, uninstall, doctor } from "../src/launcher.js";
const args = process.argv.slice(2);
const command = args[0] ?? "help";
const help = `chrome-quiet: quieter Chrome launches on macOS

  npx chrome-quiet install     Create ~/Applications/Chrome Quiet.app
  npx chrome-quiet doctor      Check installation and Chrome's launch flag
  npx chrome-quiet uninstall   Remove only the launcher installed by this CLI

Requires macOS, Node.js 20+, and Google Chrome.
The flag hides debugging banners for ALL extensions. No activity dot is added.
Your Chrome profiles, extensions, and updates stay with your existing Chrome.
`;
try {
  if (args.length > 1)
    throw new Error("Unexpected arguments. Run chrome-quiet --help.");
  if (["help", "--help", "-h"].includes(command)) console.log(help);
  else {
    if (!["install", "uninstall", "doctor"].includes(command))
      throw new Error(`Unknown command: ${command}`);
    if (process.platform !== "darwin")
      throw new Error("chrome-quiet currently supports macOS only.");
    if (command === "install") {
      const path = install();
      console.log(
        `Installed: ${path}\n\nQuit Chrome with Command-Q, then open Chrome Quiet from your home Applications folder.\nDrag Chrome Quiet into the Dock and use it for future launches.\n\nExisting Chrome sessions were not restarted. All extension debugging banners are hidden\nwhen Chrome starts with this flag. After a Chrome update/relaunch, run chrome-quiet doctor.\nRun chrome-quiet uninstall to remove this launcher.`,
      );
    } else if (command === "uninstall") {
      console.log(
        uninstall()
          ? "Removed Chrome Quiet. Chrome and its data are untouched. Quit and reopen regular Chrome to restore banners."
          : "No chrome-quiet launcher is installed.",
      );
    } else console.log(doctor());
  }
} catch (error) {
  console.error(`chrome-quiet: ${error.message}`);
  process.exitCode = 1;
}
