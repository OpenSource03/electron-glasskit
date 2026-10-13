import SwiftUI

// `NodeBase` modifiers, applied in a fixed order: `NodeLayout` first, then `NodeDecoration`.

/// Font, foreground, padding and frame. Buttons and menus apply these to their label so the whole frame is clickable.
@available(macOS 14.0, *)
struct NodeLayout: ViewModifier {
    let modifiers: NodeModifiers

    func body(content: Content) -> some View {
        let frame = modifiers.frame
        let alignment = frame?.alignment?.swiftUI ?? .center
        // Every layout modifier measures its content again, which compounds with nesting depth,
        // so each one is only added when the node asks for it.
        content
            .inheritedFont(modifiers.font?.font)
            .optional(modifiers.foreground) { $0.foregroundStyle($1.color) }
            .optional(modifiers.padding) { $0.padding($1.edgeInsets) }
            .optional(frame?.fixed) { $0.frame(width: $1.width?.value, height: $1.height?.value, alignment: alignment) }
            .optional(frame?.flexible) {
                $0.frame(
                    minWidth: $1.minWidth?.value, maxWidth: $1.maxWidth?.value,
                    minHeight: $1.minHeight?.value, maxHeight: $1.maxHeight?.value,
                    alignment: alignment)
            }
    }
}

extension FrameSpec {
    /// The spec when it pins a width or height, otherwise nil.
    var fixed: FrameSpec? {
        width != nil || height != nil ? self : nil
    }

    /// The spec when it sets a minimum or maximum, otherwise nil.
    var flexible: FrameSpec? {
        minWidth != nil || maxWidth != nil || minHeight != nil || maxHeight != nil ? self : nil
    }
}

/// Background, glass, then visibility, enablement, tooltip and accessibility.
@available(macOS 14.0, *)
struct NodeDecoration: ViewModifier {
    let id: String?
    let modifiers: NodeModifiers
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        content
            .optional(modifiers.background) { content, background in
                content.background { NodeShape(spec: background.shape).fill(background.color.color) }
            }
            .modifier(GlassSurface(spec: modifiers.glass, nodeID: id, namespace: namespace))
            // A hidden node keeps its place in the layout, like SwiftUI's `hidden()`.
            .opacity(modifiers.hidden ? 0 : modifiers.opacity ?? 1)
            .allowsHitTesting(!modifiers.hidden)
            .accessibilityHidden(modifiers.hidden)
            .disabled(modifiers.disabled)
            .optional(modifiers.help) { $0.help($1) }
            .optional(modifiers.accessibilityLabel) { $0.accessibilityLabel($1) }
    }
}

@available(macOS 14.0, *)
extension View {
    /// Applies `transform` only when there is a value to apply it with.
    @ViewBuilder
    func optional<Value, Modified: View>(
        _ value: Value?, @ViewBuilder transform: (Self, Value) -> Modified
    ) -> some View {
        if let value {
            transform(self, value)
        } else {
            self
        }
    }

    /// Sets the font, or leaves the inherited one alone when `font` is nil.
    func inheritedFont(_ font: Font?) -> some View {
        transformEnvironment(\.font) { current in
            if let font {
                current = font
            }
        }
    }
}

extension ColorSpec {
    var color: Color {
        Color(.sRGB, red: components.red, green: components.green, blue: components.blue, opacity: components.alpha)
    }
}

extension FontSpec {
    var font: Font {
        .system(size: size?.value ?? 13, weight: (weight ?? .regular).swiftUI, design: (design ?? .default).swiftUI)
    }
}

extension InsetsSpec {
    var edgeInsets: EdgeInsets {
        EdgeInsets(top: top, leading: leading, bottom: bottom, trailing: trailing)
    }
}

extension NodeAlignment {
    var swiftUI: Alignment {
        switch self {
        case .center: .center
        case .leading: .leading
        case .trailing: .trailing
        case .top: .top
        case .bottom: .bottom
        case .topLeading: .topLeading
        case .topTrailing: .topTrailing
        case .bottomLeading: .bottomLeading
        case .bottomTrailing: .bottomTrailing
        }
    }
}
