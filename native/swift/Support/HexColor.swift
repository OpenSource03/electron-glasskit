import AppKit

/// Parses the colour strings the JavaScript side sends: `#RGB`, `#RRGGBB` or `#RRGGBBAA`.
enum HexColor {
    /// sRGB components in 0...1.
    struct Components: Equatable, Sendable {
        var red: Double
        var green: Double
        var blue: Double
        var alpha: Double
    }

    static func components(_ string: String) -> Components? {
        guard string.hasPrefix("#") else { return nil }
        var digits: [Double] = []
        for character in string.dropFirst() {
            guard character.isASCII, let digit = character.hexDigitValue else { return nil }
            digits.append(Double(digit))
        }
        switch digits.count {
        case 3:
            // Each digit stands for a doubled pair: 0xF -> 0xFF.
            return Components(red: digits[0] / 15, green: digits[1] / 15, blue: digits[2] / 15, alpha: 1)
        case 6, 8:
            let channels = stride(from: 0, to: digits.count, by: 2).map { (digits[$0] * 16 + digits[$0 + 1]) / 255 }
            return Components(red: channels[0], green: channels[1], blue: channels[2], alpha: digits.count == 8 ? channels[3] : 1)
        default:
            return nil
        }
    }

    static func parse(_ string: String) -> NSColor? {
        components(string).map {
            NSColor(srgbRed: $0.red, green: $0.green, blue: $0.blue, alpha: $0.alpha)
        }
    }
}
