import AppKit
import CoreText
import SwiftUI

/// The SwiftUI shape for a `ShapeSpec`, used for fills, backgrounds and glass alike.
struct NodeShape: Shape {
    let spec: ShapeSpec

    func path(in rect: CGRect) -> Path {
        switch spec {
        case .capsule:
            Capsule(style: .continuous).path(in: rect)
        case .circle:
            Circle().path(in: rect)
        case .rect(let cornerRadius):
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).path(in: rect)
        case .path(let svg, let viewBox):
            Self.fit(svg.cgPath, box: viewBox.map { CGRect(origin: .zero, size: $0) }, in: rect, flipped: false)
        case .text(let text, let weight, let design):
            // CoreText outlines have their origin at the baseline with y pointing up.
            Self.fit(GlyphOutline.path(for: text, weight: weight, design: design), box: nil, in: rect, flipped: true)
        }
    }

    /// Scales `outline` uniformly so `box` (its own bounds when nil) sits centred inside `rect`.
    private static func fit(_ outline: CGPath, box: CGRect?, in rect: CGRect, flipped: Bool) -> Path {
        let box = box ?? outline.boundingBoxOfPath
        guard !box.isNull else { return Path() }
        // A flat outline (a straight line) only constrains one axis.
        var scales: [CGFloat] = []
        if box.width > 0 { scales.append(rect.width / box.width) }
        if box.height > 0 { scales.append(rect.height / box.height) }
        guard let scale = scales.min(), scale.isFinite else { return Path() }
        let vertical = flipped ? -scale : scale
        let transform = CGAffineTransform(translationX: rect.midX - box.midX * scale, y: rect.midY - box.midY * vertical)
            .scaledBy(x: scale, y: vertical)
        return Path(outline).applying(transform)
    }
}

enum GlyphOutline {
    // Outlines are scaled to fit afterwards, so the size only has to be large enough to avoid hinting.
    private static let pointSize: CGFloat = 200

    /// The outline of `text` set on one line in the system font.
    static func path(for text: String, weight: NodeFontWeight, design: NodeFontDesign) -> CGPath {
        let system = NSFont.systemFont(ofSize: pointSize, weight: weight.appKit)
        let font = system.fontDescriptor.withDesign(design.appKit).flatMap { NSFont(descriptor: $0, size: pointSize) } ?? system
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.font: font]))
        let outline = CGMutablePath()
        for run in CTLineGetGlyphRuns(line) as? [CTRun] ?? [] {
            // Font fallback can give a run a different font from the one requested.
            let attributes = CTRunGetAttributes(run) as? [NSAttributedString.Key: Any]
            let runFont = attributes?[.font] as? NSFont ?? font
            let count = CTRunGetGlyphCount(run)
            var glyphs = [CGGlyph](repeating: 0, count: count)
            var positions = [CGPoint](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
            CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
            for (glyph, position) in zip(glyphs, positions) {
                guard let glyphPath = CTFontCreatePathForGlyph(runFont, glyph, nil) else { continue }
                outline.addPath(glyphPath, transform: CGAffineTransform(translationX: position.x, y: position.y))
            }
        }
        return outline
    }
}

extension NodeFontWeight {
    var appKit: NSFont.Weight {
        switch self {
        case .ultraLight: .ultraLight
        case .thin: .thin
        case .light: .light
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        case .heavy: .heavy
        case .black: .black
        }
    }

    var swiftUI: Font.Weight {
        switch self {
        case .ultraLight: .ultraLight
        case .thin: .thin
        case .light: .light
        case .regular: .regular
        case .medium: .medium
        case .semibold: .semibold
        case .bold: .bold
        case .heavy: .heavy
        case .black: .black
        }
    }
}

extension NodeFontDesign {
    var appKit: NSFontDescriptor.SystemDesign {
        switch self {
        case .default: .default
        case .rounded: .rounded
        case .serif: .serif
        case .monospaced: .monospaced
        }
    }

    var swiftUI: Font.Design {
        switch self {
        case .default: .default
        case .rounded: .rounded
        case .serif: .serif
        case .monospaced: .monospaced
        }
    }
}
