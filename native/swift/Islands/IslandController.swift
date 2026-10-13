import AppKit
import SwiftUI

/// One island: a view the host places above the page, and the calls that drive it.
@MainActor
@available(macOS 14.0, *)
final class IslandController {
    private let state: IslandState
    private let host: IslandHostingView

    /// `options` JSON: `{ "content": GlassNode, "fit"?, "passthrough"?, "appearance"? }`.
    /// `emit` receives one JSON object per event, matching `IslandEvent` in `nodes.ts`.
    init(optionsJSON: Data, emit: @escaping @MainActor (String) -> Void) throws {
        let options = try IslandJSON.decode(IslandOptions.self, from: optionsJSON, subject: "island options")
        state = try IslandState(root: options.content, fit: options.fit ?? .none, emit: emit)
        host = IslandHostingView(rootView: IslandRootView(state: state))
        host.passthrough = options.passthrough ?? false
        host.appearance = options.appearance?.appKit
    }

    var view: NSView { host }

    /// Replaces the tree. `animationJSON` matches `IslandAnimation`; without it the change is not animated.
    func setContent(json: Data, animationJSON: Data?) throws {
        let content = try IslandJSON.decode(Node.self, from: json, subject: "island content")
        let animation = try animationJSON.flatMap {
            try IslandJSON.decode(IslandAnimation?.self, from: $0, subject: "island animation")
        }
        try withTransaction((animation ?? .none).transaction) {
            try state.setRoot(content)
        }
    }

    /// Applies whichever of `fit`, `passthrough` and `appearance` are present.
    func applyOptions(json: Data) throws {
        let update = try IslandJSON.decode(IslandOptionsUpdate.self, from: json, subject: "island options")
        if let fit = update.fit, fit != state.fit {
            state.fit = fit
        }
        if let passthrough = update.passthrough {
            host.passthrough = passthrough
        }
        if let appearance = update.appearance {
            host.appearance = appearance.appKit
        }
    }

    /// Overwrites a control's value without emitting `change`. False when there is no such control
    /// or the value is not one it can hold.
    func setValue(node: String, valueJSON: Data) -> Bool {
        guard let value = try? JSONDecoder().decode(NodeValue.self, from: valueJSON) else { return false }
        return state.controls.setValue(value, for: node)
    }

    /// Moves keyboard focus to a text field. False when there is no text field with that id.
    func focus(node: String) -> Bool {
        state.requestFocus(on: node)
    }
}

@available(macOS 14.0, *)
final class IslandHostingView: NSHostingView<IslandRootView> {
    /// Lets every click through to the page underneath.
    var passthrough = false

    required init(rootView: IslandRootView) {
        super.init(rootView: rootView)
        // The host sets the frame; the content must never push its size onto the window.
        sizingOptions = []
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    /// Focus can only land once there is a window, so a request made before then is tried again.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil {
            rootView.state.renewFocusRequest()
        }
    }

    /// Clicks outside the content's layout frame fall through to the page. Gaps inside that frame do not:
    /// SwiftUI does not say whether a point inside it landed on anything.
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !passthrough, let hit = super.hitTest(point) else { return nil }
        guard let content = rootView.state.contentFrame, let superview else { return hit }
        return content.contains(convert(point, from: superview)) ? hit : nil
    }
}

/// Names the island view's own coordinate space, which content frames are measured in.
private let islandCoordinateSpace = "island"

@available(macOS 14.0, *)
struct IslandRootView: View {
    @ObservedObject var state: IslandState
    @Namespace private var namespace
    @FocusState private var focus: String?

    var body: some View {
        let fit = state.fit
        NodeView(node: state.root, context: RenderContext(state: state, namespace: namespace, focus: $focus))
            .fixedSize(horizontal: fit.hugsWidth, vertical: fit.hugsHeight)
            .onGeometryChange(for: ContentGeometry.self) { proxy in
                ContentGeometry(
                    frame: proxy.frame(in: .named(islandCoordinateSpace)),
                    container: proxy.bounds(of: .named(islandCoordinateSpace))?.size ?? .zero,
                    fit: fit)
            } action: { geometry in
                state.contentGeometryChanged(geometry)
            }
            .frame(
                maxWidth: .infinity, maxHeight: .infinity,
                alignment: Alignment(horizontal: fit.hugsWidth ? .leading : .center, vertical: fit.hugsHeight ? .top : .center))
            .coordinateSpace(.named(islandCoordinateSpace))
            // Islands sit over the page, including under a transparent title bar.
            .ignoresSafeArea()
            // `initial` picks up a request made before the view first appeared.
            .onChange(of: state.focusRequest, initial: true) { _, request in
                if let request {
                    focus = request.node
                }
            }
            .onChange(of: focus) { old, new in
                state.focusMoved(from: old, to: new)
            }
    }
}
