import { validateConfig } from "./config.js";
export function installOptions(args, saved) {
  let config = { ...saved };
  let yes = false;
  let dockSpecified = false;
  let loginSpecified = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const key = arg === "--no-start-at-login" ? "--start-at-login" : arg;
    if (seen.has(key)) throw new Error(`Repeated option: ${key}`);
    seen.add(key);
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (arg === "--dock-mode") {
      config.dockMode = args[++i];
      dockSpecified = true;
    } else if (arg === "--start-at-login" || arg === "--no-start-at-login") {
      config.startAtLogin = arg === "--start-at-login";
      loginSpecified = true;
    } else throw new Error(`Unknown install option: ${arg}`);
  }
  if (config.dockMode === "standard" && !loginSpecified)
    config.startAtLogin = false;
  config = validateConfig(config);
  return { config, yes, dockSpecified, loginSpecified };
}
