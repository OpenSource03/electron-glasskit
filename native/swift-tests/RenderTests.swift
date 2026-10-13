import AppKit

/// The subset of `IslandEvent` these tests read back.
private struct ReceivedEvent: Decodable, Equatable {
    struct Size: Decodable, Equatable {
        var width: Double
        var height: Double
    }

    var type: String
    var node: String?
    var size: Size?
}

/// An island inside a window that is never ordered in, so nothing appears on screen or takes focus.
@available(macOS 14.0, *)
@MainActor
private final class Stage {
    let controller: IslandController
    private let window: NSWindow
    private let events: EventLog

    private final class EventLog {
        var json: [String] = []
    }

    /// `beforeLayout` runs while the island is still outside any window.
    init(
        options: String, size: CGSize = CGSize(width: 400, height: 300),
        beforeLayout: @MainActor (IslandController) -> Void = { _ in }
    ) throws {
        let log = EventLog()
        events = log
        controller = try IslandController(optionsJSON: Data(options.utf8)) { log.json.append($0) }
        beforeLayout(controller)
        window = NSWindow(
            contentRect: CGRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: true)
        window.isReleasedWhenClosed = false
        let container = NSView(frame: CGRect(origin: .zero, size: size))
        window.contentView = container
        controller.view.frame = container.bounds
        container.addSubview(controller.view)
        settle()
    }

    convenience init(
        content: String, extra: String = "", size: CGSize = CGSize(width: 400, height: 300),
        beforeLayout: @MainActor (IslandController) -> Void = { _ in }
    ) throws {
        try self.init(options: "{\"content\":\(content)\(extra)}", size: size, beforeLayout: beforeLayout)
    }

    /// Lays out and lets SwiftUI deliver its geometry callbacks.
    func settle() {
        for _ in 0..<3 {
            window.contentView?.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.03))
        }
    }

    func resize(to size: CGSize) {
        window.setContentSize(size)
        controller.view.frame = CGRect(origin: .zero, size: size)
        settle()
    }

    /// True while a view inside the island is the window's first responder. The window is never key,
    /// so this moves no real keyboard focus.
    var holdsFirstResponder: Bool {
        (window.firstResponder as? NSView)?.isDescendant(of: controller.view) ?? false
    }

    func dropFirstResponder() {
        window.makeFirstResponder(nil)
    }

    func received() throws -> [ReceivedEvent] {
        try events.json.map { try JSONDecoder().decode(ReceivedEvent.self, from: Data($0.utf8)) }
    }

    func resizes() throws -> [ReceivedEvent.Size] {
        try received().filter { $0.type == "resize" }.compactMap(\.size)
    }

    /// Hit-tests a point measured from the island's top-left corner, like the page does.
    func hit(x: CGFloat, y: CGFloat) -> NSView? {
        let view = controller.view
        guard let superview = view.superview, view.isFlipped else { return nil }
        return view.hitTest(superview.convert(CGPoint(x: x, y: y), from: view))
    }
}

private let box = ##"{"type":"shape","shape":"rect","fill":"#FF0000FF","frame":{"width":120,"height":40.5}}"##

