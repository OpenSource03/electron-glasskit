import AppKit
import SwiftUI

// Controls keep their value in a `ControlState`. Only changes the user makes are reported to JavaScript.

@available(macOS 14.0, *)
struct ProgressNodeView: View {
    let progress: ProgressNode

    var body: some View {
        if let value = progress.value {
            ProgressView(value: min(max(value, 0), 1))
        } else {
            ProgressView()
        }
    }
}

@available(macOS 14.0, *)
struct ButtonNodeView: View {
    let button: ButtonNode
    let layout: NodeLayout
    let context: RenderContext

    var body: some View {
        Button {
            context.state.send(.press(node: button.id))
        } label: {
            LabelView(label: button.label, context: context)
                .modifier(layout)
                .contentShape(Rectangle())
        }
        .modifier(ButtonLook(style: button.style ?? .plain))
    }
}

@available(macOS 14.0, *)
struct MenuNodeView: View {
    let menu: MenuNode
    let layout: NodeLayout
    let context: RenderContext

    var body: some View {
        Menu {
            ForEach(Array(menu.items.enumerated()), id: \.offset) { _, entry in
                switch entry {
                case .divider: Divider()
                case .item(let item): button(for: item)
                }
            }
        } label: {
            LabelView(label: menu.label, context: context)
                .modifier(layout)
                .contentShape(Rectangle())
        }
        // Draw only the label, so `glass` on the node decides the look, as with a plain button.
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }

    private func button(for item: MenuItem) -> some View {
        Button(role: item.destructive == true ? .destructive : nil) {
            context.state.send(.press(node: item.id))
        } label: {
            if let symbol = item.symbol {
                Label(item.title, systemImage: symbol)
            } else {
                Text(item.title)
            }
        }
        .disabled(item.disabled == true)
    }
}

@available(macOS 14.0, *)
struct ToggleNodeView: View {
    let toggle: ToggleNode
    @ObservedObject var control: ControlState
    let state: IslandState

    var body: some View {
        switch toggle.style ?? .switch {
        case .switch: content.toggleStyle(.switch)
        case .checkbox: content.toggleStyle(.checkbox)
        case .button: content.toggleStyle(.button)
        }
    }

    @ViewBuilder private var content: some View {
        let isOn = state.boolBinding(for: control, node: toggle.id)
        if let label = toggle.label {
            Toggle(label, isOn: isOn)
        } else {
            Toggle(isOn: isOn) { EmptyView() }.labelsHidden()
        }
    }
}

@available(macOS 14.0, *)
struct SliderNodeView: View {
    let slider: SliderNode
    @ObservedObject var control: ControlState
    let state: IslandState

    var body: some View {
        let value = state.numberBinding(for: control, node: slider.id, clampedBy: slider)
        if let step = slider.step {
            Slider(value: value, in: slider.min...slider.max, step: step)
        } else {
            Slider(value: value, in: slider.min...slider.max)
        }
    }
}

@available(macOS 14.0, *)
struct PickerNodeView: View {
    let picker: PickerNode
    @ObservedObject var control: ControlState
    let state: IslandState

    var body: some View {
        switch picker.style ?? .segmented {
        case .segmented: content.pickerStyle(.segmented)
        case .menu: content.pickerStyle(.menu)
        }
    }

    private var content: some View {
        Picker(selection: state.stringBinding(for: control, node: picker.id)) {
            ForEach(Array(picker.options.enumerated()), id: \.offset) { _, option in
                label(for: option).tag(option.value)
            }
        } label: {
            EmptyView()
        }
        .labelsHidden()
    }

    @ViewBuilder
    private func label(for option: PickerOption) -> some View {
        switch (option.label, option.symbol) {
        case (let label?, let symbol?): Label(label, systemImage: symbol)
        case (nil, let symbol?): Image(systemName: symbol).accessibilityLabel(option.value)
        case (let label, nil): Text(label ?? option.value)
        }
    }
}

/// What Return does in a multiline field.
enum ReturnKey: Equatable {
    case commitComposition, insertNewline, submit

    /// While an input method is composing, Return belongs to it: it confirms the marked text.
    @MainActor
    static func action(shift: Bool, editor: NSTextView?) -> ReturnKey {
        if editor?.hasMarkedText() == true {
            .commitComposition
        } else if shift {
            .insertNewline
        } else {
            .submit
        }
    }
}

@available(macOS 14.0, *)
struct TextFieldNodeView: View {
    let field: TextFieldNode
    @ObservedObject var control: ControlState
    let context: RenderContext

    var body: some View {
        input
            .textFieldStyle(.plain)
            .focused(context.focus, equals: field.id)
    }

    @ViewBuilder private var input: some View {
        let text = context.state.stringBinding(for: control, node: field.id)
        if let maxLines = field.multiline?.maxLines {
            TextField(field.placeholder ?? "", text: text, axis: .vertical)
                .lineLimit(1...maxLines)
                .onKeyPress(.return, phases: .down) { press in
                    let editor = NSApp.keyWindow?.firstResponder as? NSTextView
                    switch ReturnKey.action(shift: press.modifiers.contains(.shift), editor: editor) {
                    case .commitComposition:
                        return .ignored
                    case .insertNewline:
                        // SwiftUI offers no way to insert at the cursor, so ask the field editor directly.
                        editor?.insertNewlineIgnoringFieldEditor(nil)
                    case .submit:
                        submit()
                    }
                    return .handled
                }
        } else {
            TextField(field.placeholder ?? "", text: text).onSubmit(submit)
        }
    }

    private func submit() {
        guard case .string(let text) = control.value else { return }
        context.state.send(.submit(node: field.id, value: text))
        if field.clearOnSubmit == true {
            context.state.userChanged(control, node: field.id, to: .string(""))
        }
    }
}

@available(macOS 14.0, *)
extension IslandState {
    func boolBinding(for control: ControlState, node: String) -> Binding<Bool> {
        Binding {
            if case .bool(let value) = control.value { value } else { false }
        } set: { [self] value in
            userChanged(control, node: node, to: .bool(value))
        }
    }

    /// `setValue` and a changed range can leave the stored number outside the slider, so it is clamped on the way out.
    func numberBinding(for control: ControlState, node: String, clampedBy slider: SliderNode) -> Binding<Double> {
        Binding {
            if case .number(let value) = control.value { slider.clamped(value) } else { slider.min }
        } set: { [self] value in
            userChanged(control, node: node, to: .number(value))
        }
    }

    func stringBinding(for control: ControlState, node: String) -> Binding<String> {
        Binding {
            if case .string(let value) = control.value { value } else { "" }
        } set: { [self] value in
            userChanged(control, node: node, to: .string(value))
        }
    }
}
