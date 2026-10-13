import CoreGraphics
import Foundation

// The value types shared by nodes. JSON keys are the TypeScript property names in `nodes.ts`.

enum NodeAlignment: String, Decodable, Sendable {
    case center, leading, trailing, top, bottom, topLeading, topTrailing, bottomLeading, bottomTrailing
}

enum NodeFontWeight: String, Decodable, Sendable {
    case ultraLight, thin, light, regular, medium, semibold, bold, heavy, black
}

enum NodeFontDesign: String, Decodable, Sendable {
    case `default`, rounded, serif, monospaced
}

enum GlassStyle: String, Decodable, Sendable {
    case regular, clear
}

/// The range a number in the tree may take. JSON cannot carry NaN or infinity, so a range is all it takes
/// to keep SwiftUI and CoreText away from values they trap or hang on.
protocol NumberBounds {
    static var range: ClosedRange<CGFloat> { get }
}

enum SignedLengthBounds: NumberBounds {
    static let range: ClosedRange<CGFloat> = -100_000...100_000
}

enum LengthBounds: NumberBounds {
    static let range: ClosedRange<CGFloat> = 0...100_000
}

enum FontSizeBounds: NumberBounds {
    static let range: ClosedRange<CGFloat> = 0.1...2_000
}

struct Bounded<Bounds: NumberBounds>: Decodable, Equatable, Sendable {
    let value: CGFloat

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = try container.decode(CGFloat.self)
        guard Bounds.range.contains(value) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "must be between \(Self.text(Bounds.range.lowerBound)) and \(Self.text(Bounds.range.upperBound))")
        }
    }

    private static func text(_ number: CGFloat) -> String {
        number == number.rounded() ? String(Int(number)) : String(Double(number))
    }
}

/// Padding and spacing, which may be negative.
typealias SignedLength = Bounded<SignedLengthBounds>
/// Sizes and radii.
typealias Length = Bounded<LengthBounds>
typealias FontSize = Bounded<FontSizeBounds>

struct FontSpec: Decodable, Equatable, Sendable {
    var size: FontSize?
    var weight: NodeFontWeight?
    var design: NodeFontDesign?
}

struct ColorSpec: Decodable, Equatable, Sendable {
    let components: HexColor.Components

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let components = HexColor.components(string) else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "\"\(string)\" is not a #RGB, #RRGGBB or #RRGGBBAA colour")
        }
        self.components = components
    }
}

/// `padding`: one number for every edge, or per-edge values with `horizontal` / `vertical` shorthands.
struct InsetsSpec: Decodable, Equatable, Sendable {
    var top: CGFloat
    var bottom: CGFloat
    var leading: CGFloat
    var trailing: CGFloat

    private enum CodingKeys: String, CodingKey {
        case top, bottom, leading, trailing, horizontal, vertical
    }

    init(from decoder: any Decoder) throws {
        if (try? decoder.singleValueContainer().decode(CGFloat.self)) != nil {
            let all = try SignedLength(from: decoder).value
            (top, bottom, leading, trailing) = (all, all, all, all)
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        func edge(_ key: CodingKeys, default fallback: CGFloat) throws -> CGFloat {
            try container.decodeIfPresent(SignedLength.self, forKey: key)?.value ?? fallback
        }
        let horizontal = try edge(.horizontal, default: 0)
        let vertical = try edge(.vertical, default: 0)
        top = try edge(.top, default: vertical)
        bottom = try edge(.bottom, default: vertical)
        leading = try edge(.leading, default: horizontal)
        trailing = try edge(.trailing, default: horizontal)
    }
}

/// A length that may also be the string `"infinity"`.
struct Extent: Decodable, Equatable, Sendable {
    let value: CGFloat

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if (try? container.decode(CGFloat.self)) != nil {
            value = try Length(from: decoder).value
        } else if try container.decode(String.self) == "infinity" {
            value = .infinity
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "expected a number or \"infinity\"")
        }
    }
}

struct FrameSpec: Decodable, Equatable, Sendable {
    var width: Length?
    var height: Length?
    var minWidth: Length?
    var maxWidth: Extent?
    var minHeight: Length?
    var maxHeight: Extent?
    var alignment: NodeAlignment?
}

enum ShapeSpec: Equatable, Sendable {
    case capsule
    case circle
    case rect(cornerRadius: CGFloat)
    /// `viewBox` is the size of the coordinate space the path was drawn in.
    case path(SVGPath, viewBox: CGSize?)
    case text(String, weight: NodeFontWeight, design: NodeFontDesign)
}

extension ShapeSpec: Decodable {
    private enum Kind: String, Decodable {
        case rect, path, text
    }

    private enum CodingKeys: String, CodingKey {
        case type, cornerRadius, d, viewBox, text, weight, design
    }

