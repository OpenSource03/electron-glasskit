import AppKit

/// A JSON key that may be missing, explicitly null, or hold a value.
enum Patch<Value: Decodable> {
    case absent
    case null
    case value(Value)
}

extension KeyedDecodingContainer {
    func patch<Value: Decodable>(_ type: Value.Type, forKey key: Key) throws -> Patch<Value> {
        guard contains(key) else { return .absent }
        if try decodeNil(forKey: key) { return .null }
        return .value(try decode(type, forKey: key))
    }
}

struct FrameOptions: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.size.width
        height = rect.size.height
    }

    /// AppKit raises on geometry it cannot represent, so the size never goes below zero.
    var rect: CGRect { CGRect(x: x, y: y, width: max(0, width), height: max(0, height)) }
}

enum StyleOption: String, Decodable {
    case regular
    case clear
}

enum AppearanceOption: String, Decodable {
    case auto
    case light
    case dark

    var appearance: NSAppearance? {
        switch self {
        case .auto: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

/// The keys of `GlassMaterial` in types.ts. Every key is optional so one type serves create and update.
struct MaterialPatch: Decodable {
    var style: StyleOption?
    var tint: Patch<String>
    var appearance: AppearanceOption?
    var variant: Int?
    var scrim: Bool?
    var subdued: Bool?

    private enum CodingKeys: String, CodingKey {
        case style, tint, appearance
        case variant = "unstable_variant"
        case scrim = "unstable_scrim"
        case subdued = "unstable_subdued"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        style = try container.decodeIfPresent(StyleOption.self, forKey: .style)
        tint = try container.patch(String.self, forKey: .tint)
        appearance = try container.decodeIfPresent(AppearanceOption.self, forKey: .appearance)
        variant = try container.decodeIfPresent(Int.self, forKey: .variant)
        scrim = try container.decodeIfPresent(Bool.self, forKey: .scrim)
        subdued = try container.decodeIfPresent(Bool.self, forKey: .subdued)
    }
}

struct RegionPatch: Decodable {
    var frame: FrameOptions?
    var cornerRadius: Double?
    var interactive: Bool?
    var passthrough: Bool?
    var zIndex: Int?
    var hidden: Bool?
    var material: MaterialPatch

    private enum CodingKeys: String, CodingKey {
        case frame, cornerRadius, interactive, passthrough, zIndex, hidden
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        frame = try container.decodeIfPresent(FrameOptions.self, forKey: .frame)
        cornerRadius = try container.decodeIfPresent(Double.self, forKey: .cornerRadius)
        interactive = try container.decodeIfPresent(Bool.self, forKey: .interactive)
        passthrough = try container.decodeIfPresent(Bool.self, forKey: .passthrough)
        zIndex = try container.decodeIfPresent(Int.self, forKey: .zIndex)
        hidden = try container.decodeIfPresent(Bool.self, forKey: .hidden)
        material = try MaterialPatch(from: decoder)
    }
}

struct GroupPatch: Decodable {
    var spacing: Double?
    var zIndex: Int?
}

enum FallbackMaterial: String, Decodable {
    case underWindow, sidebar, hud, popover, menu, headerView, contentBackground, windowBackground

    var material: NSVisualEffectView.Material {
        switch self {
        case .underWindow: .underWindowBackground
        case .sidebar: .sidebar
        case .hud: .hudWindow
        case .popover: .popover
        case .menu: .menu
        case .headerView: .headerView
        case .contentBackground: .contentBackground
        case .windowBackground: .windowBackground
        }
    }
}

struct BackgroundPatch: Decodable {
    var cornerRadius: Double?
    var opaque: Bool?
    var fallbackMaterial: Patch<FallbackMaterial>
    var material: MaterialPatch

    private enum CodingKeys: String, CodingKey {
        case cornerRadius, opaque, fallbackMaterial
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        cornerRadius = try container.decodeIfPresent(Double.self, forKey: .cornerRadius)
        opaque = try container.decodeIfPresent(Bool.self, forKey: .opaque)
        fallbackMaterial = try container.patch(FallbackMaterial.self, forKey: .fallbackMaterial)
        material = try MaterialPatch(from: decoder)
    }
}

/// The island keys the host handles itself; the rest of the JSON goes to `IslandController`.
struct IslandPlacement: Decodable {
    var frame: FrameOptions?
    var zIndex: Int?
    var hidden: Bool?
}

struct GlassKitError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

func decodeOptions<Value: Decodable>(_ type: Value.Type, from json: Data, what: String) throws -> Value {
    do {
        return try JSONDecoder().decode(type, from: json)
    } catch let error as DecodingError {
        throw GlassKitError("Invalid \(what) options: \(describe(error))")
    }
}

private func describe(_ error: DecodingError) -> String {
    func path(_ context: DecodingError.Context) -> String {
        let keys = context.codingPath.map(\.stringValue).joined(separator: ".")
        return keys.isEmpty ? context.debugDescription : "\(keys): \(context.debugDescription)"
    }
    switch error {
    case .keyNotFound(let key, _): return "missing \"\(key.stringValue)\""
    case .typeMismatch(_, let context), .valueNotFound(_, let context), .dataCorrupted(let context): return path(context)
    @unknown default: return error.localizedDescription
    }
}
