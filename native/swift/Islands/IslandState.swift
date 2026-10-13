import Combine
import CoreGraphics
import Foundation

/// The native state of one control. Views observe it directly, so typing redraws only that control.
@MainActor
final class ControlState: ObservableObject {
    /// How many reported values are remembered for telling an echo from a new value.
    static let historyLimit = 64

    let kind: ControlKind
    @Published private(set) var value: NodeValue
    /// The value prop JavaScript sent last, which is what the next tree is compared against.
    private var lastProp: NodeValue?
    /// Values reported through `change` that JavaScript may not have caught up with yet, oldest first.
    private(set) var reported: [NodeValue] = []

    fileprivate init(_ descriptor: ControlDescriptor) {
        kind = descriptor.kind
        value = descriptor.prop ?? descriptor.initial
        lastProp = descriptor.prop
    }

    /// Stores a value the user produced. False when it is what the control already holds.
    func userSet(_ value: NodeValue) -> Bool {
        guard self.value != value else { return false }
        self.value = value
        reported.append(value)
        if reported.count > Self.historyLimit {
            reported.removeFirst(reported.count - Self.historyLimit)
        }
        return true
    }

    /// Stores a value JavaScript asked for outright.
    fileprivate func overwrite(with value: NodeValue) {
        if self.value != value {
            self.value = value
        }
    }

    /// Takes the value prop of a new tree. It overwrites native state only when it is new: different from the
    /// prop sent last time, and not an echo of something the user did that the page is only now mirroring back.
    fileprivate func receive(prop: NodeValue?) {
        defer { lastProp = prop }
        guard let prop, prop != lastProp else { return }
        if let echoed = reported.firstIndex(of: prop) {
            // The page has caught up to this point; what the user did afterwards is still on its way.
            reported.removeFirst(echoed + 1)
        } else if prop != value {
            reported.removeAll()
            value = prop
        }
    }
}

/// Owns control state across tree updates.
@MainActor
final class ControlStore {
    private var controls: [String: ControlState] = [:]

    subscript(id: String) -> ControlState? {
        controls[id]
    }

    /// Hands each control its value prop. State for ids that are gone, or that now name a different kind
    /// of control, is dropped.
    func reconcile(with descriptors: [ControlDescriptor]) {
        var next: [String: ControlState] = [:]
        for descriptor in descriptors {
            guard let control = controls[descriptor.id], control.kind == descriptor.kind else {
                next[descriptor.id] = ControlState(descriptor)
                continue
            }
            control.receive(prop: descriptor.prop)
            next[descriptor.id] = control
        }
        controls = next
    }

    /// False when there is no such control or the value is the wrong type for it.
    func setValue(_ value: NodeValue, for id: String) -> Bool {
        guard let control = controls[id], control.kind.accepts(value) else { return false }
        control.overwrite(with: value)
        return true
    }
}

extension ControlKind {
    func accepts(_ value: NodeValue) -> Bool {
        switch (self, value) {
        case (.toggle, .bool), (.slider, .number), (.textField, .string), (.picker, .string): true
        default: false
        }
    }
}

/// `IslandEvent` in `nodes.ts`.
enum IslandEvent: Equatable, Sendable {
    case press(node: String)
    case change(node: String, value: NodeValue)
    case submit(node: String, value: String)
    case focus(node: String)
    case blur(node: String)
    case resize(CGSize)
}

extension IslandEvent: Encodable {
    private enum CodingKeys: String, CodingKey {
        case type, node, value, size
    }