    init(from decoder: any Decoder) throws {
        if let name = try? decoder.singleValueContainer().decode(String.self) {
            switch name {
            case "capsule": self = .capsule
            case "circle": self = .circle
            case "rect": self = .rect(cornerRadius: 0)
            default:
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath, debugDescription: "unknown shape \"\(name)\""))
            }
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(Kind.self, forKey: .type) {
        case .rect:
            self = .rect(cornerRadius: try container.decode(Length.self, forKey: .cornerRadius).value)
        case .path:
            self = .path(try Self.svgPath(in: container), viewBox: try Self.viewBox(in: container))
        case .text:
            self = .text(
                try container.decode(String.self, forKey: .text),
                weight: try container.decodeIfPresent(NodeFontWeight.self, forKey: .weight) ?? .regular,
                design: try container.decodeIfPresent(NodeFontDesign.self, forKey: .design) ?? .default)
        }
    }

    private static func svgPath(in container: KeyedDecodingContainer<CodingKeys>) throws -> SVGPath {
        let data = try container.decode(String.self, forKey: .d)
        do {
            return try SVGPath(data)
        } catch let error as SVGPathError {
            throw DecodingError.dataCorruptedError(forKey: .d, in: container, debugDescription: "SVG path: \(error.message)")
        }
    }

    private static func viewBox(in container: KeyedDecodingContainer<CodingKeys>) throws -> CGSize? {
        guard let values = try container.decodeIfPresent([Length].self, forKey: .viewBox)?.map(\.value) else { return nil }
        guard values.count == 2, values[0] > 0, values[1] > 0 else {
            throw DecodingError.dataCorruptedError(
                forKey: .viewBox, in: container, debugDescription: "expected [width, height] with positive numbers")
        }
        return CGSize(width: values[0], height: values[1])
    }
}

struct GlassSpec: Equatable, Sendable {
    var style: GlassStyle = .regular
    var tint: ColorSpec?
    var interactive = false
    var shape: ShapeSpec = .capsule
    var morphId: String?
    var union: String?
}

extension GlassSpec: Decodable {
    private enum CodingKeys: String, CodingKey {
        case style, tint, interactive, shape, morphId, union
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        style = try container.decodeIfPresent(GlassStyle.self, forKey: .style) ?? .regular
        tint = try container.decodeIfPresent(ColorSpec.self, forKey: .tint)
        interactive = try container.decodeIfPresent(Bool.self, forKey: .interactive) ?? false
        shape = try container.decodeIfPresent(ShapeSpec.self, forKey: .shape) ?? .capsule
        morphId = try container.decodeIfPresent(String.self, forKey: .morphId)
        union = try container.decodeIfPresent(String.self, forKey: .union)
    }
}

/// `background`: a colour, or a colour inside a shape.
struct BackgroundSpec: Decodable, Equatable, Sendable {
    var color: ColorSpec
    var shape: ShapeSpec

    private enum CodingKeys: String, CodingKey {
        case color, shape
    }

    init(from decoder: any Decoder) throws {
        if (try? decoder.singleValueContainer().decode(String.self)) != nil {
            color = try ColorSpec(from: decoder)
            shape = .rect(cornerRadius: 0)
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        color = try container.decode(ColorSpec.self, forKey: .color)
        shape = try container.decodeIfPresent(ShapeSpec.self, forKey: .shape) ?? .rect(cornerRadius: 0)
    }
}

/// The modifiers every node accepts (`NodeBase` minus `id`).
struct NodeModifiers: Equatable, Sendable {
    var padding: InsetsSpec?
    var frame: FrameSpec?
    var glass: GlassSpec?
    var background: BackgroundSpec?
    var foreground: ColorSpec?
    var font: FontSpec?
    var opacity: Double?
    var hidden = false
    var disabled = false
    var help: String?
    var accessibilityLabel: String?
}

extension NodeModifiers: Decodable {
    private enum CodingKeys: String, CodingKey {
        case padding, frame, glass, background, foreground, font, opacity, hidden, disabled, help, accessibilityLabel
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        padding = try container.decodeIfPresent(InsetsSpec.self, forKey: .padding)
        frame = try container.decodeIfPresent(FrameSpec.self, forKey: .frame)
        // `true` is regular glass in a capsule, `false` is no glass.
        if let enabled = try? container.decode(Bool.self, forKey: .glass) {
            glass = enabled ? GlassSpec() : nil
        } else {
            glass = try container.decodeIfPresent(GlassSpec.self, forKey: .glass)
        }
        background = try container.decodeIfPresent(BackgroundSpec.self, forKey: .background)
        foreground = try container.decodeIfPresent(ColorSpec.self, forKey: .foreground)
        font = try container.decodeIfPresent(FontSpec.self, forKey: .font)
        opacity = try container.decodeIfPresent(Double.self, forKey: .opacity)
        hidden = try container.decodeIfPresent(Bool.self, forKey: .hidden) ?? false
        disabled = try container.decodeIfPresent(Bool.self, forKey: .disabled) ?? false
        help = try container.decodeIfPresent(String.self, forKey: .help)
        accessibilityLabel = try container.decodeIfPresent(String.self, forKey: .accessibilityLabel)
    }
}
