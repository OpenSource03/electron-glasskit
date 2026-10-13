import CoreGraphics
import Foundation

/// One node of the tree an island renders: `GlassNode` in `nodes.ts`.
struct Node: Equatable, Sendable {
    var id: String?
    var modifiers: NodeModifiers
    var kind: Kind

    enum Kind: Equatable, Sendable {
        case stack(StackNode)
        case glassContainer(GlassContainerNode)
        case spacer(SpacerNode)
        case text(TextNode)
        case symbol(SymbolNode)
        case shape(ShapeNode)
        case divider
        case progress(ProgressNode)
        case button(ButtonNode)
        case toggle(ToggleNode)
        case slider(SliderNode)
        case textField(TextFieldNode)
        case picker(PickerNode)
        case menu(MenuNode)
    }
}

enum NodeType: String, CaseIterable, Sendable {
    case hstack, vstack, zstack, glassContainer, spacer, text, symbol, shape, divider, progress
    case button, toggle, slider, textField, picker, menu
}

struct StackNode: Equatable, Sendable {
    enum Axis: Sendable {
        case horizontal, vertical, depth
    }

    var axis: Axis
    var spacing: SignedLength?
    var alignment: NodeAlignment?
    var children: [Node]
}

struct GlassContainerNode: Decodable, Equatable, Sendable {
    var spacing: Length?
    var children: [Node]
}

struct SpacerNode: Decodable, Equatable, Sendable {
    var minLength: Length?
}

struct TextNode: Decodable, Equatable, Sendable {
    var text: String
    var lineLimit: LineCount?
}

/// A number of text lines.
struct LineCount: Decodable, Equatable, Sendable {
    static let range = 1...10_000
    let value: Int

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = try container.decode(Int.self)
        guard Self.range.contains(value) else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "must be between \(Self.range.lowerBound) and \(Self.range.upperBound)")
        }
    }
}

struct SymbolNode: Decodable, Equatable, Sendable {
    var name: String
    var size: FontSize?
    var weight: NodeFontWeight?
}

struct ShapeNode: Decodable, Equatable, Sendable {
    var shape: ShapeSpec
    var fill: ColorSpec?
}

struct ProgressNode: Decodable, Equatable, Sendable {
    var value: Double?
}

/// A `string | GlassNode` label.
indirect enum NodeLabel: Decodable, Equatable, Sendable {
    case text(String)
    case node(Node)

    init(from decoder: any Decoder) throws {
        if let text = try? decoder.singleValueContainer().decode(String.self) {
            self = .text(text)
        } else {
            self = .node(try Node(from: decoder))
        }
    }
}

struct ButtonNode: Decodable, Equatable, Sendable {
    enum Style: String, Decodable, Sendable {
        case plain, glass, glassProminent
    }

    var id: String
    var label: NodeLabel
    var style: Style?
}

struct ToggleNode: Decodable, Equatable, Sendable {
    enum Style: String, Decodable, Sendable {
        case `switch`, checkbox, button
    }

    var id: String
    var isOn: Bool?
    var label: String?
    var style: Style?
}

struct SliderNode: Equatable, Sendable {
    /// Each step is a tick SwiftUI allocates and draws.
    static let maxSteps = 10_000.0
    /// Keeps `max - min` finite and the slider's arithmetic well inside what a double resolves.
    static let limit = 1e12

    var id: String
    var value: Double?
    var min: Double
    var max: Double
    var step: Double?
}

