// Get or select the keyboard input source of the logged-in user's session (spike S3 macOS row).
// Usage: s3input get | s3input select <input source id>
import Carbon
import Foundation

func currentID() -> String {
    let src = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    guard let raw = TISGetInputSourceProperty(src, kTISPropertyInputSourceID) else { return "unknown" }
    return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
}

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "get" {
    print(currentID()); exit(0)
}
if args.count >= 3 && args[1] == "select" {
    let filter = [kTISPropertyInputSourceID as String: args[2]] as CFDictionary
    guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource],
          let src = list.first else {
        print("error not-enabled \(args[2])"); exit(2)
    }
    let status = TISSelectInputSource(src)
    usleep(300_000)
    print("status=\(status) current=\(currentID())")
    exit(status == noErr ? 0 : 1)
}
print("usage: s3input get | s3input select <id>"); exit(64)
