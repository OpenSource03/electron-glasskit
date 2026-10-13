import CoreGraphics
import SwiftUI

private func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
    CGPoint(x: x, y: y)
}

private func elements(_ data: String) throws -> [SVGPath.Element] {
    try SVGPath(data).elements
}

private func endpoint(_ element: SVGPath.Element) -> CGPoint? {
    switch element {
    case .move(let point), .line(let point), .quad(let point, _), .curve(let point, _, _): point
    case .close: nil
    }
}

@MainActor
func runSVGPathTests() {
    Tests.run("svg: M and L, absolute and relative") {
        try expectEqual(try elements("M10 20 L30 40"), [.move(to: point(10, 20)), .line(to: point(30, 40))])
        try expectEqual(try elements("m10 20 l5 -5"), [.move(to: point(10, 20)), .line(to: point(15, 15))])
        try expectEqual(try elements("M1 1 m2 2"), [.move(to: point(1, 1)), .move(to: point(3, 3))])
        try expectEqual(try elements(""), [])
        try expectEqual(try elements(" \n\t "), [])
    }

    Tests.run("svg: H and V, absolute and relative") {
        try expectEqual(
            try elements("M1 2 H10 V20 h-4 v-5"),
            [
                .move(to: point(1, 2)), .line(to: point(10, 2)), .line(to: point(10, 20)),
                .line(to: point(6, 20)), .line(to: point(6, 15)),
            ])
    }

    Tests.run("svg: C and S with reflected control points") {
        try expectEqual(
            try elements("M0 0 C0 10 10 10 10 0 S20 -10 20 0"),
            [
                .move(to: .zero),
                .curve(to: point(10, 0), control1: point(0, 10), control2: point(10, 10)),
                .curve(to: point(20, 0), control1: point(10, -10), control2: point(20, -10)),
            ])
        try expectEqual(
            try elements("M5 5 c0 10 10 10 10 0 s10 -10 10 0"),
            [
                .move(to: point(5, 5)),
                .curve(to: point(15, 5), control1: point(5, 15), control2: point(15, 15)),
                .curve(to: point(25, 5), control1: point(15, -5), control2: point(25, -5)),
            ])
        // Without a preceding cubic, the first control point is the current point.
        try expectEqual(
            try elements("M1 1 L2 2 S4 4 6 2")[2],
            .curve(to: point(6, 2), control1: point(2, 2), control2: point(4, 4)))
    }

    Tests.run("svg: Q and T with reflected control points") {
        try expectEqual(
            try elements("M0 0 Q5 10 10 0 T20 0"),
            [
                .move(to: .zero),
                .quad(to: point(10, 0), control: point(5, 10)),
                .quad(to: point(20, 0), control: point(15, -10)),
            ])
        try expectEqual(
            try elements("M5 5 q5 10 10 0 t10 0"),
            [
                .move(to: point(5, 5)),
                .quad(to: point(15, 5), control: point(10, 15)),
                .quad(to: point(25, 5), control: point(20, -5)),
            ])
        // A cubic in between breaks the chain, so T falls back to the current point.
        try expectEqual(
            try elements("M0 0 Q5 10 10 0 C10 0 10 0 12 0 T20 0")[3],
            .quad(to: point(20, 0), control: point(12, 0)))
    }

    Tests.run("svg: Z returns to the start of the subpath") {
        try expectEqual(
            try elements("M10 10 L20 10 Z l5 5 z"),
            [.move(to: point(10, 10)), .line(to: point(20, 10)), .close, .line(to: point(15, 15)), .close])
        try expectEqual(try elements("M1 1zM5 5Z").count, 4)
    }

    Tests.run("svg: implicit repeated commands") {
        try expectEqual(
            try elements("M0 0 10 10 20 20"),
            [.move(to: .zero), .line(to: point(10, 10)), .line(to: point(20, 20))])
        try expectEqual(
            try elements("m1 1 2 2 3 3"),
            [.move(to: point(1, 1)), .line(to: point(3, 3)), .line(to: point(6, 6))])
        try expectEqual(try elements("M0 0 L1 1 2 2").count, 3)
        try expectEqual(
            try elements("M0 0 h1 2 3"),
            [.move(to: .zero), .line(to: point(1, 0)), .line(to: point(3, 0)), .line(to: point(6, 0))])
        try expectEqual(try elements("M0 0 Q1 1 2 0 3 1 4 0").count, 3)
        try expectEqual(try elements("M0 0 C1 1 2 1 3 0 4 -1 5 -1 6 0").count, 3)
        try expectEqual(try elements("M0 0 A5 5 0 0 1 10 0 5 5 0 0 1 20 0").count, 5)
    }

    Tests.run("svg: compact number forms") {
        try expectEqual(try elements("M1e-3.5.5-1"), [.move(to: point(0.001, 0.5)), .line(to: point(0.5, -1))])
        try expectEqual(try elements("M-1-2L3E2+4"), [.move(to: point(-1, -2)), .line(to: point(300, 4))])
        try expectEqual(try elements("M.5.5"), [.move(to: point(0.5, 0.5))])
        try expectEqual(try elements("M1.5.5"), [.move(to: point(1.5, 0.5))])
        try expectEqual(try elements("M1.,2."), [.move(to: point(1, 2))])
        try expectEqual(try elements("M1e2,1E+1"), [.move(to: point(100, 10))])
        try expectEqual(try elements("M 1 , 2\n,3\t4"), [.move(to: point(1, 2)), .line(to: point(3, 4))])
        try expectEqual(try elements("M0 0L10-10-20+5"), [.move(to: .zero), .line(to: point(10, -10)), .line(to: point(-20, 5))])
    }

    Tests.run("svg: arcs become curves that stay on the ellipse") {
        let half = try SVGPath("M0 0 A10 10 0 0 1 20 0")
        try expectEqual(half.elements.count, 3)
        try expectClose(half.cgPath.boundingBoxOfPath, CGRect(x: 0, y: -10, width: 20, height: 10), tolerance: 0.01)
        try expectEqual(endpoint(half.elements[2]), point(20, 0))

        let other = try SVGPath("M0 0 A10 10 0 0 0 20 0")
        try expectClose(other.cgPath.boundingBoxOfPath, CGRect(x: 0, y: 0, width: 20, height: 10), tolerance: 0.01)

        // Start (0,0) to end (10,10) with radius 10 has centres (10,0) and (0,10).
        let centres = ["0 0": point(10, 0), "0 1": point(0, 10), "1 0": point(0, 10), "1 1": point(10, 0)]
        for (flags, centre) in centres {
            let arc = try SVGPath("M0 0 A10 10 0 \(flags) 10 10")
            try expectEqual(arc.elements.count - 1, flags.hasPrefix("1") ? 3 : 1)
            for end in arc.elements.compactMap(endpoint) {
                try expectClose(hypot(end.x - centre.x, end.y - centre.y), 10, tolerance: 1e-9)
            }
            try expectEqual(arc.elements.last.flatMap(endpoint), point(10, 10))
        }

        let relative = try SVGPath("M5 5 a10 10 0 0 1 20 0")
        try expectClose(relative.cgPath.boundingBoxOfPath, CGRect(x: 5, y: -5, width: 20, height: 10), tolerance: 0.01)
    }

    Tests.run("svg: arc flags packed without separators") {
        let spaced = try elements("M0 0 a10 10 0 0 1 20 0")
        try expectEqual(try elements("M0 0a10 10 0 0120 0"), spaced)
        try expectEqual(try elements("M0 0a10,10,0,01,20,0"), spaced)
        try expectEqual(try elements("M0 0a10 10 0 01.5.5"), try elements("M0 0 a10 10 0 0 1 0.5 0.5"))
        try expectEqual(try elements("M0 0a10 10 0 1120 0"), try elements("M0 0 a10 10 0 1 1 20 0"))
        try expectEqual(try elements("M0 0A10 10 0 10-20 0"), try elements("M0 0 A10 10 0 1 0 -20 0"))
    }

    Tests.run("svg: arc edge cases") {
        try expectEqual(try elements("M0 0 A0 10 0 0 1 20 0"), [.move(to: .zero), .line(to: point(20, 0))])
        try expectEqual(try elements("M3 3 A10 10 0 0 1 3 3"), [.move(to: point(3, 3))])
        // Radii too small to reach are scaled up to a half circle.
        let scaled = try SVGPath("M0 0 A1 1 0 0 1 20 0")
        try expectClose(scaled.cgPath.boundingBoxOfPath, CGRect(x: 0, y: -10, width: 20, height: 10), tolerance: 0.01)
        // Negative radii count as positive.
        try expectEqual(try elements("M0 0 A-10 -10 0 0 1 20 0"), try elements("M0 0 A10 10 0 0 1 20 0"))
        // Rotated a quarter turn, the 20 radius runs along y.
        let rotated = try SVGPath("M0 0 A20 10 90 0 1 20 0")
        try expectClose(rotated.cgPath.boundingBoxOfPath, CGRect(x: 0, y: -20, width: 20, height: 20), tolerance: 0.02)
    }

    Tests.run("svg: malformed input") {
        let cases = [
            ("L1 1", "must start with M"),
            ("10 10", "must start with M"),
            ("Z", "must start with M"),
            ("M1", "expected a number at offset 2"),
            ("M1 2 L", "expected a number"),
            ("M1 2 L3", "expected a number"),
            ("M1 2 X3 4", "unknown command \"X\" at offset 5"),
            ("M1 2 L3 #", "expected a number"),
            ("M0,0L1,,2", "expected a number"),
            ("M0 0,", "expected a number"),
            ("M0 0 Z 1 1", "expected a command after Z"),
            ("M0 0 A1 1 0 2 1 5 5", "expected an arc flag"),
            ("M0 0 A1 1 0 0", "expected an arc flag"),
            ("M1e400 0", "number out of range"),
            ("M- 1", "expected a number"),
            ("M. 1", "expected a number"),
            ("M1e 2", "expected a number at offset 2"),
        ]
        for (data, problem) in cases {
            try expectError(containing: problem) { _ = try SVGPath(data) }
        }
    }

    Tests.run("svg: degenerate arcs become lines instead of trapping") {
        let degenerate = [
            "M0 0 A1 1 0 0 0 1e-200 0",
            "M0 0 A1e-200 1e-200 0 0 1 10 0",
            "M0 0 A1e-320 5 0 0 1 10 0",
            "M0 0 A5e-324 5e-324 0 1 1 5e-324 5e-324",
            "M0 0 A1 1 0 0 0 0 1e-170",
            "M1e-160 1e-160 A1e9 1e9 45 1 1 2e-160 1e-160",
        ]
        for data in degenerate {
            let elements = try SVGPath(data).elements
            try expectEqual(elements.count, 2)
            guard case .line = elements[1] else {
                throw ExpectationFailure(description: "\"\(data)\" should end in a straight line, got \(elements[1])")
            }
        }
    }

    Tests.run("svg: extreme arcs stay finite") {
        let radii = ["1e-200", "1e-9", "1", "1e9"]
        let ends = ["1e-200 0", "1e-9 1e-9", "3 4", "1e9 -1e9", "-1e9 1e9"]
        for radiusX in radii {
            for radiusY in radii {
                for end in ends {
                    for flags in ["0 0", "0 1", "1 0", "1 1"] {
                        let data = "M1e9 -1e9 A\(radiusX) \(radiusY) 1e9 \(flags) \(end)"
                        let path = try SVGPath(data)
                        try expect((1...5).contains(path.elements.count), "\"\(data)\" gave \(path.elements.count) elements")
                        let box = path.cgPath.boundingBox
                        try expect(
                            [box.minX, box.minY, box.maxX, box.maxY].allSatisfy(\.isFinite), "\"\(data)\" is not finite: \(box)")
                    }
                }
            }
        }
        // Coincident endpoints draw nothing, whatever the radii.
        try expectEqual(try elements("M1e9 1e9 A1e-200 1e9 0 1 1 1e9 1e9").count, 1)
    }

    Tests.run("svg: numbers beyond any drawing are refused") {
        for data in ["M1e300 0", "M0 0 L0 -1e10", "M0 0 A1e300 1 0 0 1 5 5", "M0 0 A1 1 1e300 0 1 5 5", "M0 0 h1e308", "M1e400 0"] {
            try expectError(containing: "number out of range") { _ = try SVGPath(data) }
        }
        for data in ["Minf 0", "M0 0 Linfinity 0", "Mnan 0", "M0 0 LNaN 0", "M0 0 A nan 1 0 0 1 5 5", "M0x10 0"] {
            try expectError { _ = try SVGPath(data) }
        }
        try expectEqual(try elements("M1e9 -1e9"), [.move(to: point(1e9, -1e9))])
        try expectEqual(try elements("M1e-400 5e-324"), [.move(to: point(0, 5e-324))])
    }

    Tests.run("svg: thousands of commands, and shapes built from extreme paths") {
        let long = try SVGPath("M0 0" + String(repeating: " l1e9 1e9 a5 5 0 0 1 3 4 q1 1 2 0 z", count: 5000))
        try expectEqual(long.elements.count, 1 + 5000 * 4)
        let rect = CGRect(x: 0, y: 0, width: 100, height: 50)
        let shapes = [
            "M0 0 L5e-324 0", "M0 0 L1e-300 1e-300 L0 1e-300 Z", "M-1e9 -1e9 L1e9 1e9", "M0 0 A1 1 0 0 0 1e-200 0",
            "M1e9 1e9 a1e-9 1e-9 0 1 1 1e-9 0",
        ]
        for data in shapes {
            let box = NodeShape(spec: .path(try SVGPath(data), viewBox: nil)).path(in: rect).boundingRect
            try expect(
                box.isNull || [box.minX, box.minY, box.maxX, box.maxY].allSatisfy(\.isFinite), "\"\(data)\" is not finite: \(box)")
        }
        try expect(NodeShape(spec: .path(long, viewBox: nil)).path(in: rect).boundingRect.width <= 100.001, "fits its rect")
    }

    Tests.run("shapes: a path scales uniformly and is centred") {
        let square = try SVGPath("M10 10 H20 V20 H10 Z")
        let rect = CGRect(x: 0, y: 0, width: 100, height: 50)
        try expectClose(
            NodeShape(spec: .path(square, viewBox: nil)).path(in: rect).boundingRect,
            CGRect(x: 25, y: 0, width: 50, height: 50))
        // With a 40 x 40 view box the square keeps its place inside that box.
        try expectClose(
            NodeShape(spec: .path(square, viewBox: CGSize(width: 40, height: 40))).path(in: rect).boundingRect,
            CGRect(x: 37.5, y: 12.5, width: 12.5, height: 12.5))
        let line = try SVGPath("M0 0 H10")
        try expectClose(
            NodeShape(spec: .path(line, viewBox: nil)).path(in: rect).boundingRect,
            CGRect(x: 0, y: 25, width: 100, height: 0))
        try expect(NodeShape(spec: .path(try SVGPath(""), viewBox: nil)).path(in: rect).isEmpty, "an empty path stays empty")
    }

    Tests.run("shapes: text outlines fit their rect") {
        let rect = CGRect(x: 10, y: 20, width: 200, height: 60)
        let bounds = NodeShape(spec: .text("Glass", weight: .black, design: .rounded)).path(in: rect).boundingRect
        try expect(bounds.width > 0 && bounds.height > 0, "the outline has no area")
        try expect(rect.insetBy(dx: -0.01, dy: -0.01).contains(bounds), "\(bounds) is outside \(rect)")
        try expect(
            abs(bounds.width - rect.width) < 0.01 || abs(bounds.height - rect.height) < 0.01,
            "\(bounds) touches neither axis of \(rect)")
        try expectClose(bounds.midX, rect.midX, tolerance: 0.01)
        try expectClose(bounds.midY, rect.midY, tolerance: 0.01)
        try expect(NodeShape(spec: .text("", weight: .regular, design: .default)).path(in: rect).isEmpty, "no text, no outline")

        // Glyphs come out upright: the dot of an "i" is above its stem.
        let glyph = NodeShape(spec: .text("i", weight: .regular, design: .default)).path(in: CGRect(x: 0, y: 0, width: 100, height: 100))
        try expect(glyph.contains(CGPoint(x: 50, y: 7)) && glyph.contains(CGPoint(x: 50, y: 70)), "dot and stem")
        try expect(!glyph.contains(CGPoint(x: 50, y: 22)), "the gap under the dot sits near the top")
    }

    Tests.run("shapes: capsule, circle and rect") {
        let rect = CGRect(x: 0, y: 0, width: 100, height: 40)
        try expectClose(NodeShape(spec: .capsule).path(in: rect).boundingRect, rect)
        try expectClose(NodeShape(spec: .circle).path(in: rect).boundingRect, CGRect(x: 30, y: 0, width: 40, height: 40))
        try expectClose(NodeShape(spec: .rect(cornerRadius: 8)).path(in: rect).boundingRect, rect)
        try expect(NodeShape(spec: .rect(cornerRadius: 0)).path(in: rect).contains(CGPoint(x: 1, y: 1)), "square corner")
        try expect(!NodeShape(spec: .rect(cornerRadius: 12)).path(in: rect).contains(CGPoint(x: 1, y: 1)), "round corner")
    }
}
