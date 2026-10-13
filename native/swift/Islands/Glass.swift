import SwiftUI

// The only file that touches the Liquid Glass APIs. Before macOS 26 each piece falls back here.

/// Puts a node on glass, with the identity it morphs by and the union it merges into.
@available(macOS 14.0, *)
struct GlassSurface: ViewModifier {
    let spec: GlassSpec?
    let nodeID: String?
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if let spec {
            if #available(macOS 26.0, *) {
                content
                    .glassEffect(spec.glass, in: NodeShape(spec: spec.shape))
                    .glassEffectID(spec.morphId ?? nodeID, in: namespace)
                    .glassEffectUnion(id: spec.union, namespace: namespace)
            } else {
                content.background(.regularMaterial, in: NodeShape(spec: spec.shape))
            }
        } else {
            content
        }
    }
}

@available(macOS 26.0, *)
extension GlassSpec {
    var glass: Glass {
        var glass: Glass = style == .clear ? .clear : .regular
        if let tint {
            glass = glass.tint(tint.color)
        }
        return interactive ? glass.interactive() : glass
    }
}

/// Draws its glass children in one pass so they can merge and morph.
@available(macOS 14.0, *)
struct GlassGroup<Content: View>: View {
    let spacing: CGFloat
    @ViewBuilder let content: Content

    var body: some View {
        if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

@available(macOS 14.0, *)
struct ButtonLook: ViewModifier {
    let style: ButtonNode.Style

    func body(content: Content) -> some View {
        switch style {
        case .plain:
            content.buttonStyle(.plain)
        case .glass:
            if #available(macOS 26.0, *) {
                content.buttonStyle(.glass)
            } else {
                content.buttonStyle(.bordered)
            }
        case .glassProminent:
            if #available(macOS 26.0, *) {
                content.buttonStyle(.glassProminent)
            } else {
                content.buttonStyle(.borderedProminent)
            }
        }
    }
}
