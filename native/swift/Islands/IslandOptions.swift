import AppKit
import SwiftUI

enum IslandAppearance: String, Decodable, Sendable {
    case auto, light, dark

    /// Nil follows the window.
    @MainActor var appKit: NSAppearance? {
        switch self {
        case .auto: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

/// The options an island is created with.
struct IslandOptions: Decodable {
    var content: Node
    var fit: IslandFit?
    var passthrough: Bool?
    var appearance: IslandAppearance?
}

/// Any subset of the options that can change after creation.
struct IslandOptionsUpdate: Decodable {
    var fit: IslandFit?
    var passthrough: Bool?
    var appearance: IslandAppearance?
}

/// `IslandAnimation` in `nodes.ts`.
enum IslandAnimation: Equatable, Sendable {
    case none
    case standard
    case smooth
    case snappy
    case bouncy
    case spring(duration: Double?, bounce: Double?)
    case easeInOut(duration: Double?)
}

extension IslandAnimation: Decodable {
    private enum Kind: String, Decodable {
        case spring, easeInOut
    }

    private enum CodingKeys: String, CodingKey {
        case type, duration, bounce
    }

    init(from decoder: any Decoder) throws {
        if let name = try? decoder.singleValueContainer().decode(String.self) {
            switch name {
            case "none": self = .none
            case "default": self = .standard
            case "smooth": self = .smooth
            case "snappy": self = .snappy
            case "bouncy": self = .bouncy
            default:
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath, debugDescription: "unknown animation \"\(name)\""))
            }
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let duration = try container.decodeIfPresent(Double.self, forKey: .duration)
        switch try container.decode(Kind.self, forKey: .type) {
        case .spring: self = .spring(duration: duration, bounce: try container.decodeIfPresent(Double.self, forKey: .bounce))
        case .easeInOut: self = .easeInOut(duration: duration)
        }
    }
}

@available(macOS 14.0, *)
extension IslandAnimation {
    /// The transaction a content change runs in. `none` also silences implicit animations.
    var transaction: Transaction {
        var transaction = Transaction(animation: animation)
        transaction.disablesAnimations = animation == nil
        return transaction
    }

    private var animation: Animation? {
        switch self {
        case .none: nil
        case .standard: .default
        case .smooth: .smooth
        case .snappy: .snappy
        case .bouncy: .bouncy
        case .spring(let duration, let bounce): .spring(duration: duration ?? 0.5, bounce: bounce ?? 0)
        case .easeInOut(let duration): duration.map { .easeInOut(duration: $0) } ?? .easeInOut
        }
    }
}