extension SliderNode: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, value, min, max, step
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        min = try container.decodeIfPresent(Double.self, forKey: .min) ?? 0
        max = try container.decodeIfPresent(Double.self, forKey: .max) ?? 1
        step = try container.decodeIfPresent(Double.self, forKey: .step)
        func invalid(_ key: CodingKeys, _ problem: String) -> DecodingError {
            .dataCorruptedError(forKey: key, in: container, debugDescription: problem)
        }
        for (key, bound) in [(CodingKeys.min, min), (.max, max)] where abs(bound) > Self.limit {
            throw invalid(key, "must be between -1e12 and 1e12")
        }
        // SwiftUI traps on an empty range or a step that does not fit in it.
        guard min < max else {
            throw invalid(.max, "max must be greater than min")
        }
        if let step {
            guard step > 0, step <= max - min else {
                throw invalid(.step, "step must be positive and no larger than max - min")
            }
            guard (max - min) / step <= Self.maxSteps else {
                throw invalid(.step, "step divides the range into more than 10000 steps")
            }
        }
        value = try container.decodeIfPresent(Double.self, forKey: .value).map(clamped)
    }

    /// `value` moved into `min...max`.
    func clamped(_ value: Double) -> Double {
        Swift.min(Swift.max(value, min), max)
    }
}

/// `multiline`: `true` grows to 8 lines, `{ maxLines }` to that many.
struct LineGrowth: Decodable, Equatable, Sendable {
    /// `nil` keeps the field on a single line.
    let maxLines: Int?

    private enum CodingKeys: String, CodingKey {
        case maxLines
    }

    init(from decoder: any Decoder) throws {
        if let enabled = try? decoder.singleValueContainer().decode(Bool.self) {
            maxLines = enabled ? 8 : nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        maxLines = try container.decode(LineCount.self, forKey: .maxLines).value
    }
}

struct TextFieldNode: Decodable, Equatable, Sendable {
    var id: String
    var text: String?
    var placeholder: String?
    var multiline: LineGrowth?
    var clearOnSubmit: Bool?
}

struct PickerOption: Decodable, Equatable, Sendable {
    var value: String
    var label: String?
    var symbol: String?
}

struct PickerNode: Decodable, Equatable, Sendable {
    enum Style: String, Decodable, Sendable {
        case segmented, menu
    }

    var id: String
    var selection: String?
    var options: [PickerOption]
    var style: Style?
}

struct MenuItem: Decodable, Equatable, Sendable {
    var id: String
    var title: String
    var symbol: String?
    var disabled: Bool?
    var destructive: Bool?
}

enum MenuEntry: Decodable, Equatable, Sendable {
    case divider
    case item(MenuItem)

    init(from decoder: any Decoder) throws {
        guard let name = try? decoder.singleValueContainer().decode(String.self) else {
            self = .item(try MenuItem(from: decoder))
            return
        }
        guard name == "divider" else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath, debugDescription: "expected a menu item or \"divider\", found \"\(name)\""))
        }
        self = .divider
    }
}

struct MenuNode: Decodable, Equatable, Sendable {
    var label: NodeLabel
    var items: [MenuEntry]
}

// MARK: - Decoding

