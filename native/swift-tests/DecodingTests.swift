import Foundation

extension Node {
    var type: NodeType {
        switch kind {
        case .stack(let stack):
            switch stack.axis {
            case .horizontal: .hstack
            case .vertical: .vstack
            case .depth: .zstack
            }
        case .glassContainer: .glassContainer
        case .spacer: .spacer
        case .text: .text
        case .symbol: .symbol
        case .shape: .shape
        case .divider: .divider
        case .progress: .progress
        case .button: .button
        case .toggle: .toggle
        case .slider: .slider
        case .textField: .textField
        case .picker: .picker
        case .menu: .menu
        }
    }

    var children: [Node] {
        switch kind {
        case .stack(let stack): stack.children
        case .glassContainer(let container): container.children
        case .button(let button): button.label.node.map { [$0] } ?? []
        case .menu(let menu): menu.label.node.map { [$0] } ?? []
        default: []
        }
    }

    var subtree: [Node] {
        [self] + children.flatMap(\.subtree)
    }
}

@MainActor
func runDecodingTests() {
    Tests.run("decoding: the fixture uses every node type") {
        let types = Set(try decodeNode(Fixtures.everything).subtree.map(\.type))
        try expectEqual(types, Set(NodeType.allCases))
    }

    Tests.run("decoding: every modifier on the root") {
        let root = try decodeNode(Fixtures.everything)
        let modifiers = root.modifiers
        try expectEqual(root.id, "root")
        // Explicit edges win over the `horizontal` / `vertical` shorthands.
        try expectEqual(modifiers.padding.map { [$0.top, $0.bottom, $0.leading, $0.trailing] }, [1, 7, 3, 9])
        try expectEqual(modifiers.frame?.width?.value, 380)
        try expectEqual(modifiers.frame?.height?.value, 900)
        try expectEqual(modifiers.frame?.minWidth?.value, 10)
        try expectEqual(modifiers.frame?.maxWidth?.value, .infinity)
        try expectEqual(modifiers.frame?.minHeight?.value, 5)
        try expectEqual(modifiers.frame?.maxHeight?.value, 2000)
        try expectEqual(modifiers.frame?.alignment, .topLeading)
        try expectEqual(modifiers.glass?.style, .clear)
        try expectEqual(modifiers.glass?.tint?.components.red, 1)
        try expectClose(modifiers.glass?.tint?.components.alpha ?? 0, 128.0 / 255)
        try expectEqual(modifiers.glass?.interactive, true)
        try expectEqual(modifiers.glass?.shape, .rect(cornerRadius: 12))
        try expectEqual(modifiers.glass?.morphId, "morph")
        try expectEqual(modifiers.glass?.union, "group")
        try expectEqual(modifiers.background?.color.components.green, 1)
        try expectEqual(modifiers.background?.shape, .capsule)
        try expectEqual(modifiers.foreground?.components, HexColor.Components(red: 1, green: 1, blue: 1, alpha: 1))
        try expectEqual(modifiers.font?.size?.value, 15)
        try expectEqual(modifiers.font?.weight, .semibold)
        try expectEqual(modifiers.font?.design, .rounded)
        try expectEqual(modifiers.opacity, 0.9)
        try expectEqual(modifiers.hidden, false)
        try expectEqual(modifiers.disabled, false)
        try expectEqual(modifiers.help, "Tip")
        try expectEqual(modifiers.accessibilityLabel, "Root")
    }

    Tests.run("decoding: shorthands and defaults") {
        let node = try decodeNode(##"{"type":"text","text":"x","padding":6,"glass":true,"background":"#0000FF"}"##)
        try expectEqual(node.modifiers.padding.map { [$0.top, $0.bottom, $0.leading, $0.trailing] }, [6, 6, 6, 6])
        try expectEqual(node.modifiers.glass, GlassSpec())
        try expectEqual(node.modifiers.glass?.shape, .capsule)
        try expectEqual(node.modifiers.background?.shape, .rect(cornerRadius: 0))
        try expectEqual(node.modifiers.hidden, false)
        try expectEqual(try decodeNode(#"{"type":"divider","glass":false}"#).modifiers.glass, nil)

        guard case .slider(let slider) = try decodeNode(#"{"type":"slider","id":"s"}"#).kind else {
            throw ExpectationFailure(description: "expected a slider")
        }
        try expectEqual([slider.min, slider.max], [0, 1])

        guard case .textField(let field) = try decodeNode(#"{"type":"textField","id":"f","multiline":true}"#).kind else {
            throw ExpectationFailure(description: "expected a text field")
        }
        try expectEqual(field.multiline?.maxLines, 8)
    }

    Tests.run("decoding: node payloads") {
        let nodes = try decodeNode(Fixtures.everything).subtree
        func first<Payload>(_ match: (Node.Kind) -> Payload?) throws -> Payload {
            guard let payload = nodes.compactMap({ match($0.kind) }).first else {
                throw ExpectationFailure(description: "the fixture has no such node")
            }
            return payload
        }

        let menu = try first { if case .menu(let menu) = $0 { menu } else { nil } }
        try expectEqual(menu.label, .text("More"))
        try expectEqual(menu.items.count, 3)
        try expectEqual(menu.items[1], .divider)
        try expectEqual(
            menu.items[2], .item(MenuItem(id: "delete", title: "Delete", symbol: nil, disabled: true, destructive: true)))

        let button = try first { if case .button(let button) = $0 { button } else { nil } }
        try expectEqual(button.id, "plus")
        try expectEqual(button.label.node?.type, .symbol)

        let picker = try first { if case .picker(let picker) = $0 { picker } else { nil } }
        try expectEqual(picker.selection, "a")
        try expectEqual(picker.options[1], PickerOption(value: "b", label: nil, symbol: "bolt"))

        let field = try first { if case .textField(let field) = $0, field.id == "message" { field } else { nil } }
        try expectEqual(field.multiline?.maxLines, 4)
        try expectEqual(field.clearOnSubmit, true)

        let shapes = nodes.compactMap { if case .shape(let shape) = $0.kind { shape.shape } else { nil } }
        try expectEqual(shapes[0], .circle)
        try expectEqual(shapes[1], .rect(cornerRadius: 0))
        try expectEqual(shapes[2], .path(try SVGPath("M0 0L10 0L10 10Z"), viewBox: CGSize(width: 10, height: 10)))
        try expectEqual(shapes[3], .text("Hi", weight: .black, design: .rounded))
    }

    Tests.run("decoding: unknown node type") {
        try expectError(containing: "unknown node type \"blob\"", "children[1]") {
            _ = try decodeNode(#"{"type":"vstack","children":[{"type":"divider"},{"type":"blob"}]}"#)
        }
        try expectError(containing: "unknown node type \"nope\"", "label") {
            _ = try decodeNode(#"{"type":"button","id":"b","label":{"type":"nope"}}"#)
        }
    }

    Tests.run("decoding: missing required keys name the node type and key") {
        let cases = [
            (#"{"children":[]}"#, "node", "type"),
            (#"{"type":"vstack"}"#, "vstack node", "children"),
            (#"{"type":"glassContainer"}"#, "glassContainer node", "children"),
            (#"{"type":"text"}"#, "text node", "text"),
            (#"{"type":"symbol"}"#, "symbol node", "name"),
            (#"{"type":"shape"}"#, "shape node", "shape"),
            (#"{"type":"button","id":"b"}"#, "button node", "label"),
            (#"{"type":"button","label":"x"}"#, "button node", "id"),
            (#"{"type":"toggle"}"#, "toggle node", "id"),
            (#"{"type":"slider"}"#, "slider node", "id"),
            (#"{"type":"textField"}"#, "textField node", "id"),
            (#"{"type":"picker","id":"p"}"#, "picker node", "options"),
            (#"{"type":"picker","id":"p","options":[{}]}"#, "picker node", "value"),
            (#"{"type":"menu","label":"m"}"#, "menu node", "items"),
            (#"{"type":"menu","label":"m","items":[{"id":"a"}]}"#, "menu node", "title"),
            (#"{"type":"shape","shape":{"type":"rect"}}"#, "shape node", "cornerRadius"),
            (#"{"type":"shape","shape":{"type":"path"}}"#, "shape node", "\"d\""),
        ]
        for (json, subject, key) in cases {
            try expectError(containing: "\(subject): missing required key", key) {
                _ = try decodeNode(json)
            }
        }
        try expectError(containing: "button node: missing required key \"label\" at children[0]") {
            _ = try decodeNode(#"{"type":"hstack","children":[{"type":"button","id":"b"}]}"#)
        }
    }

    Tests.run("decoding: invalid values say where") {
        let cases = [
            (#"{"type":"text","text":5}"#, ["text node", "wrong type at text"]),
            (#"{"type":"text","text":"x","foreground":"red"}"#, ["text node", "at foreground", "\"red\""]),
            (##"{"type":"text","text":"x","background":"#12"}"##, ["at background", "\"#12\""]),
            (#"{"type":"text","text":"x","frame":{"maxWidth":"huge"}}"#, ["at frame.maxWidth", "infinity"]),
            (#"{"type":"text","text":"x","frame":{"alignment":"middle"}}"#, ["at frame.alignment"]),
            (#"{"type":"text","text":"x","font":{"weight":"chunky"}}"#, ["at font.weight"]),
            (#"{"type":"slider","id":"s","min":2,"max":1}"#, ["slider node", "max must be greater than min"]),
            (#"{"type":"slider","id":"s","step":0}"#, ["slider node", "step must be positive"]),
            (#"{"type":"slider","id":"s","step":3}"#, ["slider node", "no larger than max - min"]),
            (#"{"type":"textField","id":"f","multiline":{"maxLines":0}}"#, ["textField node", "at multiline.maxLines", "must be between 1 and 10000"]),
            (#"{"type":"shape","shape":"hexagon"}"#, ["shape node", "unknown shape \"hexagon\""]),
            (#"{"type":"shape","shape":{"type":"blob"}}"#, ["shape node", "at shape.type"]),
            (#"{"type":"shape","shape":{"type":"path","d":"M0 0 L"}}"#, ["SVG path", "expected a number", "at shape.d"]),
            (#"{"type":"shape","shape":{"type":"path","d":"M0 0","viewBox":[1]}}"#, ["at shape.viewBox", "[width, height]"]),
            (#"{"type":"menu","label":"m","items":["separator"]}"#, ["menu node", "at items[0]", "\"separator\""]),
            (#"{"type":"button","id":"b","label":"x","style":"fancy"}"#, ["button node", "at style"]),
        ]
        for (json, fragments) in cases {
            for fragment in fragments {
                try expectError(containing: fragment) { _ = try decodeNode(json) }
            }
        }
        try expectError(containing: "island content", "invalid JSON") { _ = try decodeNode("{") }
    }

    Tests.run("decoding: numbers outside their range are refused") {
        let cases = [
            (#"{"type":"text","text":"x","font":{"size":0}}"#, "at font.size (must be between 0.1 and 2000)"),
            (#"{"type":"text","text":"x","font":{"size":1e300}}"#, "at font.size"),
            (#"{"type":"symbol","name":"star","size":-4}"#, "at size"),
            (#"{"type":"text","text":"x","padding":1e9}"#, "at padding (must be between -100000 and 100000)"),
            (#"{"type":"text","text":"x","padding":{"leading":-1e300}}"#, "at padding.leading"),
            (#"{"type":"text","text":"x","frame":{"width":-1}}"#, "at frame.width (must be between 0 and 100000)"),
            (#"{"type":"text","text":"x","frame":{"minHeight":1e12}}"#, "at frame.minHeight"),
            (#"{"type":"text","text":"x","frame":{"maxWidth":1e300}}"#, "at frame.maxWidth"),
            (#"{"type":"text","text":"x","lineLimit":0}"#, "at lineLimit (must be between 1 and 10000)"),
            (#"{"type":"text","text":"x","lineLimit":1e18}"#, "at lineLimit"),
            (#"{"type":"textField","id":"f","multiline":{"maxLines":1e9}}"#, "at multiline.maxLines"),
            (#"{"type":"hstack","spacing":1e300,"children":[]}"#, "at spacing"),
            (#"{"type":"glassContainer","spacing":-1,"children":[]}"#, "at spacing"),
            (#"{"type":"spacer","minLength":1e7}"#, "at minLength"),
            (#"{"type":"shape","shape":{"type":"rect","cornerRadius":-2}}"#, "at shape.cornerRadius"),
            (#"{"type":"shape","shape":{"type":"path","d":"M0 0","viewBox":[1e300,1]}}"#, "at shape.viewBox[0]"),
            (#"{"type":"text","text":"x","opacity":1e999}"#, "invalid JSON"),
            (#"{"type":"progress","value":NaN}"#, "invalid JSON"),
        ]
        for (json, problem) in cases {
            try expectError(containing: problem) { _ = try decodeNode(json) }
        }
        // Negative padding and spacing are meaningful, and the limits themselves are allowed.
        _ = try decodeNode(#"{"type":"hstack","spacing":-8,"padding":-100000,"frame":{"width":100000},"children":[]}"#)
        _ = try decodeNode(#"{"type":"text","text":"x","opacity":-1e300,"font":{"size":2000},"lineLimit":10000}"#)
        _ = try decodeNode(#"{"type":"progress","value":1e300}"#)
    }

    Tests.run("decoding: slider ranges that would trap or exhaust memory are refused") {
        let cases = [
            (#"{"type":"slider","id":"s","min":0,"max":1e15,"step":1}"#, "at max (must be between -1e12 and 1e12)"),
            (#"{"type":"slider","id":"s","min":0,"max":1e19}"#, "at max"),
            (#"{"type":"slider","id":"s","min":-1e300,"max":1}"#, "at min"),
            (#"{"type":"slider","id":"s","min":0,"max":10001,"step":1}"#, "at step (step divides the range into more than 10000 steps)"),
            (#"{"type":"slider","id":"s","step":1e-9}"#, "more than 10000 steps"),
            (#"{"type":"slider","id":"s","step":5e-324}"#, "more than 10000 steps"),
            (#"{"type":"slider","id":"s","step":-1}"#, "step must be positive"),
        ]
        for (json, problem) in cases {
            try expectError(containing: "slider node", problem) { _ = try decodeNode(json) }
        }
        // JSON has no spelling for infinity or NaN; a number too large for a double is not valid JSON.
        for number in ["1e999", "-1e999", "Infinity", "NaN"] {
            for key in ["min", "max", "step", "value"] {
                try expectError(containing: "invalid JSON") {
                    _ = try decodeNode("{\"type\":\"slider\",\"id\":\"s\",\"\(key)\":\(number)}")
                }
            }
        }
        func slider(_ json: String) throws -> SliderNode {
            guard case .slider(let slider) = try decodeNode(json).kind else {
                throw ExpectationFailure(description: "expected a slider")
            }
            return slider
        }
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":0,"max":10000,"step":1}"#).step, 1)
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":-1e12,"max":1e12}"#).max, 1e12)
        // The value is brought into the range.
        try expectEqual(try slider(#"{"type":"slider","id":"s","value":7}"#).value, 1)
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":2,"max":4,"value":-1e300}"#).value, 2)
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":2,"max":4,"value":3}"#).value, 3)
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":2,"max":4}"#).value, nil)
        try expectEqual(try slider(#"{"type":"slider","id":"s","min":2,"max":4}"#).clamped(9), 4)
    }

    Tests.run("decoding: control ids must be unique") {
        let tree = try decodeNode(#"""
        {"type":"hstack","children":[
          {"type":"toggle","id":"same"},
          {"type":"button","id":"b","label":{"type":"slider","id":"same"}}
        ]}
        """#)
        try expectError(containing: "share the id \"same\"") { _ = try tree.controls() }
    }

    Tests.run("decoding: controls are found in children and labels") {
        let controls = try decodeNode(Fixtures.everything).controls()
        try expectEqual(
            controls.map(\.id),
            ["wifi", "check", "bold", "volume", "plain", "name", "message", "notes", "segments", "popup"])
        try expectEqual(controls[0], ControlDescriptor(id: "wifi", kind: .toggle, prop: .bool(true), initial: .bool(false)))
        try expectEqual(controls[1].prop, nil)
        try expectEqual(controls[3], ControlDescriptor(id: "volume", kind: .slider, prop: .number(0.5), initial: .number(0)))
        try expectEqual(controls[5].prop, .string("abc"))
        try expectEqual(controls[8], ControlDescriptor(id: "segments", kind: .picker, prop: .string("a"), initial: .string("")))
    }

    Tests.run("decoding: animations") {
        func animation(_ json: String) throws -> IslandAnimation {
            try IslandJSON.decode(IslandAnimation.self, from: Data(json.utf8), subject: "island animation")
        }
        try expectEqual(try animation(#""none""#), .none)
        try expectEqual(try animation(#""default""#), .standard)
        try expectEqual(try animation(#""smooth""#), .smooth)
        try expectEqual(try animation(#""snappy""#), .snappy)
        try expectEqual(try animation(#""bouncy""#), .bouncy)
        try expectEqual(try animation(#"{"type":"spring","duration":0.4,"bounce":0.2}"#), .spring(duration: 0.4, bounce: 0.2))
        try expectEqual(try animation(#"{"type":"spring"}"#), .spring(duration: nil, bounce: nil))
        try expectEqual(try animation(#"{"type":"easeInOut","duration":1}"#), .easeInOut(duration: 1))
        try expectError(containing: "island animation", "unknown animation \"wobble\"") { _ = try animation(#""wobble""#) }
        try expectError(containing: "island animation", "at type") { _ = try animation(#"{"type":"linear"}"#) }
    }
}
