import SwiftUI

/// What every node view needs from its island.
@available(macOS 14.0, *)
@MainActor
struct RenderContext {
    let state: IslandState
    /// One namespace per island, so glass can morph between any two of its nodes.
    let namespace: Namespace.ID
    let focus: FocusState<String?>.Binding
}

/// Renders one node and, through it, the tree below.
@available(macOS 14.0, *)
struct NodeView: View {
    let node: Node
    let context: RenderContext

    var body: some View {
        content.modifier(NodeDecoration(id: node.id, modifiers: node.modifiers, namespace: context.namespace))
    }

    private var layout: NodeLayout {
        NodeLayout(modifiers: node.modifiers)
    }

    @ViewBuilder private var content: some View {
        switch node.kind {
        case .stack(let stack):
            StackView(stack: stack, context: context).modifier(layout)
        case .glassContainer(let container):
            GlassGroup(spacing: container.spacing?.value ?? 0) {
                ZStack { NodeChildren(nodes: container.children, context: context) }
            }
            .modifier(layout)
        case .spacer(let spacer):
            Spacer(minLength: spacer.minLength?.value).modifier(layout)
        case .text(let text):
            Text(text.text).lineLimit(text.lineLimit?.value).modifier(layout)
        case .symbol(let symbol):
            Image(systemName: symbol.name)
                .inheritedFont(symbol.size.map { .system(size: $0.value) })
                .fontWeight(symbol.weight?.swiftUI)
                .modifier(layout)
        case .shape(let shape):
            NodeShape(spec: shape.shape)
                .fill(shape.fill.map { AnyShapeStyle($0.color) } ?? AnyShapeStyle(.foreground))
                .modifier(layout)
        case .divider:
            Divider().modifier(layout)
        case .progress(let progress):
            ProgressNodeView(progress: progress).modifier(layout)
        case .button(let button):
            ButtonNodeView(button: button, layout: layout, context: context)
        case .menu(let menu):
            MenuNodeView(menu: menu, layout: layout, context: context)
        case .toggle(let toggle):
            if let control = context.state.controls[toggle.id] {
                ToggleNodeView(toggle: toggle, control: control, state: context.state).modifier(layout)
            }
        case .slider(let slider):
            if let control = context.state.controls[slider.id] {
                SliderNodeView(slider: slider, control: control, state: context.state).modifier(layout)
            }
        case .textField(let field):
            if let control = context.state.controls[field.id] {
                TextFieldNodeView(field: field, control: control, context: context).modifier(layout)
            }
        case .picker(let picker):
            if let control = context.state.controls[picker.id] {
                PickerNodeView(picker: picker, control: control, state: context.state).modifier(layout)
            }
        }
    }
}

@available(macOS 14.0, *)
struct StackView: View {
    let stack: StackNode
    let context: RenderContext

    var body: some View {
        let alignment = stack.alignment?.swiftUI ?? .center
        let children = NodeChildren(nodes: stack.children, context: context)
        switch stack.axis {
        case .horizontal: HStack(alignment: alignment.vertical, spacing: stack.spacing?.value) { children }
        case .vertical: VStack(alignment: alignment.horizontal, spacing: stack.spacing?.value) { children }
        case .depth: ZStack(alignment: alignment) { children }
        }
    }
}

@available(macOS 14.0, *)
struct NodeChildren: View {
    let nodes: [Node]
    let context: RenderContext

    var body: some View {
        ForEach(Self.keyed(nodes)) { child in
            NodeView(node: child.node, context: context)
        }
    }

    struct Keyed: Identifiable {
        let id: String
        let node: Node
    }

    /// A child keeps its identity across updates by `id`. Without one, or with a repeated one, by position.
    static func keyed(_ nodes: [Node]) -> [Keyed] {
        let counts = nodes.compactMap(\.id).reduce(into: [String: Int]()) { $0[$1, default: 0] += 1 }
        return nodes.enumerated().map { index, node in
            if let id = node.id, counts[id] == 1 {
                Keyed(id: "id:\(id)", node: node)
            } else {
                Keyed(id: "index:\(index)", node: node)
            }
        }
    }
}

/// A `string | GlassNode` label.
@available(macOS 14.0, *)
struct LabelView: View {
    let label: NodeLabel
    let context: RenderContext

    var body: some View {
        switch label {
        case .text(let text): Text(text)
        case .node(let node): NodeView(node: node, context: context)
        }
    }
}
