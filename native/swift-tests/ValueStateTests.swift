import Foundation

@MainActor
private func reconcile(_ store: ControlStore, _ json: String) throws {
    store.reconcile(with: try decodeNode(json).controls())
}

/// Stands in for the user editing a control.
@MainActor
private func edit(_ store: ControlStore, _ id: String, _ value: NodeValue) throws {
    guard let control = store[id] else {
        throw ExpectationFailure(description: "no control \"\(id)\"")
    }
    try expect(control.userSet(value), "\"\(id)\" already holds \(value)")
}

@MainActor
func runValueStateTests() {
    Tests.run("values: a control starts at its prop, or at its default without one") {
        let store = ControlStore()
        try reconcile(store, #"""
        {"type":"vstack","children":[
          {"type":"textField","id":"with","text":"abc"}, {"type":"textField","id":"without"},
          {"type":"toggle","id":"on","isOn":true}, {"type":"toggle","id":"off"},
          {"type":"slider","id":"level","value":0.25}, {"type":"slider","id":"low","min":3,"max":9},
          {"type":"picker","id":"pick","selection":"b","options":[{"value":"a"},{"value":"b"}]},
          {"type":"picker","id":"unpicked","options":[{"value":"a"}]}
        ]}
        """#)
        try expectEqual(store["with"]?.value, .string("abc"))
        try expectEqual(store["without"]?.value, .string(""))
        try expectEqual(store["on"]?.value, .bool(true))
        try expectEqual(store["off"]?.value, .bool(false))
        try expectEqual(store["level"]?.value, .number(0.25))
        try expectEqual(store["low"]?.value, .number(3))
        try expectEqual(store["pick"]?.value, .string("b"))
        try expectEqual(store["unpicked"]?.value, .string(""))
        try expectEqual(store["missing"]?.value, nil)
    }

    Tests.run("values: native state survives a tree that repeats the same prop") {
        let store = ControlStore()
        let tree = #"{"type":"textField","id":"field","text":"abc"}"#
        try reconcile(store, tree)
        try edit(store, "field", .string("abcdef"))
        try reconcile(store, tree)
        try expectEqual(store["field"]?.value, .string("abcdef"))
        try reconcile(store, #"{"type":"hstack","children":[{"type":"textField","id":"field","text":"abc","placeholder":"x"}]}"#)
        try expectEqual(store["field"]?.value, .string("abcdef"))
    }

    Tests.run("values: a changed prop overwrites native state") {
        let store = ControlStore()
        try reconcile(store, #"{"type":"textField","id":"field","text":"abc"}"#)
        try edit(store, "field", .string("abcdef"))
        try reconcile(store, #"{"type":"textField","id":"field","text":"xyz"}"#)
        try expectEqual(store["field"]?.value, .string("xyz"))
        try expectEqual(store["field"]?.reported, [])
    }

    Tests.run("values: a stale echo does not eat keystrokes") {
        let store = ControlStore()
        func field(_ text: String) -> String {
            "{\"type\":\"textField\",\"id\":\"field\",\"text\":\"\(text)\"}"
        }
        try reconcile(store, field(""))
        try edit(store, "field", .string("a"))
        try edit(store, "field", .string("ab"))
        // The page has only handled the first `change` so far and mirrors it back.
        try reconcile(store, field("a"))
        try expectEqual(store["field"]?.value, .string("ab"))
        try edit(store, "field", .string("abc"))
        try reconcile(store, field("ab"))
        try expectEqual(store["field"]?.value, .string("abc"))
        try reconcile(store, field("abc"))
        try reconcile(store, field("abc"))
        try expectEqual(store["field"]?.value, .string("abc"))
        try expectEqual(store["field"]?.reported, [])
    }

    Tests.run("values: echoes of a value typed twice are each recognised") {
        let store = ControlStore()
        func field(_ text: String) -> String {
            "{\"type\":\"textField\",\"id\":\"field\",\"text\":\"\(text)\"}"
        }
        try reconcile(store, field(""))
        for text in ["a", "ab", "a", "ac"] {
            try edit(store, "field", .string(text))
        }
        for echo in ["a", "ab", "a", "ac"] {
            try reconcile(store, field(echo))
            try expectEqual(store["field"]?.value, .string("ac"))
        }
        try expectEqual(store["field"]?.reported, [])
    }

    Tests.run("values: a deliberate reset after typing overwrites") {
        let store = ControlStore()
        func field(_ text: String) -> String {
            "{\"type\":\"textField\",\"id\":\"field\",\"text\":\"\(text)\"}"
        }
        // With the echoes still on their way.
        try reconcile(store, field("draft"))
        try edit(store, "field", .string("draft!"))
        try edit(store, "field", .string("draft!!"))
        try reconcile(store, field(""))
        try expectEqual(store["field"]?.value, .string(""))
        // A late echo of what was typed before the reset is now a value like any other.
        try reconcile(store, field("draft!"))
        try expectEqual(store["field"]?.value, .string("draft!"))

        // After the page caught up.
        try edit(store, "field", .string("draft!?"))
        try reconcile(store, field("draft!?"))
        try reconcile(store, field(""))
        try expectEqual(store["field"]?.value, .string(""))
        try reconcile(store, field(""))
        try expectEqual(store["field"]?.value, .string(""))
    }

    Tests.run("values: toggles, sliders and pickers tell echoes from new values too") {
        let store = ControlStore()
        func tree(isOn: Bool, value: Double, selection: String) -> String {
            """
            {"type":"vstack","children":[
              {"type":"toggle","id":"flag","isOn":\(isOn)},
              {"type":"slider","id":"level","value":\(value)},
              {"type":"picker","id":"pick","selection":"\(selection)","options":[{"value":"a"},{"value":"b"},{"value":"c"}]}
            ]}
            """
        }
        try reconcile(store, tree(isOn: false, value: 0, selection: "a"))
        try edit(store, "flag", .bool(true))
        try edit(store, "flag", .bool(false))
        try edit(store, "flag", .bool(true))
        try edit(store, "level", .number(0.25))
        try edit(store, "level", .number(0.5))
        try edit(store, "pick", .string("b"))
        try edit(store, "pick", .string("c"))

        try reconcile(store, tree(isOn: true, value: 0.25, selection: "b"))
        try expectEqual(store["flag"]?.value, .bool(true))
        try expectEqual(store["level"]?.value, .number(0.5))
        try expectEqual(store["pick"]?.value, .string("c"))
        try reconcile(store, tree(isOn: false, value: 0.5, selection: "c"))
        try expectEqual(store["flag"]?.value, .bool(true))

        // Once the echoes are through, the page's own values win.
        try reconcile(store, tree(isOn: true, value: 0.5, selection: "c"))
        try reconcile(store, tree(isOn: false, value: 0.75, selection: "a"))
        try expectEqual(store["flag"]?.value, .bool(false))
        try expectEqual(store["level"]?.value, .number(0.75))
        try expectEqual(store["pick"]?.value, .string("a"))
    }

    Tests.run("values: the echo history is bounded") {
        let store = ControlStore()
        try reconcile(store, #"{"type":"textField","id":"field","text":""}"#)
        for count in 1...1000 {
            try edit(store, "field", .string(String(repeating: "x", count: count)))
        }
        let limit = ControlState.historyLimit
        try expectEqual(store["field"]?.reported.count, limit)
        try expectEqual(store["field"]?.reported.first, .string(String(repeating: "x", count: 1001 - limit)))
        // An echo older than the history is indistinguishable from a new value.
        try reconcile(store, #"{"type":"textField","id":"field","text":"x"}"#)
        try expectEqual(store["field"]?.value, .string("x"))
    }

    Tests.run("values: leaving a prop out keeps native state, bringing it back overwrites") {
        let store = ControlStore()
        try reconcile(store, #"{"type":"slider","id":"level","value":0.2}"#)
        try edit(store, "level", .number(0.8))
        try reconcile(store, #"{"type":"slider","id":"level"}"#)
        try expectEqual(store["level"]?.value, .number(0.8))
        try reconcile(store, #"{"type":"slider","id":"level","value":0.2}"#)
        try expectEqual(store["level"]?.value, .number(0.2))
    }

    Tests.run("values: setValue always overwrites and is not undone by the same prop") {
        let store = ControlStore()
        let tree = #"{"type":"textField","id":"field","text":"abc"}"#
        try reconcile(store, tree)
        try edit(store, "field", .string("typed"))
        try expect(store.setValue(.string("forced"), for: "field"), "setValue should find the field")
        try expectEqual(store["field"]?.value, .string("forced"))
        try reconcile(store, tree)
        try expectEqual(store["field"]?.value, .string("forced"))
        try expect(store.setValue(.string("abc"), for: "field"), "setValue to the prop's own value")
        try expectEqual(store["field"]?.value, .string("abc"))
    }

    Tests.run("values: setValue rejects unknown controls and wrong types") {
        let store = ControlStore()
        try reconcile(store, #"""
        {"type":"vstack","children":[
          {"type":"toggle","id":"flag"}, {"type":"slider","id":"level"}, {"type":"textField","id":"field"},
          {"type":"picker","id":"pick","options":[{"value":"a"}]}, {"type":"button","id":"press","label":"x"}
        ]}
        """#)
        try expect(!store.setValue(.bool(true), for: "nobody"), "unknown id")
        try expect(!store.setValue(.bool(true), for: "press"), "a button holds no value")
        try expect(!store.setValue(.string("yes"), for: "flag"), "string into a toggle")
        try expect(!store.setValue(.bool(true), for: "level"), "boolean into a slider")
        try expect(!store.setValue(.number(1), for: "field"), "number into a text field")
        try expect(!store.setValue(.number(1), for: "pick"), "number into a picker")
        try expectEqual(store["flag"]?.value, .bool(false))
        try expect(store.setValue(.bool(true), for: "flag"), "boolean into a toggle")
        try expect(store.setValue(.number(0.5), for: "level"), "number into a slider")
        try expect(store.setValue(.string("hi"), for: "field"), "string into a text field")
        try expect(store.setValue(.string("a"), for: "pick"), "string into a picker")
        try expectEqual(store["level"]?.value, .number(0.5))
    }

    Tests.run("values: state for ids that disappear is dropped") {
        let store = ControlStore()
        let tree = #"{"type":"hstack","children":[{"type":"textField","id":"field","text":"abc"},{"type":"toggle","id":"flag"}]}"#
        try reconcile(store, tree)
        try edit(store, "field", .string("typed"))
        try edit(store, "flag", .bool(true))
        try reconcile(store, #"{"type":"hstack","children":[{"type":"toggle","id":"flag"}]}"#)
        try expect(store["field"] == nil, "the field's state should be gone")
        try expectEqual(store["flag"]?.value, .bool(true))
        try reconcile(store, tree)
        try expectEqual(store["field"]?.value, .string("abc"))
        try expectEqual(store["flag"]?.value, .bool(true))
    }

    Tests.run("values: an id reused for another kind of control starts fresh") {
        let store = ControlStore()
        try reconcile(store, #"{"type":"toggle","id":"thing","isOn":true}"#)
        try reconcile(store, #"{"type":"textField","id":"thing"}"#)
        try expectEqual(store["thing"]?.kind, .textField)
        try expectEqual(store["thing"]?.value, .string(""))
    }

    Tests.run("values: only user changes emit change") {
        var events: [String] = []
        let state = try IslandState(root: try decodeNode(#"{"type":"toggle","id":"flag","isOn":false}"#), fit: .none) {
            events.append($0)
        }
        guard let control = state.controls["flag"] else {
            throw ExpectationFailure(description: "no control")
        }
        try state.setRoot(try decodeNode(#"{"type":"toggle","id":"flag","isOn":true}"#))
        try expect(state.controls.setValue(.bool(false), for: "flag"), "setValue")
        try expectEqual(events, [])

        state.userChanged(control, node: "flag", to: .bool(true))
        state.userChanged(control, node: "flag", to: .bool(true))
        try expectEqual(events, [#"{"node":"flag","type":"change","value":true}"#])
        try expectEqual(control.value, .bool(true))
    }

    Tests.run("values: a tree with duplicate control ids is refused and changes nothing") {
        let state = try IslandState(root: try decodeNode(#"{"type":"toggle","id":"flag","isOn":true}"#), fit: .none) { _ in }
        let before = state.root
        try expectError(containing: "share the id \"flag\"") {
            try state.setRoot(try decodeNode(#"{"type":"hstack","children":[{"type":"toggle","id":"flag"},{"type":"slider","id":"flag"}]}"#))
        }
        try expectEqual(state.root, before)
        try expectEqual(state.controls["flag"]?.value, .bool(true))
    }

    Tests.run("events: JSON matches IslandEvent") {
        try expectEqual(IslandEvent.press(node: "go").json, #"{"node":"go","type":"press"}"#)
        try expectEqual(IslandEvent.change(node: "level", value: .number(0.5)).json, #"{"node":"level","type":"change","value":0.5}"#)
        try expectEqual(IslandEvent.change(node: "field", value: .string("a\"b")).json, #"{"node":"field","type":"change","value":"a\"b"}"#)
        try expectEqual(IslandEvent.submit(node: "field", value: "hi").json, #"{"node":"field","type":"submit","value":"hi"}"#)
        try expectEqual(IslandEvent.focus(node: "field").json, #"{"node":"field","type":"focus"}"#)
        try expectEqual(IslandEvent.blur(node: "field").json, #"{"node":"field","type":"blur"}"#)
        try expectEqual(
            IslandEvent.resize(CGSize(width: 120, height: 48)).json, #"{"size":{"height":48,"width":120},"type":"resize"}"#)
    }

    Tests.run("values: NodeValue decodes each JSON type") {
        func value(_ json: String) throws -> NodeValue {
            try JSONDecoder().decode(NodeValue.self, from: Data(json.utf8))
        }
        try expectEqual(try value("true"), .bool(true))
        try expectEqual(try value("0"), .number(0))
        try expectEqual(try value("1"), .number(1))
        try expectEqual(try value("0.25"), .number(0.25))
        try expectEqual(try value(#""true""#), .string("true"))
        try expectError { _ = try value("null") }
        try expectError { _ = try value("[1]") }
    }
}
