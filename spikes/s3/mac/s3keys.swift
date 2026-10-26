// Spike S3 key injector for macOS, built from spike S5's s5keys.swift (spike/s5/mac/s5keys.swift at commit 8fc284d).
// Build: /usr/bin/swiftc -O -o s3keys s3keys.swift
//   s3keys serve                   reads commands from stdin and answers on stdout
//   s3keys serve --socket <path>   listens on a Unix socket, serves one connection, then exits
// It speaks the protocol of the GNOME harness's inject.py (spikes/gnome-harness/inject.py): after `ready`, one
// command per line, answered with `ok[ <details>]` or `error <text>`:
//   pid <n>                      the sandbox IDE; every key is refused unless <n> owns the frontmost app and the
//                                topmost normal window and the input source is com.apple.keylayout.ABC
//   activate <n>                 bring <n> to the front (Accessibility, with an NSRunningApplication fallback),
//                                like `s5win activate`; answers ok axError=... nsActivate=... frontPid=... topWindowPid=...
//   front                        ok frontPid=... bundle=... topWindowPid=...
//   preflight                    ok screenCapture=... postEvent=... axTrusted=... inputSource=... screenLocked=...
//   key <name>[+<name>...]       press the keys in order and release them in reverse order; the names are the
//                                X keysym names inject.py takes (Escape, space, Shift_L, Control_L, bracketleft, g, ...)
//   type <text>                  one `key` per character (ASCII letters, digits and space)
//   sleep <ms>
//   quit
// Keys are posted as CGEvents to the HID event tap, as s5keys does, so the process needs the Accessibility
// permission: run it inside an ssh session, whose programs macOS attributes to sshd-keygen-wrapper (spike S5).
// Every posted or refused key is reported on stderr, one tab-separated line each.
import AppKit
import ApplicationServices
import Carbon
import CoreGraphics
import Darwin
import Foundation

// ANSI (US) virtual key codes, named as X keysyms so that inject.py's callers need no change.
let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
    "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
    "t": 0x11, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "equal": 0x18,
    "9": 0x19, "7": 0x1A, "minus": 0x1B, "8": 0x1C, "0": 0x1D, "bracketright": 0x1E, "o": 0x1F,
    "u": 0x20, "bracketleft": 0x21, "i": 0x22, "p": 0x23, "Return": 0x24, "l": 0x25, "j": 0x26,
    "apostrophe": 0x27, "k": 0x28, "semicolon": 0x29, "backslash": 0x2A, "comma": 0x2B, "slash": 0x2C,
    "n": 0x2D, "m": 0x2E, "period": 0x2F, "Tab": 0x30, "space": 0x31, "grave": 0x32, "BackSpace": 0x33,
    "Escape": 0x35,
]
let modifiers: [String: (CGKeyCode, CGEventFlags)] = [
    "Shift_L": (0x38, .maskShift), "Shift_R": (0x3C, .maskShift),
    "Control_L": (0x3B, .maskControl), "Control_R": (0x3E, .maskControl),
    "Alt_L": (0x3A, .maskAlternate), "Alt_R": (0x3D, .maskAlternate),
    "Meta_L": (0x37, .maskCommand), "Super_L": (0x37, .maskCommand),
]
let abcInputSource = "com.apple.keylayout.ABC"
let holdMicros: UInt32 = 12_000 // between press and release, as inject.py holds its keys

func spin() { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.005)) }