@available(macOS 14.0, *)
@MainActor
func runRenderTests() {
    // No Dock icon, no activation: the test process must stay invisible.
    NSApplication.shared.setActivationPolicy(.prohibited)

    Tests.run("render: a tree with every node type lays out") {
        let stage = try Stage(content: Fixtures.everything, size: CGSize(width: 400, height: 1000))
        try expect(stage.controller.view.superview != nil, "the island view is in the window")
        try expectEqual(try stage.resizes(), [])
        try stage.controller.setContent(json: Data(Fixtures.everything.utf8), animationJSON: Data(#""bouncy""#.utf8))
        stage.settle()
        try expectEqual(try stage.received(), [])
    }

    Tests.run("render: every node type lays out in dark and light appearance") {
        for appearance in ["dark", "light"] {
            let stage = try Stage(content: Fixtures.everything, extra: ",\"appearance\":\"\(appearance)\",\"fit\":\"both\"")
            let sizes = try stage.resizes()
            try expectEqual(sizes.count, 1)
            // The fixture's root is 380 x 900 before its own padding.
            try expect(sizes[0].width >= 380 && sizes[0].height >= 900, "unexpected size \(sizes[0])")
        }
    }

    Tests.run("render: fit height reports the content's height once") {
        let content = "{\"type\":\"vstack\",\"spacing\":0,\"children\":[\(box),{\"type\":\"text\",\"text\":\"Hi\"}]}"
        let stage = try Stage(content: content, extra: #","fit":"height""#)
        let sizes = try stage.resizes()
        try expectEqual(sizes.count, 1)
        try expect(sizes[0].height > 50 && sizes[0].height < 70, "implausible height \(sizes[0].height)")
        try expectEqual(sizes[0].height, sizes[0].height.rounded())
        try expectEqual(sizes[0].width, 120)

        // The same tree again changes nothing, so nothing is reported.
        try stage.controller.setContent(json: Data(content.utf8), animationJSON: nil)
        stage.settle()
        try expectEqual(try stage.resizes().count, 1)

        try stage.controller.setContent(json: Data(box.utf8), animationJSON: Data(#""none""#.utf8))
        stage.settle()
        try expectEqual(try stage.resizes().last, ReceivedEvent.Size(width: 120, height: 41))
        try expectEqual(try stage.resizes().count, 2)
    }

    Tests.run("render: fit waits for the host to size an axis it does not fit") {
        let wrapping = #"{"type":"text","text":"one two three four five six seven eight nine ten"}"#
        let stage = try Stage(content: wrapping, extra: #","fit":"height""#, size: .zero)
        try expectEqual(try stage.resizes(), [])
        stage.resize(to: CGSize(width: 400, height: 10))
        let sizes = try stage.resizes()
        try expectEqual(sizes.count, 1)
        try expect(sizes[0].height > 10 && sizes[0].height < 25, "one line of text, got \(sizes[0].height)")

        // Squeezed, the text wraps and wants more height.
        stage.resize(to: CGSize(width: 80, height: 10))
        try expectEqual(try stage.resizes().count, 2)
        try expect(try stage.resizes()[1].height > sizes[0].height * 2, "the wrapped text should be taller")
    }

    Tests.run("render: fit follows applyOptions") {
        let stage = try Stage(content: box)
        try expectEqual(try stage.resizes(), [])
        try stage.controller.applyOptions(json: Data(#"{"fit":"both"}"#.utf8))
        stage.settle()
        try expectEqual(try stage.resizes(), [ReceivedEvent.Size(width: 120, height: 41)])
        try stage.controller.applyOptions(json: Data(#"{"fit":"width"}"#.utf8))
        stage.settle()
        try expectEqual(try stage.resizes().count, 2)
        try stage.controller.applyOptions(json: Data(#"{"fit":"none","passthrough":false}"#.utf8))
        try stage.controller.applyOptions(json: Data("{}".utf8))
        stage.settle()
        try expectEqual(try stage.resizes().count, 2)
    }

    Tests.run("render: passthrough makes hitTest return nil") {
        let filling = ##"{"type":"shape","shape":"rect","fill":"#FF0000FF"}"##
        let stage = try Stage(content: filling)
        try expect(stage.hit(x: 200, y: 150) != nil, "an interactive island takes the click")
        try stage.controller.applyOptions(json: Data(#"{"passthrough":true}"#.utf8))
        try expect(stage.hit(x: 200, y: 150) == nil, "a passthrough island lets it through")
        try stage.controller.applyOptions(json: Data(#"{"passthrough":false}"#.utf8))
        try expect(stage.hit(x: 200, y: 150) != nil, "interactive again")

        let created = try Stage(content: filling, extra: #","passthrough":true"#)
        try expect(created.hit(x: 200, y: 150) == nil, "passthrough from the start")
    }

    Tests.run("render: clicks outside the content fall through") {
        let hugging = try Stage(content: box, extra: #","fit":"both""#)
        try expect(hugging.hit(x: 60, y: 20) != nil, "inside the 120 x 40.5 content at the top-left")
        try expect(hugging.hit(x: 200, y: 20) == nil, "right of the content")
        try expect(hugging.hit(x: 60, y: 100) == nil, "below the content")
        try expect(hugging.hit(x: 60, y: 280) == nil, "bottom-left corner of the view")

        // Without a fit the content is centred in the 400 x 300 view.
        let centred = try Stage(content: box)
        try expect(centred.hit(x: 200, y: 150) != nil, "the centre")
        try expect(centred.hit(x: 20, y: 20) == nil, "the empty corner")
    }

    Tests.run("render: appearance") {
        let stage = try Stage(content: box, extra: #","appearance":"dark""#)
        try expectEqual(stage.controller.view.appearance?.name, .darkAqua)
        try stage.controller.applyOptions(json: Data(#"{"appearance":"light"}"#.utf8))
        try expectEqual(stage.controller.view.appearance?.name, .aqua)
        try stage.controller.applyOptions(json: Data(#"{"fit":"none"}"#.utf8))
        try expectEqual(stage.controller.view.appearance?.name, .aqua)
        try stage.controller.applyOptions(json: Data(#"{"appearance":"auto"}"#.utf8))
        try expect(stage.controller.view.appearance == nil, "auto follows the window")
    }

    Tests.run("render: setValue and focus find controls and emit nothing") {
        let stage = try Stage(content: Fixtures.everything, size: CGSize(width: 400, height: 1000))
        try expect(stage.controller.setValue(node: "wifi", valueJSON: Data("false".utf8)), "toggle")
        try expect(stage.controller.setValue(node: "volume", valueJSON: Data("1.5".utf8)), "slider")
        try expect(stage.controller.setValue(node: "message", valueJSON: Data(#""line one\nline two""#.utf8)), "text field")
        try expect(stage.controller.setValue(node: "segments", valueJSON: Data(#""c""#.utf8)), "picker")
        try expect(!stage.controller.setValue(node: "wifi", valueJSON: Data(#""no""#.utf8)), "wrong type")
        try expect(!stage.controller.setValue(node: "wifi", valueJSON: Data("nonsense".utf8)), "not JSON")
        try expect(!stage.controller.setValue(node: "go", valueJSON: Data("true".utf8)), "a button")
        try expect(!stage.controller.setValue(node: "nobody", valueJSON: Data("true".utf8)), "unknown id")
        try expect(!stage.controller.focus(node: "wifi"), "only text fields take focus")
        try expect(!stage.controller.focus(node: "nobody"), "unknown id")
        stage.settle()
        try expectEqual(try stage.received(), [])
    }

    Tests.run("render: focus requested before the first layout lands once there is a window") {
        let fields = #"{"type":"vstack","children":[{"type":"textField","id":"one"},{"type":"textField","id":"two","multiline":true}]}"#
        var accepted = false
        let stage = try Stage(content: fields) { accepted = $0.focus(node: "two") }
        try expect(accepted, "the request should be accepted")
        try expect(stage.holdsFirstResponder, "the field should be first responder")
        try expectEqual(try stage.received(), [ReceivedEvent(type: "focus", node: "two", size: nil)])
    }

    Tests.run("render: focus can be requested again, for another node or the same one") {
        let fields = #"{"type":"vstack","children":[{"type":"textField","id":"one"},{"type":"textField","id":"two","multiline":true}]}"#
        let stage = try Stage(content: fields)
        try expect(!stage.holdsFirstResponder, "nothing is focused to begin with")
        @MainActor func focus(_ node: String) throws {
            try expect(stage.controller.focus(node: node), "focus(\(node))")
            stage.settle()
        }
        try focus("one")
        try focus("two")
        try focus("two")
        try expect(stage.holdsFirstResponder, "a field is first responder")
        try expectEqual(try stage.received().map { "\($0.type) \($0.node ?? "")" }, ["focus one", "blur one", "focus two"])

        // Focus that went elsewhere comes back on the next request for the same node.
        stage.dropFirstResponder()
        try expect(!stage.holdsFirstResponder, "focus left the island")
        try focus("two")
        try expect(stage.holdsFirstResponder, "focus is back")
        try expectEqual(try stage.received().suffix(2).map { "\($0.type) \($0.node ?? "")" }, ["blur two", "focus two"])
    }

    Tests.run("text field: Return belongs to the input method while it is composing") {
        let editor = NSTextView(frame: CGRect(x: 0, y: 0, width: 100, height: 20))
        try expectEqual(ReturnKey.action(shift: false, editor: editor), .submit)
        try expectEqual(ReturnKey.action(shift: true, editor: editor), .insertNewline)
        try expectEqual(ReturnKey.action(shift: false, editor: nil), .submit)
        try expectEqual(ReturnKey.action(shift: true, editor: nil), .insertNewline)

        editor.setMarkedText("ni", selectedRange: NSRange(location: 2, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        try expect(editor.hasMarkedText(), "the editor should be composing")
        try expectEqual(ReturnKey.action(shift: false, editor: editor), .commitComposition)
        try expectEqual(ReturnKey.action(shift: true, editor: editor), .commitComposition)

        editor.unmarkText()
        try expectEqual(ReturnKey.action(shift: false, editor: editor), .submit)
    }

    Tests.run("render: deep trees lay out in linear time") {
        func nested(depth: Int, modifiers: String = "") -> String {
            (0..<depth).reduce(#"{"type":"text","text":"leaf"}"#) { tree, level in
                let type = level.isMultiple(of: 2) ? "hstack" : "vstack"
                return "{\"type\":\"\(type)\"\(modifiers),\"children\":[{\"type\":\"spacer\"},\(tree)]}"
            }
        }
        @MainActor func layoutTime(_ content: String, fit: String) throws -> TimeInterval {
            let start = Date()
            _ = try Stage(content: content, extra: ",\"fit\":\"\(fit)\"")
            return Date().timeIntervalSince(start)
        }
        // Settling alone takes about 0.1 s; exponential layout took over 50 s at 18 levels.
        for fit in ["none", "both"] {
            let plain = try layoutTime(nested(depth: 20), fit: fit)
            try expect(plain < 1, "20 levels took \(plain) s with fit \(fit)")
            let deep = try layoutTime(nested(depth: 64), fit: fit)
            try expect(deep < 1, "64 levels took \(deep) s with fit \(fit)")
            let decorated = try layoutTime(
                nested(depth: 64, modifiers: #","padding":1,"frame":{"height":400,"minWidth":1,"maxWidth":"infinity"},"glass":true"#),
                fit: fit)
            try expect(decorated < 2, "64 decorated levels took \(decorated) s with fit \(fit)")
        }
        // Foundation stops parsing JSON at 512 levels, which is 256 nodes: an error, not a stack overflow.
        try expectError(containing: "invalid JSON") { _ = try decodeNode(nested(depth: 300)) }
        try expectError(containing: "invalid JSON") { _ = try decodeNode(nested(depth: 5000)) }
        _ = try decodeNode(nested(depth: 250))
    }

    Tests.run("render: numbers at the edge of their ranges lay out") {
        let extremes = ##"""
        {"type":"vstack","spacing":-100000,"padding":{"top":100000,"leading":-100000},"opacity":-1e300,
         "frame":{"minWidth":0,"maxWidth":100000,"minHeight":100000,"maxHeight":"infinity"},
         "background":{"color":"#FF0000","shape":{"type":"rect","cornerRadius":100000}},
         "children":[
          {"type":"text","text":"Big","font":{"size":2000},"lineLimit":10000},
          {"type":"text","text":"Small","font":{"size":0.1},"lineLimit":1,"opacity":1e300},
          {"type":"symbol","name":"star","size":2000},
          {"type":"spacer","minLength":100000},
          {"type":"progress","value":1e300},
          {"type":"progress","value":-1e300},
          {"type":"slider","id":"fine","min":0,"max":10000,"step":1,"value":1e300},
          {"type":"slider","id":"wide","min":-1e12,"max":1e12,"value":-1e300},
          {"type":"slider","id":"narrow","min":0,"max":5e-324},
          {"type":"textField","id":"field","multiline":{"maxLines":10000}},
          {"type":"shape","shape":{"type":"path","d":"M0 0 L1e9 1e9 A1e-9 1e9 0 1 1 5 5","viewBox":[100000,0.001]},"frame":{"width":0,"height":0}},
          {"type":"shape","shape":{"type":"text","text":"Wide"},"frame":{"width":100000,"height":0.001}},
          {"type":"glassContainer","spacing":100000,"children":[{"type":"text","text":"x","glass":true}]}
         ]}
        """##
        for fit in ["none", "both"] {
            let stage = try Stage(content: extremes, extra: ",\"fit\":\"\(fit)\"")
            // A stored number outside the slider's range is clamped when the slider reads it.
            try expect(stage.controller.setValue(node: "fine", valueJSON: Data("-1e300".utf8)), "setValue far below the range")
            try expect(stage.controller.setValue(node: "narrow", valueJSON: Data("1e300".utf8)), "setValue far above the range")
            stage.settle()
            for size in try stage.resizes() {
                try expect(size.width.isFinite && size.height.isFinite, "resize must be finite, got \(size)")
            }
        }
    }

    Tests.run("render: content changes with each kind of animation") {
        let stage = try Stage(content: Fixtures.everything, size: CGSize(width: 400, height: 1000))
        let animations = [
            #""none""#, #""default""#, #""smooth""#, #""snappy""#, #""bouncy""#, "null",
            #"{"type":"spring","duration":0.3,"bounce":0.2}"#, #"{"type":"spring"}"#,
            #"{"type":"easeInOut","duration":0.2}"#, #"{"type":"easeInOut"}"#,
        ]
        for (index, animation) in animations.enumerated() {
            let content = index.isMultiple(of: 2) ? box : Fixtures.everything
            try stage.controller.setContent(json: Data(content.utf8), animationJSON: Data(animation.utf8))
            stage.settle()
        }
        try expectError(containing: "island animation", "unknown animation \"wobble\"") {
            try stage.controller.setContent(json: Data(box.utf8), animationJSON: Data(#""wobble""#.utf8))
        }
    }

    Tests.run("render: bad input is refused with a readable error") {
        try expectError(containing: "island options: missing required key \"content\"") {
            _ = try Stage(options: #"{"fit":"both"}"#)
        }
        try expectError(containing: "island options: invalid JSON") { _ = try Stage(options: "{") }
        try expectError(containing: "island options", "at fit") { _ = try Stage(content: box, extra: #","fit":"wide""#) }
        try expectError(containing: "unknown node type \"blob\" at content.children[0]") {
            _ = try Stage(content: #"{"type":"hstack","children":[{"type":"blob"}]}"#)
        }
        try expectError(containing: "share the id \"same\"") {
            _ = try Stage(content: #"{"type":"hstack","children":[{"type":"toggle","id":"same"},{"type":"toggle","id":"same"}]}"#)
        }
        let stage = try Stage(content: box)
        try expectError(containing: "text node: missing required key \"text\"") {
            try stage.controller.setContent(json: Data(#"{"type":"text"}"#.utf8), animationJSON: nil)
        }
        try expectError(containing: "island options", "at appearance") {
            try stage.controller.applyOptions(json: Data(#"{"appearance":"sepia"}"#.utf8))
        }
    }
}
