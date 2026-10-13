import CoreGraphics
import Foundation

struct SVGPathError: LocalizedError, Equatable {
    let message: String

    var errorDescription: String? { message }
}

/// SVG path data (the `d` attribute) reduced to absolute moves, lines and Bézier curves.
struct SVGPath: Equatable, Sendable {
    enum Element: Equatable, Sendable {
        case move(to: CGPoint)
        case line(to: CGPoint)
        case quad(to: CGPoint, control: CGPoint)
        case curve(to: CGPoint, control1: CGPoint, control2: CGPoint)
        case close
    }

    let elements: [Element]

    init(_ data: String) throws {
        var scanner = PathScanner(data)
        var builder = PathBuilder()
        var command: UInt8?

        while let byte = scanner.peekPastWhitespace() {
            if PathScanner.isLetter(byte) {
                guard Self.commands.contains(byte) else {
                    throw scanner.error("unknown command \"\(Character(UnicodeScalar(byte)))\"")
                }
                guard command != nil || byte | 0x20 == UInt8(ascii: "m") else {
                    throw scanner.error("path data must start with M or m")
                }
                scanner.advance()
                command = byte
                if byte | 0x20 == UInt8(ascii: "z") {
                    builder.close()
                    continue
                }
            }
            guard let current = command else {
                throw scanner.error("path data must start with M or m")
            }
            guard current | 0x20 != UInt8(ascii: "z") else {
                throw scanner.error("expected a command after Z")
            }
            try Self.apply(current, scanner: &scanner, builder: &builder)
            // Coordinate pairs after the first of a moveto are implicit linetos.
            if current == UInt8(ascii: "M") {
                command = UInt8(ascii: "L")
            } else if current == UInt8(ascii: "m") {
                command = UInt8(ascii: "l")
            }
        }
        elements = builder.elements
    }

    var cgPath: CGPath {
        let path = CGMutablePath()
        for element in elements {
            switch element {
            case .move(let point): path.move(to: point)
            case .line(let point): path.addLine(to: point)
            case .quad(let point, let control): path.addQuadCurve(to: point, control: control)
            case .curve(let point, let control1, let control2): path.addCurve(to: point, control1: control1, control2: control2)
            case .close: path.closeSubpath()
            }
        }
        return path
    }

    private static let commands = Set("MmLlHhVvCcSsQqTtAaZz".utf8)

    /// Reads one argument set for `command` and appends the segment it describes.
    private static func apply(_ command: UInt8, scanner: inout PathScanner, builder: inout PathBuilder) throws {
        let relative = command >= UInt8(ascii: "a")
        let origin = relative ? builder.current : .zero
        func point() throws -> CGPoint {
            let x = try scanner.number()
            let y = try scanner.number()
            return CGPoint(x: origin.x + x, y: origin.y + y)
        }

        switch command | 0x20 {
        case UInt8(ascii: "m"):
            builder.move(to: try point())
        case UInt8(ascii: "l"):
            builder.line(to: try point())
        case UInt8(ascii: "h"):
            builder.line(to: CGPoint(x: origin.x + (try scanner.number()), y: builder.current.y))
        case UInt8(ascii: "v"):
            builder.line(to: CGPoint(x: builder.current.x, y: origin.y + (try scanner.number())))
        case UInt8(ascii: "c"):
            let control1 = try point()
            let control2 = try point()
            builder.curve(to: try point(), control1: control1, control2: control2)
        case UInt8(ascii: "s"):
            let control1 = builder.reflectedCubicControl
            let control2 = try point()
            builder.curve(to: try point(), control1: control1, control2: control2)
        case UInt8(ascii: "q"):
            let control = try point()
            builder.quad(to: try point(), control: control)
        case UInt8(ascii: "t"):
            let control = builder.reflectedQuadControl
            builder.quad(to: try point(), control: control)
        default:
            let radiusX = try scanner.number()
            let radiusY = try scanner.number()
            let rotation = try scanner.number()
            let largeArc = try scanner.flag()
            let sweep = try scanner.flag()
            builder.arc(
                to: try point(), radiusX: radiusX, radiusY: radiusY,
                rotation: rotation * .pi / 180, largeArc: largeArc, sweep: sweep)
        }
    }
}