func frontApp() -> NSRunningApplication? {
    spin()
    return NSWorkspace.shared.frontmostApplication
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

func nowMillis() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

func report(_ fields: [String]) {
    let line = ([String(nowMillis())] + fields).joined(separator: "\t") + "\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
}

struct Refused: Error { let text: String }

let eventSource = CGEventSource(stateID: .hidSystemState)
func post(_ code: CGKeyCode, _ down: Bool, _ flags: CGEventFlags) throws {
    guard let e = CGEvent(keyboardEventSource: eventSource, virtualKey: code, keyDown: down) else {
        throw Refused(text: "cannot create event")
    }
    e.flags = flags
    e.post(tap: .cghidEventTap)
}

/// The sandbox IDE's pid from the `pid` command; nothing is posted before it is set.
var expectedPid: pid_t = -1

func checkFront() throws {
    if expectedPid < 0 { throw Refused(text: "pid not set") }
    let front = frontApp()?.processIdentifier ?? -1
    let top = topWindowPid()
    if front != expectedPid || top != expectedPid {
        throw Refused(text: "frontPid=\(front) topWindowPid=\(top), expected \(expectedPid)")
    }
    let source = inputSourceID()
    if source != abcInputSource {
        throw Refused(text: "input source is \(source), expected \(abcInputSource)")
    }
}

func chord(_ names: [String]) throws {
    guard let last = names.last, let code = keyCodes[last] else { throw Refused(text: "unknown key \(names.last ?? "")") }
    var mods: [(CGKeyCode, CGEventFlags)] = []
    for m in names.dropLast() {
        guard let v = modifiers[m] else { throw Refused(text: "unknown modifier \(m)") }
        mods.append(v)
    }
    do {
        try checkFront()
    } catch let r as Refused {
        report(["refused", names.joined(separator: "+"), r.text])
        throw r
    }
    var flags: CGEventFlags = []
    for (mcode, mflag) in mods {
        flags.insert(mflag)
        try post(mcode, true, flags)
        usleep(holdMicros)
    }
    try post(code, true, flags)
    usleep(holdMicros)
    try post(code, false, flags)
    for (mcode, mflag) in mods.reversed() {
        usleep(holdMicros)
        flags.remove(mflag)
        try post(mcode, false, flags)
    }
    report(["posted", names.joined(separator: "+"), "front=\(expectedPid)"])
}

func activate(_ pid: pid_t) -> String {
    let ax = AXUIElementCreateApplication(pid)
    let err = AXUIElementSetAttributeValue(ax, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    var activated = false
    if err != .success, let app = NSRunningApplication(processIdentifier: pid) {
        activated = app.activate(options: [])
    }
    usleep(300_000)
    let front = frontApp()?.processIdentifier ?? -1
    let s = "axError=\(err.rawValue) nsActivate=\(activated) frontPid=\(front) topWindowPid=\(topWindowPid())"
    report(["activate", String(pid), s])
    return s
}

func handle(_ line: String) -> String {
    let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
    let verb = parts.first ?? ""
    let arg = parts.count > 1 ? parts[1] : ""
    do {
        switch verb {
        case "pid":
            guard let p = Int32(arg) else { throw Refused(text: "bad pid \(arg)") }
            expectedPid = p
            report(["pid", arg])
            return "ok"
        case "activate":
            guard let p = Int32(arg) else { throw Refused(text: "bad pid \(arg)") }
            return "ok " + activate(p)
        case "front":
            let app = frontApp()
            return "ok frontPid=\(app?.processIdentifier ?? -1) bundle=\(app?.bundleIdentifier ?? "none") topWindowPid=\(topWindowPid())"
        case "preflight":
            return "ok screenCapture=\(CGPreflightScreenCaptureAccess()) postEvent=\(CGPreflightPostEventAccess()) axTrusted=\(AXIsProcessTrusted()) inputSource=\(inputSourceID()) screenLocked=\(screenLocked())"
        case "key":
            try chord(arg.split(separator: "+").map(String.init))
            return "ok"
        case "type":
            for ch in arg { try chord([ch == " " ? "space" : String(ch)]) }
            return "ok"
        case "sleep":
            guard let ms = UInt32(arg) else { throw Refused(text: "bad sleep \(arg)") }
            usleep(ms * 1000)
            return "ok"
        default:
            throw Refused(text: "unknown command \(verb)")
        }
    } catch let r as Refused {
        return "error " + r.text
    } catch {
        return "error \(error)"
    }
}

/// Line-oriented I/O on a file descriptor pair (stdin/stdout, or one socket).
final class LineIO {
    let input: Int32
    let output: Int32
    var buffer = [UInt8]()
    init(input: Int32, output: Int32) { self.input = input; self.output = output }

    func readLine() -> String? {
        while true {
            if let nl = buffer.firstIndex(of: 10) {
                let line = String(decoding: buffer[..<nl], as: UTF8.self)
                buffer.removeSubrange(...nl)
                return line
            }
            var chunk = [UInt8](repeating: 0, count: 4096)
            let n = read(input, &chunk, chunk.count)
            if n <= 0 {
                if buffer.isEmpty { return nil }
                let line = String(decoding: buffer, as: UTF8.self)
                buffer.removeAll()
                return line
            }
            buffer.append(contentsOf: chunk[..<n])
        }
    }

    func write(_ s: String) {
        var data = Array((s + "\n").utf8)
        var off = 0
        while off < data.count {
            let n = data.withUnsafeMutableBufferPointer { p in Darwin.write(output, p.baseAddress! + off, p.count - off) }
            if n <= 0 { return }
            off += n
        }
    }
}

func serve(_ io: LineIO) {
    io.write("ready")
    while let raw = io.readLine() {
        let line = raw.trimmingCharacters(in: .newlines)
        if line.isEmpty { continue }
        if line == "quit" { report(["quit"]); break }
        io.write(handle(line))
    }
    report(["end"])
}

func listen(_ path: String) -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { report(["error", "socket: \(errno)"]); exit(5) }
    unlink(path)
    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { report(["error", "socket path too long"]); exit(2) }
    withUnsafeMutableBytes(of: &addr.sun_path) { p in
        for (i, b) in bytes.enumerated() { p[i] = b }
        p[bytes.count] = 0
    }
    let len = socklen_t(MemoryLayout<sockaddr_un>.size)
    let bound = withUnsafePointer(to: &addr) { p in
        p.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
    }
    guard bound == 0 else { report(["error", "bind: \(errno)"]); exit(5) }
    chmod(path, 0o600)
    guard Darwin.listen(fd, 1) == 0 else { report(["error", "listen: \(errno)"]); exit(5) }
    report(["listen", path])
    let client = accept(fd, nil, nil)
    guard client >= 0 else { report(["error", "accept: \(errno)"]); exit(5) }
    report(["connect"])
    return client
}

let args = CommandLine.arguments
guard args.count >= 2, args[1] == "serve", args.count == 2 || (args.count == 4 && args[2] == "--socket") else {
    FileHandle.standardError.write("usage: s3keys serve [--socket <path>]\n".data(using: .utf8)!)
    exit(2)
}
signal(SIGPIPE, SIG_IGN)
report(["start", "postEventAccess=\(CGPreflightPostEventAccess())", "axTrusted=\(AXIsProcessTrusted())", "inputSource=\(inputSourceID())"])
if args.count == 4 {
    let client = listen(args[3])
    serve(LineIO(input: client, output: client))
    close(client)
    unlink(args[3])
} else {
    serve(LineIO(input: 0, output: 1))
}
