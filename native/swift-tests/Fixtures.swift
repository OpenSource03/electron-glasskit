enum Fixtures {
    /// A tree that uses every node type and, on its root, every `NodeBase` modifier.
    static let everything = """
    {
      "type": "vstack", "id": "root", "spacing": 8, "alignment": "leading",
      "padding": { "top": 1, "leading": 3, "horizontal": 9, "vertical": 7 },
      "frame": {
        "width": 380, "height": 900, "minWidth": 10, "maxWidth": "infinity",
        "minHeight": 5, "maxHeight": 2000, "alignment": "topLeading"
      },
      "glass": {
        "style": "clear", "tint": "#FF000080", "interactive": true,
        "shape": { "type": "rect", "cornerRadius": 12 }, "morphId": "morph", "union": "group"
      },
      "background": { "color": "#00FF00FF", "shape": "capsule" },
      "foreground": "#FFFFFFFF",
      "font": { "size": 15, "weight": "semibold", "design": "rounded" },
      "opacity": 0.9, "hidden": false, "disabled": false, "help": "Tip", "accessibilityLabel": "Root",
      "children": [
        { "type": "hstack", "spacing": 4, "alignment": "bottom", "children": [
          { "type": "text", "text": "Hello", "lineLimit": 2, "padding": 6, "background": "#0000FFFF" },
          { "type": "spacer", "minLength": 4 },
          { "type": "symbol", "name": "star.fill", "size": 18, "weight": "bold" }
        ] },
        { "type": "zstack", "alignment": "center", "hidden": true, "children": [
          { "type": "shape", "shape": "circle", "fill": "#112233FF", "frame": { "width": 20, "height": 20 } },
          { "type": "shape", "shape": "rect", "frame": { "width": 10, "height": 10 } },
          { "type": "shape", "shape": { "type": "path", "d": "M0 0L10 0L10 10Z", "viewBox": [10, 10] },
            "frame": { "width": 20, "height": 20 } },
          { "type": "shape", "shape": { "type": "text", "text": "Hi", "weight": "black", "design": "rounded" },
            "frame": { "width": 40, "height": 20 }, "glass": { "shape": { "type": "text", "text": "Hi" } } }
        ] },
        { "type": "glassContainer", "spacing": 6, "children": [
          { "type": "hstack", "children": [
            { "type": "button", "id": "plus", "label": { "type": "symbol", "name": "plus" },
              "glass": { "shape": "circle", "interactive": true }, "frame": { "width": 44, "height": 44 } },
            { "type": "button", "id": "go", "label": "Go", "style": "glass", "glass": true },
            { "type": "button", "id": "send", "label": "Send", "style": "glassProminent", "glass": false, "disabled": true }
          ] }
        ] },
        { "type": "divider" },
        { "type": "progress", "value": 0.4 },
        { "type": "progress" },
        { "type": "toggle", "id": "wifi", "isOn": true, "label": "Wi-Fi", "style": "switch" },
        { "type": "toggle", "id": "check", "style": "checkbox" },
        { "type": "toggle", "id": "bold", "label": "Bold", "style": "button" },
        { "type": "slider", "id": "volume", "value": 0.5, "min": 0, "max": 2, "step": 0.5 },
        { "type": "slider", "id": "plain" },
        { "type": "textField", "id": "name", "text": "abc", "placeholder": "Name" },
        { "type": "textField", "id": "message", "placeholder": "Message", "multiline": { "maxLines": 4 }, "clearOnSubmit": true },
        { "type": "textField", "id": "notes", "multiline": true },
        { "type": "picker", "id": "segments", "selection": "a", "style": "segmented", "options": [
          { "value": "a", "label": "A" }, { "value": "b", "symbol": "bolt" }, { "value": "c", "label": "C", "symbol": "flame" }
        ] },
        { "type": "picker", "id": "popup", "selection": "a", "style": "menu", "options": [{ "value": "a" }] },
        { "type": "menu", "label": "More", "items": [
          { "id": "copy", "title": "Copy", "symbol": "doc.on.doc" },
          "divider",
          { "id": "delete", "title": "Delete", "disabled": true, "destructive": true }
        ] },
        { "type": "menu", "label": { "type": "symbol", "name": "ellipsis" }, "items": [] }
      ]
    }
    """
}
