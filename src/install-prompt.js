export async function selectPreferences({
  options,
  first,
  interactive,
  ask,
  log,
}) {
  const { config, yes, dockSpecified, loginSpecified } = options;
  if (!interactive || yes) return config;
  if (first && !dockSpecified) {
    log(
      "Dock behavior:\n  1. Standard: launch Chrome and exit (default)\n  2. Auto-hide: stay running and show only one icon",
    );
    let answer;
    do {
      answer = (await ask("Choose [1/2, default 1]: ")).trim();
    } while (!["", "1", "2"].includes(answer));
    config.dockMode = answer === "2" ? "auto" : "standard";
  }
  if (
    config.dockMode === "auto" &&
    !loginSpecified &&
    (first || options.previousDockMode !== "auto")
  ) {
    log(
      "Auto-hide needs both Chrome and Quiet Chrome unpinned from the Dock.\nA native helper will remain running. It does not change your Dock pins.",
    );
    let answer;
    do {
      answer = (
        await ask(
          "Start the helper at login? This does not open Chrome. [y/N]: ",
        )
      )
        .trim()
        .toLowerCase();
    } while (!["", "y", "yes", "n", "no"].includes(answer));
    config.startAtLogin = ["y", "yes"].includes(answer);
  }
  return config;
}
