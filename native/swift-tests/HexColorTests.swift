import AppKit

@MainActor
func runHexColorTests() {
    Tests.run("hex: #RRGGBBAA, #RRGGBB and #RGB") {
        try expectEqual(HexColor.components("#FF000080"), HexColor.Components(red: 1, green: 0, blue: 0, alpha: 128.0 / 255))
        try expectEqual(HexColor.components("#00ff00"), HexColor.Components(red: 0, green: 1, blue: 0, alpha: 1))
        try expectEqual(HexColor.components("#336699"), HexColor.Components(red: 0.2, green: 0.4, blue: 0.6, alpha: 1))
        try expectEqual(HexColor.components("#369"), HexColor.components("#336699"))
        try expectEqual(HexColor.components("#FfF"), HexColor.Components(red: 1, green: 1, blue: 1, alpha: 1))
        try expectEqual(HexColor.components("#00000000"), HexColor.Components(red: 0, green: 0, blue: 0, alpha: 0))
    }

    Tests.run("hex: malformed strings") {
        for string in ["", "#", "FFF", "FF0000", "#FFFF", "#12345", "#1234567", "#123456789", "#GG0000", "#FF 000", "red", "#١٢٣"] {
            try expect(HexColor.components(string) == nil, "\"\(string)\" should not parse")
            try expect(HexColor.parse(string) == nil, "\"\(string)\" should not parse")
        }
    }

    Tests.run("hex: parse returns an sRGB colour") {
        guard let color = HexColor.parse("#33669980") else {
            throw ExpectationFailure(description: "\"#33669980\" should parse")
        }
        try expectEqual(color.colorSpace, .sRGB)
        try expectClose(color.redComponent, 0.2)
        try expectClose(color.greenComponent, 0.4)
        try expectClose(color.blueComponent, 0.6)
        try expectClose(color.alphaComponent, 128.0 / 255)
    }
}
