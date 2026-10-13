import AppKit

/// A view the overlay stacks and hit-tests.
@MainActor
protocol Stackable: NSView {
    var zIndex: Int { get set }
    /// Insertion order; breaks ties between equal `zIndex` values.
    var sequence: Int { get set }
}

extension NSView {
    /// Orders `Stackable` subviews back to front by `zIndex`, then by insertion.
    @MainActor
    func sortStackableSubviews() {
        sortSubviews({ first, second, _ in
            guard let a = first as? any Stackable, let b = second as? any Stackable else { return .orderedSame }
            let (left, right) = MainActor.assumeIsolated { ((a.zIndex, a.sequence), (b.zIndex, b.sequence)) }
            return left < right ? .orderedAscending : left > right ? .orderedDescending : .orderedSame
        }, context: nil)
    }
}

/// A piece of glass, or the blur that stands in for it before macOS 26.
@MainActor
protocol MaterialView: NSView {
    var radius: CGFloat { get set }
    var isInteractive: Bool { get set }
    /// Clicks fall through to the page when true.
    var passthrough: Bool { get set }
    func apply(_ material: MaterialPatch)
}

/// Top-left origin, so frames match the web page's coordinates.
class FlippedView: NSView {
    override var isFlipped: Bool { true }

    /// Only subviews take clicks; the empty area belongs to whatever is underneath.
    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }
}

@available(macOS 26.0, *)
final class LiquidGlassView: NSGlassEffectView, MaterialView, Stackable {
    var zIndex = 0
    var sequence = 0
    var passthrough = true

    var radius: CGFloat {
        get { cornerRadius }
        set { cornerRadius = newValue }
    }

    // `effectIsInteractive` is public from the macOS 27 SDK; reaching it by name keeps the macOS 26 SDK building.
    var isInteractive: Bool {
        get { responds(to: Self.interactiveSetter) && (value(forKey: "effectIsInteractive") as? Bool ?? false) }
        set { if responds(to: Self.interactiveSetter) { setValue(newValue, forKey: "effectIsInteractive") } }
    }

    static let interactiveSetter = NSSelectorFromString("setEffectIsInteractive:")

    override func hitTest(_ point: NSPoint) -> NSView? {
        passthrough ? nil : super.hitTest(point)
    }

    func apply(_ material: MaterialPatch) {
        if let style = material.style { self.style = style == .clear ? .clear : .regular }
        switch material.tint {
        case .absent: break
        case .null: tintColor = nil
        case .value(let hex): tintColor = HexColor.parse(hex)
        }
        if let appearance = material.appearance { self.appearance = appearance.appearance }
        if let variant = material.variant { setUndocumented("_variant", variant) }
        if let scrim = material.scrim { setUndocumented("_scrimState", scrim ? 1 : 0) }
        if let subdued = material.subdued { setUndocumented("_subduedState", subdued ? 1 : 0) }
    }

    /// The system's own material presets have no public API; skip quietly where a setter is gone.
    private func setUndocumented(_ key: String, _ value: Int) {
        guard responds(to: NSSelectorFromString("set\(key):")) else { return }
        setValue(value, forKey: key)
    }
}

final class BlurView: NSVisualEffectView, MaterialView, Stackable {
    var zIndex = 0
    var sequence = 0
    var passthrough = true

    /// A blur has no press feedback, so it never needs the click.
    var isInteractive: Bool {
        get { false }
        set {}
    }

    var radius: CGFloat = 0 {
        didSet {
            wantsLayer = true
            layer?.cornerRadius = radius
            layer?.cornerCurve = .continuous
            layer?.masksToBounds = true
        }
    }

    init(blending: NSVisualEffectView.BlendingMode) {
        super.init(frame: .zero)
        blendingMode = blending
        material = blending == .behindWindow ? .underWindowBackground : .hudWindow
        state = .active
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? {
        passthrough ? nil : super.hitTest(point)
    }

    func apply(_ material: MaterialPatch) {
        if let appearance = material.appearance { self.appearance = appearance.appearance }
    }
}

/// Glass regions added to `members` merge when they come within `spacing` of each other.
@MainActor
final class GroupView: FlippedView, Stackable {
    var zIndex = 0
    var sequence = 0
    let members = FlippedView()

    var spacing: CGFloat = 0 {
        didSet {
            if #available(macOS 26.0, *) { (container as? NSGlassEffectContainerView)?.spacing = spacing }
        }
    }

    private let container: NSView?

    init() {
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectContainerView()
            glass.contentView = members
            container = glass
        } else {
            container = nil
        }
        super.init(frame: .zero)
        let content = container ?? members
        content.frame = bounds
        content.autoresizingMask = [.width, .height]
        addSubview(content)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    /// The group spans the whole window, so only a region that takes clicks may claim one.
    override func hitTest(_ point: NSPoint) -> NSView? {
        for region in members.subviews.reversed() where !region.isHidden {
            guard let parent = region.superview else { continue }
            if let hit = region.hitTest(parent.convert(point, from: superview)) { return hit }
        }
        return nil
    }
}

/// Holds one island so it can be stacked and framed like every other object.
@MainActor
final class IslandSlotView: FlippedView, Stackable {
    var zIndex = 0
    var sequence = 0

    init(content: NSView) {
        super.init(frame: .zero)
        content.frame = bounds
        content.autoresizingMask = [.width, .height]
        addSubview(content)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }
}

@MainActor
enum Materials {
    static var glassAvailable: Bool {
        if #available(macOS 26.0, *) { true } else { false }
    }

    static var interactiveAvailable: Bool {
        if #available(macOS 26.0, *) {
            NSGlassEffectView.instancesRespond(to: LiquidGlassView.interactiveSetter)
        } else {
            false
        }
    }

    /// Glass for a region floating over the page.
    static func region() -> any MaterialView & Stackable {
        if #available(macOS 26.0, *) { LiquidGlassView() } else { BlurView(blending: .withinWindow) }
    }
}
