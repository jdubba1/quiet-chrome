import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const defaults = Object.freeze({
  dockMode: "standard",
  startAtLogin: false,
});
export const configPath = (home = homedir()) =>
  join(home, ".config", "quiet-chrome", "config.json");

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Config must be a JSON object.");
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(defaults, key))
      throw new Error(`Unknown config key: ${key}`);
  }
  const config = { ...defaults, ...value };
  if (!["standard", "auto"].includes(config.dockMode))
    throw new Error('dockMode must be "standard" or "auto".');
  if (typeof config.startAtLogin !== "boolean")
    throw new Error("startAtLogin must be true or false.");
  if (config.dockMode === "standard" && config.startAtLogin)
    throw new Error("startAtLogin requires dockMode auto.");
  return config;
}

export function readConfig(home = homedir()) {
  const path = configPath(home);
  if (!existsSync(path)) return { ...defaults };
  try {
    return validateConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    throw new Error(`Invalid config at ${path}: ${error.message}`);
  }
}

export function writeConfig(config, home = homedir()) {
  const validated = validateConfig(config);
  const path = configPath(home);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(validated, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temp, path);
  return validated;
}

export function changeConfig(current, key, value) {
  if (!Object.hasOwn(defaults, key))
    throw new Error(`Unknown config key: ${key}`);
  if (key === "startAtLogin") {
    if (!["true", "false"].includes(value))
      throw new Error("startAtLogin must be true or false.");
    value = value === "true";
  }
  const updated = { ...current, [key]: value };
  if (key === "dockMode" && value === "standard") updated.startAtLogin = false;
  return validateConfig(updated);
}
