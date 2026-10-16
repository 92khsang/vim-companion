// Spike S5 helper for macOS. Build: /usr/bin/swiftc -O -o s5win s5win.swift
//   s5win preflight        what this process may do: screen capture, posting events, accessibility, input source
//   s5win front            the frontmost app and the owner of the topmost normal window
//   s5win list <pid>       the windows that <pid> owns, one per line, tab-separated
//   s5win activate <pid>   bring <pid> to the front (needs the Accessibility permission)
import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Foundation

func spin() { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02)) }

func frontPid() -> pid_t {
    spin()
    return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? -1
}

func topWindowPid() -> pid_t {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return -1 }
    for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
        return (w[kCGWindowOwnerPID as String] as? pid_t) ?? -1
    }
    return -1
}

func inputSourceID() -> String {
    let src = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    guard let raw = TISGetInputSourceProperty(src, kTISPropertyInputSourceID) else { return "unknown" }
    return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
}

func screenLocked() -> String {
    guard let d = CGSessionCopyCurrentDictionary() as? [String: Any] else { return "no-session" }
    return String(describing: d["CGSSessionScreenIsLocked"] ?? false)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: s5win preflight|front|list <pid>|activate <pid>\n".data(using: .utf8)!)
    exit(2)
}
switch args[1] {
case "preflight":
    print("screenCapture=\(CGPreflightScreenCaptureAccess())\tpostEvent=\(CGPreflightPostEventAccess())\taxTrusted=\(AXIsProcessTrusted())\tinputSource=\(inputSourceID())\tscreenLocked=\(screenLocked())")
case "front":
    spin()
    let app = NSWorkspace.shared.frontmostApplication
    print("frontPid=\(app?.processIdentifier ?? -1)\tbundle=\(app?.bundleIdentifier ?? "none")\ttopWindowPid=\(topWindowPid())")
case "list":
    guard args.count >= 3, let pid = Int32(args[2]) else { exit(2) }
    let list = (CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]]) ?? []
    for w in list where (w[kCGWindowOwnerPID as String] as? pid_t) == pid {
        let b = (w[kCGWindowBounds as String] as? [String: Any]) ?? [:]
        let fields: [Any] = [
            w[kCGWindowNumber as String] ?? -1, w[kCGWindowLayer as String] ?? -1,
            w[kCGWindowIsOnscreen as String] ?? false, w[kCGWindowAlpha as String] ?? -1,
            b["X"] ?? -1, b["Y"] ?? -1, b["Width"] ?? -1, b["Height"] ?? -1,
            w[kCGWindowName as String] ?? "(name withheld)",
        ]
        print(fields.map { "\($0)" }.joined(separator: "\t"))
    }
case "activate":
    guard args.count >= 3, let pid = Int32(args[2]) else { exit(2) }
    let ax = AXUIElementCreateApplication(pid)
    let err = AXUIElementSetAttributeValue(ax, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    var activated = false
    if err != .success, let app = NSRunningApplication(processIdentifier: pid) {
        activated = app.activate(options: [])
    }
    usleep(300_000)
    print("axError=\(err.rawValue)\tnsActivate=\(activated)\tfrontPid=\(frontPid())\ttopWindowPid=\(topWindowPid())")
default:
    exit(2)
}
