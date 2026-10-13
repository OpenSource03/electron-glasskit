import AppKit

/// Everything this library adds to one window.
///
/// Glass that floats over the page lives in an overlay placed beside the window's content view,
/// not inside it: Chromium re-sorts the content view's subviews whenever a web view is added and
/// drops views it does not know to the bottom.
@MainActor
final class WindowHost {
    let key: UInt
    private unowned let root: NSView
    private let overlay = FlippedView()
    private var observers: [NSObjectProtocol] = []
    private var nextSequence = 0

    private(set) var background: Background?

    init(root: NSView, key: UInt, onClose: @escaping @MainActor (UInt) -> Void) {
        self.root = root
        self.key = key

        root.postsFrameChangedNotifications = true
        observe(NSView.frameDidChangeNotification, object: root) { [weak self] in self?.layoutOverlay() }
        if let window = root.window {
            // Moments at which AppKit may have rebuilt or re-sorted the window's frame view.
            let reasons = [
                NSWindow.didEnterFullScreenNotification, NSWindow.didExitFullScreenNotification,
                NSWindow.didResizeNotification, NSWindow.didBecomeKeyNotification, NSWindow.didChangeScreenNotification,
            ]
            for name in reasons {
                observe(name, object: window) { [weak self] in self?.layoutOverlay() }
            }
            observe(NSWindow.willCloseNotification, object: window) { onClose(key) }
        }
    }

    private func observe(_ name: Notification.Name, object: AnyObject, _ handler: @escaping @MainActor () -> Void) {
        observers.append(
            NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { _ in
                MainActor.assumeIsolated(handler)
            }
        )
    }

    // MARK: Overlay

    /// Keeps the overlay exactly over the content view and directly above it.
    private func layoutOverlay() {
        guard overlay.superview != nil || !overlay.subviews.isEmpty else { return }
        guard let frameView = root.superview else {
            // No frame view to share: fall back to the top of the content view itself.
            if overlay.superview !== root { root.addSubview(overlay) }
            overlay.frame = root.bounds
            overlay.autoresizingMask = [.width, .height]
            return
        }
        let siblings = frameView.subviews
        let rootIndex = siblings.firstIndex(of: root)
        let overlayIndex = siblings.firstIndex(of: overlay)
        if overlayIndex == nil || rootIndex.map({ $0 + 1 }) != overlayIndex {
            frameView.addSubview(overlay, positioned: .above, relativeTo: root)
        }
        overlay.frame = root.frame
    }

    func add(_ view: any Stackable, to group: GroupView? = nil) {
        view.sequence = nextSequence
        nextSequence += 1
        if let group {
            group.members.addSubview(view)
            group.members.sortStackableSubviews()
        } else {
            overlay.addSubview(view)
            overlay.sortStackableSubviews()
        }
        layoutOverlay()
    }

    func addGroup(_ group: GroupView) {
        group.frame = overlay.bounds
        group.autoresizingMask = [.width, .height]
        add(group)
    }

    /// Re-sorts after a `zIndex` changed, in the overlay or inside `group`.
    func restack(in group: GroupView? = nil) {
        (group?.members ?? overlay).sortStackableSubviews()
    }

    // MARK: Background

    func setBackground(_ json: Data) throws -> Background {
        if let background {
            try background.update(json)
            return background
        }
        let created = try Background(json: json, in: root)
        background = created
        return created
    }

    func clearBackground() {
        background?.removeViews()
        background = nil
    }

    // MARK: Teardown and inspection

    func detach() {
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        clearBackground()
        overlay.removeFromSuperview()
    }

    var overlayInfo: OverlayInfo {
        let siblings = root.superview?.subviews ?? []
        let above = siblings.firstIndex(of: overlay).flatMap { index in siblings.firstIndex(of: root).map { index > $0 } }
        return OverlayInfo(
            attached: overlay.superview != nil,
            aboveContent: above ?? (overlay.superview === root),
            frame: FrameOptions(overlay.frame),
            contentFrame: FrameOptions(root.frame)
        )
    }

    /// Top-level objects from back to front.
    var stackedViews: [NSView] { overlay.subviews }
}

struct OverlayInfo: Encodable {
    let attached: Bool
    let aboveContent: Bool
    let frame: FrameOptions
    let contentFrame: FrameOptions
}