extension Node: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, id, spacing, alignment, children
    }

    init(from decoder: any Decoder) throws {
        var subject = "node"
        do {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let name = try container.decode(String.self, forKey: .type)
            guard let type = NodeType(rawValue: name) else {
                throw IslandError("unknown node type \"\(name)\"\(IslandError.location(decoder.codingPath))")
            }
            subject = "\(name) node"
            id = try container.decodeIfPresent(String.self, forKey: .id)
            modifiers = try NodeModifiers(from: decoder)
            kind = try Self.kind(type, container: container, decoder: decoder)
        } catch let error as DecodingError {
            // Errors from child nodes are already `IslandError`s and pass through untouched.
            throw IslandError(error, decoding: subject)
        }
    }

    private static func kind(
        _ type: NodeType, container: KeyedDecodingContainer<CodingKeys>, decoder: any Decoder
    ) throws -> Kind {
        switch type {
        case .hstack: .stack(try stack(.horizontal, container: container))
        case .vstack: .stack(try stack(.vertical, container: container))
        case .zstack: .stack(try stack(.depth, container: container))
        case .glassContainer: .glassContainer(try GlassContainerNode(from: decoder))
        case .spacer: .spacer(try SpacerNode(from: decoder))
        case .text: .text(try TextNode(from: decoder))
        case .symbol: .symbol(try SymbolNode(from: decoder))
        case .shape: .shape(try ShapeNode(from: decoder))
        case .divider: .divider
        case .progress: .progress(try ProgressNode(from: decoder))
        case .button: .button(try ButtonNode(from: decoder))
        case .toggle: .toggle(try ToggleNode(from: decoder))
        case .slider: .slider(try SliderNode(from: decoder))
        case .textField: .textField(try TextFieldNode(from: decoder))
        case .picker: .picker(try PickerNode(from: decoder))
        case .menu: .menu(try MenuNode(from: decoder))
        }
    }

    private static func stack(_ axis: StackNode.Axis, container: KeyedDecodingContainer<CodingKeys>) throws -> StackNode {
        StackNode(
            axis: axis,
            spacing: try container.decodeIfPresent(SignedLength.self, forKey: .spacing),
            alignment: try container.decodeIfPresent(NodeAlignment.self, forKey: .alignment),
            children: try container.decode([Node].self, forKey: .children))
    }
}

// MARK: - Controls

/// The value a control holds: `NodeValue` in `nodes.ts`.
enum NodeValue: Codable, Equatable, Sendable {
    case bool(Bool)
    case number(Double)
    case string(String)

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let number = try? container.decode(Double.self) {
            self = .number(number)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "expected a string, number or boolean")
        }
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .bool(let bool): try container.encode(bool)
        case .number(let number): try container.encode(number)
        case .string(let string): try container.encode(string)
        }
    }
}

enum ControlKind: Sendable {
    case toggle, slider, textField, picker
}

/// What a tree says about one stateful control.
struct ControlDescriptor: Equatable, Sendable {
    var id: String
    var kind: ControlKind
    /// The value prop as sent, `nil` when it was left out.
    var prop: NodeValue?
    /// What the control starts at when no prop was ever sent.
    var initial: NodeValue
}

extension Node {
    /// Every stateful control in the tree, depth first. Throws when two controls share an id.
    func controls() throws -> [ControlDescriptor] {
        var found: [ControlDescriptor] = []
        var seen: Set<String> = []
        try collectControls(into: &found, seen: &seen)
        return found
    }

    private func collectControls(into found: inout [ControlDescriptor], seen: inout Set<String>) throws {
        if let control {
            guard seen.insert(control.id).inserted else {
                throw IslandError("two controls share the id \"\(control.id)\"; control ids must be unique in an island")
            }
            found.append(control)
        }
        for child in nested {
            try child.collectControls(into: &found, seen: &seen)
        }
    }

    private var control: ControlDescriptor? {
        switch kind {
        case .toggle(let toggle):
            ControlDescriptor(id: toggle.id, kind: .toggle, prop: toggle.isOn.map(NodeValue.bool), initial: .bool(false))
        case .slider(let slider):
            ControlDescriptor(id: slider.id, kind: .slider, prop: slider.value.map(NodeValue.number), initial: .number(slider.min))
        case .textField(let field):
            ControlDescriptor(id: field.id, kind: .textField, prop: field.text.map(NodeValue.string), initial: .string(""))
        case .picker(let picker):
            ControlDescriptor(id: picker.id, kind: .picker, prop: picker.selection.map(NodeValue.string), initial: .string(""))
        default:
            nil
        }
    }

    private var nested: [Node] {
        switch kind {
        case .stack(let stack): stack.children
        case .glassContainer(let container): container.children
        case .button(let button): button.label.node.map { [$0] } ?? []
        case .menu(let menu): menu.label.node.map { [$0] } ?? []
        default: []
        }
    }
}

extension NodeLabel {
    var node: Node? {
        if case .node(let node) = self { node } else { nil }
    }
}
