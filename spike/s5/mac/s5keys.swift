// Spike S5 key sender for macOS. Build: /usr/bin/swiftc -O -o s5keys s5keys.swift
//   s5keys <pid> <sequence file> <delay ms> [first key] [count]
// Posts each key of the sequence as CGEvents to the HID event tap. Before every key it checks that
// <pid> owns the frontmost app and the topmost normal window, and that the input source is ABC;
// otherwise it stops with exit code 3, so no key can reach another app. Prints one line per key sent.
import AppKit
import Carbon
import CoreGraphics
import Foundation

let keyCodes: [String: CGKeyCode] = [
    "a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05, "z": 0x06, "x": 0x07,
    "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C, "w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10,
    "t": 0x11, "o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26, "k": 0x28,
    "n": 0x2D, "m": 0x2E, "Space": 0x31, "Escape": 0x35,
]
let modifiers: [String: (CGKeyCode, CGEventFlags)] = [
    "Ctrl": (0x3B, .maskControl), "Cmd": (0x37, .maskCommand),
    "Alt": (0x3A, .maskAlternate), "Shift": (0x38, .maskShift),
]

func spin() { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.005)) }

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

func fail(_ message: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 4, let pid = Int32(args[1]), let delay = UInt32(args[3]) else {
    fail("usage: s5keys <pid> <sequence file> <delay ms> [first key] [count]", 2)
}
let all = try! String(contentsOfFile: args[2], encoding: .utf8)
    .split(separator: "\n").map(String.init).filter { !$0.isEmpty }
let first = args.count >= 5 ? Int(args[4])! : 1
let count = args.count >= 6 ? Int(args[5])! : all.count - first + 1
let keys = Array(all[(first - 1)..<(first - 1 + count)])

let source = CGEventSource(stateID: .hidSystemState)
func post(_ code: CGKeyCode, _ down: Bool, _ flags: CGEventFlags) {
    guard let e = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else {
        fail("cannot create event", 5)
    }
    e.flags = flags
    e.post(tap: .cghidEventTap)
}

print("# postEventAccess=\(CGPreflightPostEventAccess())\tinputSource=\(inputSourceID())\tpid=\(pid)\tfirst=\(first)\tcount=\(count)\tdelayMs=\(delay)")
for (offset, key) in keys.enumerated() {
    let n = first + offset
    let parts = key.split(separator: "+").map(String.init)
    guard let code = keyCodes[parts.last!] else { fail("unknown key \(key) at \(n)", 2) }
    let mods = parts.dropLast().map { m -> (CGKeyCode, CGEventFlags) in
        guard let v = modifiers[m] else { fail("unknown modifier \(m) at \(n)", 2) }
        return v
    }
    let front = frontPid(), top = topWindowPid(), source = inputSourceID()
    if front != pid || top != pid {
        fail("stop before key \(n): frontPid=\(front) topWindowPid=\(top), expected \(pid)", 3)
    }
    if source != "com.apple.keylayout.ABC" {
        fail("stop before key \(n): input source is \(source), expected com.apple.keylayout.ABC", 4)
    }
    var flags: CGEventFlags = []
    for (mcode, mflag) in mods {
        flags.insert(mflag)
        post(mcode, true, flags)
        usleep(4000)
    }
    post(code, true, flags)
    usleep(4000)
    post(code, false, flags)
    for (mcode, mflag) in mods.reversed() {
        usleep(4000)
        flags.remove(mflag)
        post(mcode, false, flags)
    }
    print("\(n)\t\(Int(Date().timeIntervalSince1970 * 1000))\t\(key)")
    fflush(stdout)
    usleep(delay * 1000)
}
