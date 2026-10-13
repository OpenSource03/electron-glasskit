import AppKit

/// A window that is never ordered in, with glass attached to its content view.
@MainActor
private final class WindowStage {
    let root = NSView(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
    private let window = NSWindow(
        contentRect: CGRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.titled, .resizable], backing: .buffered,
        defer: true)

    init() {
        window.isReleasedWhenClosed = false
        window.contentView = root
    }

    var key: UInt { UInt(bitPattern: Unmanaged.passUnretained(root).toOpaque()) }

    func region(_ json: String, in group: Int32 = 0) throws -> Int32 {
        try Runtime.shared.createRegion(root: key, groupId: group, json: Data(json.utf8))
    }

    func group(_ json: String = "{}") throws -> Int32 {
        try Runtime.shared.createGroup(root: key, json: Data(json.utf8))
    }

    /// Whether a click at a point given from the content's top-left corner reaches the page underneath.
    func reachesPage(x: CGFloat, y: CGFloat) -> Bool {
        guard let frameView = root.superview else { return false }
        frameView.layoutSubtreeIfNeeded()
        let point = frameView.convert(CGPoint(x: x, y: root.bounds.height - y), from: root)
        return frameView.hitTest(point) === root
    }

    func close() {
        Runtime.shared.detach(key: key)
    }
}

private let frame = #"{"x":40,"y":40,"width":120,"height":60}"#

@MainActor
func runCoreTests() {
    Tests.run("core: clicks pass through the overlay and through a region") {
        let stage = WindowStage()
        defer { stage.close() }
        _ = try stage.region(#"{"frame":\#(frame)}"#)
        try expect(stage.reachesPage(x: 300, y: 200), "an empty part of the overlay took the click")
        try expect(stage.reachesPage(x: 60, y: 60), "a pass-through region took the click")
    }

    Tests.run("core: a region that takes clicks keeps them") {
        let stage = WindowStage()
        defer { stage.close() }
        _ = try stage.region(#"{"frame":\#(frame),"passthrough":false}"#)
        try expect(!stage.reachesPage(x: 60, y: 60), "the click went through the region")
        try expect(stage.reachesPage(x: 300, y: 200), "the click outside the region did not reach the page")
    }

    Tests.run("core: a group only takes clicks on regions that want them") {
        let stage = WindowStage()
        defer { stage.close() }
        let group = try stage.group(#"{"spacing":40}"#)
        _ = try stage.region(#"{"frame":\#(frame)}"#, in: group)
        try expect(stage.reachesPage(x: 300, y: 200), "the group took a click on its empty area")
        try expect(stage.reachesPage(x: 60, y: 60), "a pass-through region in a group took the click")

        _ = try stage.region(#"{"frame":{"x":200,"y":40,"width":120,"height":60},"passthrough":false}"#, in: group)
        try expect(!stage.reachesPage(x: 220, y: 60), "the click went through a region that takes clicks")
        try expect(stage.reachesPage(x: 300, y: 200), "the group took a click outside its regions")
    }

    Tests.run("core: a hidden region takes no clicks") {
        let stage = WindowStage()
        defer { stage.close() }
        let group = try stage.group()
        _ = try stage.region(#"{"frame":\#(frame),"passthrough":false,"hidden":true}"#, in: group)
        _ = try stage.region(#"{"frame":{"x":200,"y":40,"width":120,"height":60},"passthrough":false,"hidden":true}"#)
        try expect(stage.reachesPage(x: 60, y: 60), "a hidden region in a group took the click")
        try expect(stage.reachesPage(x: 220, y: 60), "a hidden region took the click")
    }

    Tests.run("core: frames that AppKit cannot represent are refused") {
        let stage = WindowStage()
        defer { stage.close() }
        let id = try stage.region(#"{"frame":\#(frame)}"#)
        try expectError(containing: "finite") {
            try Runtime.shared.setFrame(id, CGRect(x: CGFloat.nan, y: 0, width: 10, height: 10), animate: 0)
        }
        try expectError(containing: "finite") {
            try Runtime.shared.setFrame(id, CGRect(x: 0, y: 0, width: CGFloat.infinity, height: 10), animate: 0)
        }
        try Runtime.shared.setFrame(id, CGRect(x: 0, y: 0, width: -50, height: 10), animate: 0)
    }

    Tests.run("core: bad options and unknown ids are errors, not crashes") {
        let stage = WindowStage()
        defer { stage.close() }
        try expectError(containing: "frame") { _ = try stage.region("{}") }
        try expectError(containing: "region") { _ = try stage.region(#"{"frame":\#(frame),"style":"frosted"}"#) }
        try expectError(containing: "does not exist") { try Runtime.shared.update(9_999_999, json: Data("{}".utf8)) }
        try expectError(containing: "Group") { _ = try stage.region(#"{"frame":\#(frame)}"#, in: 9_999_999) }
        Runtime.shared.remove(9_999_999)
        Runtime.shared.detach(key: 0xDEAD_BEEF)
    }

    Tests.run("core: removing a group removes its regions, and detaching removes everything") {
        let stage = WindowStage()
        let group = try stage.group()
        let member = try stage.region(#"{"frame":\#(frame)}"#, in: group)
        let loose = try stage.region(#"{"frame":\#(frame)}"#)
        Runtime.shared.remove(group)
        try expectError(containing: "does not exist") { try Runtime.shared.update(member, json: Data("{}".utf8)) }
        try Runtime.shared.update(loose, json: Data(#"{"hidden":true}"#.utf8))
        stage.close()
        try expectError(containing: "does not exist") { try Runtime.shared.update(loose, json: Data("{}".utf8)) }
        try expect(stage.root.superview?.subviews.count == stage.root.superview?.subviews.filter { !($0 is FlippedView) }.count, "the overlay was left behind")
    }
}
