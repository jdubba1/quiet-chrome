import AppKit
import Foundation
import Darwin

let appID = "sh.jimbo.quiet-chrome"
let flag = "--silent-debugger-extension-api"
let reloadName = Notification.Name(appID + ".reload")
let stopName = Notification.Name(appID + ".stop")
let bundlePath = Bundle.main.bundleURL.resolvingSymlinksInPath().path

// Control commands don't initialize NSApplication or create a Dock icon.
if CommandLine.arguments.contains("--reload") || CommandLine.arguments.contains("--stop") || CommandLine.arguments.contains("--is-running") || CommandLine.arguments.contains("--status") {
    let stopping = CommandLine.arguments.contains("--stop")
    let peers = NSRunningApplication.runningApplications(withBundleIdentifier: appID).filter {
        $0.processIdentifier != ProcessInfo.processInfo.processIdentifier && $0.bundleURL?.resolvingSymlinksInPath().path == bundlePath
    }
    if CommandLine.arguments.contains("--is-running") { exit(peers.isEmpty ? 1 : 0) }
    if CommandLine.arguments.contains("--status") {
        if peers.isEmpty { print("Helper: stopped") }
        for peer in peers {
            print("Helper: running (PID \(peer.processIdentifier), Dock \(peer.activationPolicy == .regular ? "visible" : "hidden"))")
        }
        exit(0)
    }
    DistributedNotificationCenter.default().postNotificationName(
        stopping ? stopName : reloadName, object: bundlePath, userInfo: nil, deliverImmediately: true
    )
    if stopping {
        let deadline = Date().addingTimeInterval(5)
        while peers.contains(where: { !$0.isTerminated }) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        if peers.contains(where: { !$0.isTerminated }) {
            fputs("Quiet Chrome did not exit. Quit it before reinstalling or uninstalling.\n", stderr)
            exit(1)
        }
    }
    exit(0)
}

// The lock also covers simultaneous login/manual launches before Launch Services registers them.
let configFile = Bundle.main.object(forInfoDictionaryKey: "QuietChromeConfigPath") as? String ?? NSHomeDirectory() + "/.config/quiet-chrome/config.json"
let lockURL = URL(fileURLWithPath: configFile).deletingLastPathComponent().appendingPathComponent("helper.lock")
do { try FileManager.default.createDirectory(at: lockURL.deletingLastPathComponent(), withIntermediateDirectories: true) }
catch { fputs("Could not create Quiet Chrome config directory.\n", stderr); exit(1) }
let lockFD = Darwin.open(lockURL.path, O_CREAT | O_RDWR, mode_t(0o600))
guard lockFD >= 0 else { fputs("Could not open Quiet Chrome helper lock.\n", stderr); exit(1) }
if flock(lockFD, LOCK_EX | LOCK_NB) != 0 { exit(0) }

struct Settings: Decodable {
    let dockMode: String
    let startAtLogin: Bool
}

final class Launcher: NSObject, NSApplicationDelegate {
    private var observers: [NSObjectProtocol] = []
    private var settings = Settings(dockMode: "standard", startAtLogin: false)
    private var launching = false
    private let background = CommandLine.arguments.contains("--background")
    private var chromeURL: URL {
        URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "QuietChromePath") as? String ?? "/Applications/Google Chrome.app")
    }
    private var configURL: URL {
        URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "QuietChromeConfigPath") as? String ??
            NSHomeDirectory() + "/.config/quiet-chrome/config.json")
    }
    private var chromeID: String {
        Bundle(url: chromeURL)?.bundleIdentifier ?? "com.google.Chrome"
    }
    private var chromeApps: [NSRunningApplication] {
        NSRunningApplication.runningApplications(withBundleIdentifier: chromeID).filter { !$0.isTerminated }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard loadSettings() else { NSApp.terminate(nil); return }
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            observers.append(workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let self, let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                      app.bundleIdentifier == self.chromeID else { return }
                self.updateDock()
            })
        }
        let center = DistributedNotificationCenter.default()
        observers.append(center.addObserver(forName: reloadName, object: bundlePath, queue: .main) { [weak self] _ in
            guard let self else { return }
            guard self.loadSettings(), self.settings.dockMode == "auto" else { NSApp.terminate(nil); return }
            self.updateDock()
        })
        observers.append(center.addObserver(forName: stopName, object: bundlePath, queue: .main) { _ in NSApp.terminate(nil) })
        if background {
            if settings.dockMode == "auto" { updateDock() } else { NSApp.terminate(nil) }
        } else {
            openChrome()
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openChrome()
        return false
    }

    private func loadSettings() -> Bool {
        do {
            if !FileManager.default.fileExists(atPath: configURL.path) {
                settings = Settings(dockMode: "standard", startAtLogin: false)
            } else {
                settings = try JSONDecoder().decode(Settings.self, from: Data(contentsOf: configURL))
                guard ["standard", "auto"].contains(settings.dockMode),
                      settings.dockMode == "auto" || !settings.startAtLogin else {
                    throw NSError(domain: appID, code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid dockMode or startAtLogin setting."])
                }
            }
            return true
        } catch {
            showError("Could not read Quiet Chrome config. Fix \(configURL.path) or run quiet-chrome config show.\n\n\(error.localizedDescription)")
            return false
        }
    }

    private func updateDock() {
        guard settings.dockMode == "auto" else { return }
        let visible = chromeApps.isEmpty
        let policy: NSApplication.ActivationPolicy = visible ? .regular : .accessory
        if NSApp.activationPolicy() != policy { NSApp.setActivationPolicy(policy) }
        if visible {
            let menu = NSMenu()
            let root = NSMenuItem()
            let submenu = NSMenu()
            submenu.addItem(withTitle: "Open Chrome", action: #selector(openFromMenu), keyEquivalent: "o").target = self
            submenu.addItem(NSMenuItem.separator())
            submenu.addItem(withTitle: "Quit Quiet Chrome", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            root.submenu = submenu
            menu.addItem(root)
            NSApp.mainMenu = menu
        }
    }

    @objc private func openFromMenu() { openChrome() }

    private func hasQuietFlag(_ app: NSRunningApplication) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/ps")
        process.arguments = ["-p", String(app.processIdentifier), "-o", "command="]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return String(data: data, encoding: .utf8)?.split(whereSeparator: { $0.isWhitespace }).contains(Substring(flag)) == true
        } catch { return false }
    }

    private func openChrome() {
        guard !launching else { return }
        let running = chromeApps
        if running.contains(where: { !hasQuietFlag($0) }) {
            showError("Chrome is already running without the quiet flag. Quit Chrome with Command-Q, then open Quiet Chrome again. Your current session has not been interrupted.")
            finishLaunch()
            return
        }
        guard FileManager.default.fileExists(atPath: chromeURL.path) else {
            showError("Chrome could not be found at \(chromeURL.path). Reinstall Chrome or run quiet-chrome install again.")
            finishLaunch()
            return
        }
        launching = true
        let config = NSWorkspace.OpenConfiguration()
        config.arguments = [flag]
        NSWorkspace.shared.openApplication(at: chromeURL, configuration: config) { [weak self] _, error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.launching = false
                if let error { self.showError(error.localizedDescription) }
                self.finishLaunch()
            }
        }
    }

    private func finishLaunch() {
        if settings.dockMode == "standard" { NSApp.terminate(nil) } else { updateDock() }
    }

    private func showError(_ message: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Quiet Chrome"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = Launcher()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
