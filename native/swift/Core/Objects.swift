import AppKit

/// Something JavaScript holds an id for.
@MainActor
protocol ManagedObject: AnyObject {
    var kind: String { get }
    /// The view that is framed, stacked and hidden. `nil` for objects without a frame of their own.
    var placedView: (any Stackable)? { get }
    func update(_ json: Data) throws
    func removeViews()
}

@MainActor
final class Region: ManagedObject {
    let kind = "region"
    let view: any MaterialView & Stackable
    private var passthrough: Bool?

    var placedView: (any Stackable)? { view }

    init(json: Data) throws {
        let options = try decodeOptions(RegionPatch.self, from: json, what: "region")
        guard options.frame != nil else { throw GlassKitError("Invalid region options: missing \"frame\"") }
        view = Materials.region()
        apply(options)
    }

    func update(_ json: Data) throws {
        apply(try decodeOptions(RegionPatch.self, from: json, what: "region"))
    }

    private func apply(_ options: RegionPatch) {
        if let frame = options.frame { view.frame = frame.rect }
        if let radius = options.cornerRadius { view.radius = radius }
        if let interactive = options.interactive { view.isInteractive = interactive }
        if let explicit = options.passthrough { passthrough = explicit }
        // Interactive glass has to receive the press it reacts to.
        view.passthrough = passthrough ?? !view.isInteractive
        if let zIndex = options.zIndex { view.zIndex = zIndex }
        if let hidden = options.hidden { view.isHidden = hidden }
        view.apply(options.material)
    }

    func removeViews() {
        view.removeFromSuperview()
    }
}

@MainActor
final class Group: ManagedObject {
    let kind = "group"
    let view = GroupView()

    var placedView: (any Stackable)? { view }

    init(json: Data) throws {
        try update(json)
    }

    func update(_ json: Data) throws {
        let options = try decodeOptions(GroupPatch.self, from: json, what: "group")
        if let spacing = options.spacing { view.spacing = spacing }
        if let zIndex = options.zIndex { view.zIndex = zIndex }
    }

    func removeViews() {
        view.removeFromSuperview()
    }
}

/// One sheet of glass underneath the page, covering the window.
@MainActor
final class Background: ManagedObject {
    let kind = "background"
    private unowned let root: NSView
    private var surface: (any MaterialView)?
    private var backing: NSBox?
    private var fallback: FallbackMaterial? = .underWindow
    private var radius: CGFloat = 0
    private var appearance: AppearanceOption = .auto

    var placedView: (any Stackable)? { nil }
    var surfaceView: NSView? { surface }

    init(json: Data, in root: NSView) throws {
        self.root = root
        try update(json)
    }

    func update(_ json: Data) throws {
        let options = try decodeOptions(BackgroundPatch.self, from: json, what: "background")
        switch options.fallbackMaterial {
        case .absent: break
        case .null: fallback = nil
        case .value(let material): fallback = material
        }
        if let radius = options.cornerRadius { self.radius = max(0, radius) }
        if let appearance = options.material.appearance { self.appearance = appearance }
        if let opaque = options.opaque { setBacking(opaque) }
        installSurface()
        surface?.radius = radius
        backing?.cornerRadius = radius
        surface?.apply(options.material)
    }

    private func installSurface() {
        if #available(macOS 26.0, *) {
            if surface == nil { place(LiquidGlassView()) }
        } else if let fallback {
            let blur = surface as? BlurView ?? BlurView(blending: .behindWindow)
            blur.material = fallback.material
            if surface == nil {
                // A blur made again after the fallback was switched off starts from the remembered look.
                blur.appearance = appearance.appearance
                place(blur)
            }
        } else {
            surface?.removeFromSuperview()
            surface = nil
        }
    }

    private func place(_ view: any MaterialView) {
        view.frame = root.bounds
        view.autoresizingMask = [.width, .height]
        // Chromium keeps views it does not manage at the bottom, which is where this belongs:
        // under the page, but over the opaque backing when there is one.
        if let backing {
            root.addSubview(view, positioned: .above, relativeTo: backing)
        } else {
            root.addSubview(view, positioned: .below, relativeTo: nil)
        }
        surface = view
    }

    private func setBacking(_ opaque: Bool) {
        guard opaque else {
            backing?.removeFromSuperview()
            backing = nil
            return
        }
        guard backing == nil else { return }
        let box = NSBox(frame: root.bounds)
        box.boxType = .custom
        box.borderWidth = 0
        box.fillColor = .windowBackgroundColor
        box.autoresizingMask = [.width, .height]
        root.addSubview(box, positioned: .below, relativeTo: nil)
        backing = box
    }

    func removeViews() {
        surface?.removeFromSuperview()
        backing?.removeFromSuperview()
        surface = nil
        backing = nil
    }
}

@MainActor
@available(macOS 14.0, *)
final class Island: ManagedObject {
    let kind = "island"
    private let controller: IslandController
    private let slot: IslandSlotView

    var placedView: (any Stackable)? { slot }

    init(json: Data, emit: @escaping @MainActor (String) -> Void) throws {
        let placement = try decodeOptions(IslandPlacement.self, from: json, what: "island")
        guard let frame = placement.frame else { throw GlassKitError("Invalid island options: missing \"frame\"") }
        controller = try IslandController(optionsJSON: json, emit: emit)
        slot = IslandSlotView(content: controller.view)
        slot.frame = frame.rect
        apply(placement)
    }

    func update(_ json: Data) throws {
        apply(try decodeOptions(IslandPlacement.self, from: json, what: "island"))
        try controller.applyOptions(json: json)
    }

    private func apply(_ placement: IslandPlacement) {
        if let frame = placement.frame { slot.frame = frame.rect }
        if let zIndex = placement.zIndex { slot.zIndex = zIndex }
        if let hidden = placement.hidden { slot.isHidden = hidden }
    }

    func setContent(_ json: Data, animation: Data?) throws {
        try controller.setContent(json: json, animationJSON: animation)
    }

    func setValue(node: String, json: Data) -> Bool {
        controller.setValue(node: node, valueJSON: json)
    }

    func focus(node: String) -> Bool {
        controller.focus(node: node)
    }

    func removeViews() {
        slot.removeFromSuperview()
    }
}
