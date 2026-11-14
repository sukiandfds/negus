import Cocoa
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit

func output(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), let s = String(data: data, encoding: .utf8) { print(s) }
}
let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? "permissions"
if command == "permissions" || command == "authorize" {
    if command == "authorize" {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        _ = CGRequestScreenCaptureAccess()
    }
    output(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "executable": CommandLine.arguments[0]])
} else if command == "screenshot" {
    guard CGPreflightScreenCaptureAccess() else { output(["error":"Screen Recording permission is required for Negus Computer."]); exit(1) }
    guard args.count == 2 else { exit(1) }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly:true)
    guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else { exit(1) }
    let filter = SCContentFilter(display:display, excludingWindows:[])
    let config = SCStreamConfiguration()
    config.width = display.width; config.height = display.height; config.showsCursor = true
    let image: CGImage = try await withCheckedThrowingContinuation { continuation in
        SCScreenshotManager.captureImage(contentFilter:filter, configuration:config) { image, error in
            if let image = image { continuation.resume(returning:image) }
            else { continuation.resume(throwing:error ?? NSError(domain:"NegusComputer",code:1)) }
        }
    }
    let bitmap = NSBitmapImageRep(cgImage:image)
    guard let data = bitmap.representation(using:.png, properties:[:]) else { exit(1) }
    do { try data.write(to:URL(fileURLWithPath:args[1])); let b = CGDisplayBounds(CGMainDisplayID()); output(["path":args[1],"width":image.width,"height":image.height,"coordinateWidth":b.width,"coordinateHeight":b.height]) } catch { output(["error":error.localizedDescription]); exit(1) }
} else if command == "open-url" {
    guard args.count == 2, let url = URL(string:args[1]), ["https","http"].contains(url.scheme ?? "") else { output(["error":"An HTTP(S) URL is required"]);exit(1) }
    output(["opened":NSWorkspace.shared.open(url)])
} else {
    guard AXIsProcessTrusted() else { output(["error":"Accessibility permission is required for Negus Computer."]); exit(1) }
    let source = CGEventSource(stateID:.hidSystemState)
    if command == "click", args.count == 3, let x=Double(args[1]), let y=Double(args[2]) {
        let p=CGPoint(x:x,y:y)
        CGEvent(mouseEventSource:source,mouseType:.leftMouseDown,mouseCursorPosition:p,mouseButton:.left)?.post(tap:.cghidEventTap)
        CGEvent(mouseEventSource:source,mouseType:.leftMouseUp,mouseCursorPosition:p,mouseButton:.left)?.post(tap:.cghidEventTap)
    } else if command == "type", args.count == 2 {
        let units=Array(args[1].utf16)
        for start in stride(from:0,to:units.count,by:20) {
            let chunk=Array(units[start..<min(start+20,units.count)])
            for down in [true,false] { let e=CGEvent(keyboardEventSource:source,virtualKey:0,keyDown:down);e?.keyboardSetUnicodeString(stringLength:chunk.count,unicodeString:chunk);e?.post(tap:.cghidEventTap) }
        }
    } else if command == "key", args.count >= 2, let key=UInt16(args[1]) {
        var flags=CGEventFlags()
        for f in args.dropFirst(2) { if f == "command" { flags.insert(.maskCommand) }; if f == "shift" {flags.insert(.maskShift)};if f == "option" {flags.insert(.maskAlternate)};if f == "control" {flags.insert(.maskControl)} }
        for down in [true,false] {let e=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:down);e?.flags=flags;e?.post(tap:.cghidEventTap)}
    } else if command == "scroll", args.count == 2, let amount=Int32(args[1]) {
        CGEvent(scrollWheelEvent2Source:source,units:.line,wheelCount:1,wheel1:amount,wheel2:0,wheel3:0)?.post(tap:.cghidEventTap)
    } else {output(["error":"Unsupported command or invalid arguments"]);exit(1)}
    output(["ok":true])
}
