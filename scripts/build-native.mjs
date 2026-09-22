import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const temp = mkdtempSync(join(tmpdir(), "quiet-chrome-build-"));
try {
  for (const arch of ["arm64", "x86_64"]) {
    execFileSync(
      "xcrun",
      [
        "swiftc",
        "-O",
        "-target",
        `${arch}-apple-macosx13.0`,
        "-module-cache-path",
        join(temp, "cache"),
        "native/QuietChrome.swift",
        "-o",
        join(temp, arch),
      ],
      { stdio: "inherit" },
    );
  }
  execFileSync(
    "lipo",
    [
      "-create",
      join(temp, "arm64"),
      join(temp, "x86_64"),
      "-output",
      "native/quiet-chrome-helper",
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