    private enum SizeKeys: String, CodingKey {
        case width, height
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .press(let node):
            try container.encode("press", forKey: .type)
            try container.encode(node, forKey: .node)
        case .change(let node, let value):
            try container.encode("change", forKey: .type)
            try container.encode(node, forKey: .node)
            try container.encode(value, forKey: .value)
        case .submit(let node, let value):
            try container.encode("submit", forKey: .type)
            try container.encode(node, forKey: .node)
            try container.encode(value, forKey: .value)
        case .focus(let node):
            try container.encode("focus", forKey: .type)
            try container.encode(node, forKey: .node)
        case .blur(let node):
            try container.encode("blur", forKey: .type)
            try container.encode(node, forKey: .node)
        case .resize(let size):
            try container.encode("resize", forKey: .type)
            var nested = container.nestedContainer(keyedBy: SizeKeys.self, forKey: .size)
            try nested.encode(Double(size.width), forKey: .width)
            try nested.encode(Double(size.height), forKey: .height)
        }
    }

    var json: String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return (try? encoder.encode(self)).map { String(decoding: $0, as: UTF8.self) }
    }
}

enum IslandFit: String, Decodable, Sendable {
    case none, width, height, both

    var hugsWidth: Bool { self == .width || self == .both }
    var hugsHeight: Bool { self == .height || self == .both }
}

/// Where the content was laid out inside the island view, and the fit it was laid out under.
struct ContentGeometry: Equatable, Sendable {
    /// In the island view's coordinates.
    var frame: CGRect
    /// The size of the island view itself.
    var container: CGSize
    var fit: IslandFit
}

struct FocusRequest: Equatable, Sendable {
    var node: String
    /// Makes every request a new value, also when it names the same node again.
    var serial: Int
}

/// Everything an island's views read: the tree, the control state and the way back to JavaScript.
@MainActor
final class IslandState: ObservableObject {
    @Published private(set) var root: Node
    @Published var fit: IslandFit
    @Published private(set) var focusRequest: FocusRequest?
    let controls = ControlStore()
    /// Nil until the first layout.
    private(set) var contentFrame: CGRect?

    private let emit: @MainActor (String) -> Void
    private var reported: (size: CGSize, fit: IslandFit)?
    private var focusSerial = 0

    init(root: Node, fit: IslandFit, emit: @escaping @MainActor (String) -> Void) throws {
        self.root = root
        self.fit = fit
        self.emit = emit
        controls.reconcile(with: try root.controls())
    }

    func setRoot(_ node: Node) throws {
        controls.reconcile(with: try node.controls())
        root = node
    }

    func send(_ event: IslandEvent) {
        if let json = event.json {
            emit(json)
        }
    }

    /// A change the user made, as opposed to one that arrived from JavaScript: stored, then reported.
    func userChanged(_ control: ControlState, node: String, to value: NodeValue) {
        if control.userSet(value) {
            send(.change(node: node, value: value))
        }
    }

    func requestFocus(on node: String) -> Bool {
        guard controls[node]?.kind == .textField else { return false }
        focusSerial += 1
        focusRequest = FocusRequest(node: node, serial: focusSerial)
        return true
    }

    /// Issues a request that has not taken effect yet as a new one.
    func renewFocusRequest() {
        if let node = focusRequest?.node {
            _ = requestFocus(on: node)
        }
    }

    /// Reports a focus change, and retires the request it fulfils so the same node can be asked for again.
    func focusMoved(from old: String?, to new: String?) {
        if let old {
            send(.blur(node: old))
        }
        if let new {
            send(.focus(node: new))
            if new == focusRequest?.node {
                focusRequest = nil
            }
        }
    }

    func contentGeometryChanged(_ geometry: ContentGeometry) {
        contentFrame = geometry.frame
        let fit = geometry.fit
        guard fit != .none else {
            reported = nil
            return
        }
        // An axis that is not fitted is measured against the view, which is empty until the host places it.
        guard fit.hugsWidth || geometry.container.width > 0, fit.hugsHeight || geometry.container.height > 0 else { return }
        let size = CGSize(width: geometry.frame.width.rounded(.up), height: geometry.frame.height.rounded(.up))
        if let reported, reported.fit == fit,
           !fit.hugsWidth || reported.size.width == size.width,
           !fit.hugsHeight || reported.size.height == size.height {
            return
        }
        reported = (size, fit)
        send(.resize(size))
    }
}