// MARK: - Scanning

private struct PathScanner {
    private let bytes: [UInt8]
    private var index = 0

    init(_ string: String) {
        bytes = Array(string.utf8)
    }

    static func isLetter(_ byte: UInt8) -> Bool {
        (UInt8(ascii: "a")...UInt8(ascii: "z")).contains(byte | 0x20)
    }

    func error(_ problem: String) -> SVGPathError {
        SVGPathError(message: "\(problem) at offset \(index)")
    }

    mutating func advance() {
        index += 1
    }

    mutating func peekPastWhitespace() -> UInt8? {
        skipWhitespace()
        return peek
    }

    mutating func number() throws -> CGFloat {
        skipSeparators()
        let start = index
        if peek == UInt8(ascii: "+") || peek == UInt8(ascii: "-") {
            index += 1
        }
        var digits = skipDigits()
        if peek == UInt8(ascii: ".") {
            index += 1
            digits += skipDigits()
        }
        guard digits > 0 else {
            index = start
            throw error("expected a number")
        }
        skipExponent()
        guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)), abs(value) <= Self.limit else {
            index = start
            throw error("number out of range")
        }
        return value
    }

    /// Far beyond any real drawing, and small enough that the arc arithmetic cannot overflow.
    private static let limit = 1e9

    /// Arc flags are a single `0` or `1` and may run straight into the next number.
    mutating func flag() throws -> Bool {
        skipSeparators()
        guard let byte = peek, byte == UInt8(ascii: "0") || byte == UInt8(ascii: "1") else {
            throw error("expected an arc flag (0 or 1)")
        }
        index += 1
        return byte == UInt8(ascii: "1")
    }

    private var peek: UInt8? {
        index < bytes.count ? bytes[index] : nil
    }

    private mutating func skipWhitespace() {
        while let byte = peek, byte == 0x20 || (0x09...0x0D).contains(byte) {
            index += 1
        }
    }

    private mutating func skipSeparators() {
        skipWhitespace()
        if peek == UInt8(ascii: ",") {
            index += 1
            skipWhitespace()
        }
    }

    private mutating func skipDigits() -> Int {
        let start = index
        while let byte = peek, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) {
            index += 1
        }
        return index - start
    }

    /// Consumes `e`, an optional sign and digits, but only when digits really follow.
    private mutating func skipExponent() {
        guard let byte = peek, byte | 0x20 == UInt8(ascii: "e") else { return }
        let start = index
        index += 1
        if peek == UInt8(ascii: "+") || peek == UInt8(ascii: "-") {
            index += 1
        }
        if skipDigits() == 0 {
            index = start
        }
    }
}

// MARK: - Building

private struct PathBuilder {
    private(set) var elements: [SVGPath.Element] = []
    private(set) var current = CGPoint.zero
    private var subpathStart = CGPoint.zero
    // Kept only while the previous segment was a curve of the matching kind.
    private var cubicControl: CGPoint?
    private var quadControl: CGPoint?

    var reflectedCubicControl: CGPoint {
        reflected(cubicControl)
    }

    var reflectedQuadControl: CGPoint {
        reflected(quadControl)
    }

    mutating func move(to point: CGPoint) {
        append(.move(to: point), endingAt: point)
        subpathStart = point
    }

    mutating func line(to point: CGPoint) {
        append(.line(to: point), endingAt: point)
    }

    mutating func quad(to point: CGPoint, control: CGPoint) {
        append(.quad(to: point, control: control), endingAt: point)
        quadControl = control
    }

    mutating func curve(to point: CGPoint, control1: CGPoint, control2: CGPoint) {
        append(.curve(to: point, control1: control1, control2: control2), endingAt: point)
        cubicControl = control2
    }

    mutating func close() {
        append(.close, endingAt: subpathStart)
    }

    /// Endpoint arc to centre form (SVG 1.1 appendix F.6), drawn as cubic curves of at most a quarter turn.
    mutating func arc(to end: CGPoint, radiusX: CGFloat, radiusY: CGFloat, rotation: CGFloat, largeArc: Bool, sweep: Bool) {
        let start = current
        guard start != end else { return }
        var radiusX = abs(radiusX)
        var radiusY = abs(radiusY)
        guard radiusX > 0, radiusY > 0 else {
            line(to: end)
            return
        }

        let cosine = cos(rotation)
        let sine = sin(rotation)
        let halfX = (start.x - end.x) / 2
        let halfY = (start.y - end.y) / 2
        let x = cosine * halfX + sine * halfY
        let y = -sine * halfX + cosine * halfY

        // Radii too small to span the endpoints are scaled up until they just do.
        let overshoot = (x * x) / (radiusX * radiusX) + (y * y) / (radiusY * radiusY)
        if overshoot > 1 {
            radiusX *= overshoot.squareRoot()
            radiusY *= overshoot.squareRoot()
        }

        let spread = radiusX * radiusX * y * y + radiusY * radiusY * x * x
        // Endpoints or radii too close to zero for the arithmetic leave nothing to curve.
        guard spread > 0, spread.isFinite else {
            line(to: end)
            return
        }
        var factor = max(0, (radiusX * radiusX * radiusY * radiusY - spread) / spread).squareRoot()
        if largeArc == sweep {
            factor = -factor
        }
        let centerX = factor * radiusX * y / radiusY
        let centerY = -factor * radiusY * x / radiusX
        let center = CGPoint(
            x: cosine * centerX - sine * centerY + (start.x + end.x) / 2,
            y: sine * centerX + cosine * centerY + (start.y + end.y) / 2)

        let startAngle = atan2((y - centerY) / radiusY, (x - centerX) / radiusX)
        var delta = atan2((-y - centerY) / radiusY, (-x - centerX) / radiusX) - startAngle
        if sweep, delta < 0 {
            delta += 2 * .pi
        } else if !sweep, delta > 0 {
            delta -= 2 * .pi
        }
        guard center.x.isFinite, center.y.isFinite, delta.isFinite, delta != 0 else {
            line(to: end)
            return
        }

        func position(_ angle: CGFloat) -> CGPoint {
            let x = radiusX * cos(angle)
            let y = radiusY * sin(angle)
            return CGPoint(x: center.x + cosine * x - sine * y, y: center.y + sine * x + cosine * y)
        }
        func tangent(_ angle: CGFloat) -> CGVector {
            let dx = -radiusX * sin(angle)
            let dy = radiusY * cos(angle)
            return CGVector(dx: cosine * dx - sine * dy, dy: sine * dx + cosine * dy)
        }

        // `delta` is finite and within a full turn, so this is one to four quarter turns.
        let segments = Int(min(max((abs(delta) / (.pi / 2) - 1e-9).rounded(.up), 1), 4))
        let step = delta / CGFloat(segments)
        let handle = 4 / 3 * tan(step / 4)
        for segment in 0..<segments {
            let from = startAngle + step * CGFloat(segment)
            let to = from + step
            let fromPoint = position(from)
            // The last segment lands exactly on the requested endpoint.
            let toPoint = segment == segments - 1 ? end : position(to)
            let fromTangent = tangent(from)
            let toTangent = tangent(to)
            append(
                .curve(
                    to: toPoint,
                    control1: CGPoint(x: fromPoint.x + handle * fromTangent.dx, y: fromPoint.y + handle * fromTangent.dy),
                    control2: CGPoint(x: toPoint.x - handle * toTangent.dx, y: toPoint.y - handle * toTangent.dy)),
                endingAt: toPoint)
        }
    }

    private mutating func append(_ element: SVGPath.Element, endingAt point: CGPoint) {
        elements.append(element)
        current = point
        cubicControl = nil
        quadControl = nil
    }

    private func reflected(_ control: CGPoint?) -> CGPoint {
        guard let control else { return current }
        return CGPoint(x: 2 * current.x - control.x, y: 2 * current.y - control.y)
    }
}
