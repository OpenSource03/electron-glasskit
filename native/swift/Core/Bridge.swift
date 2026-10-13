import AppKit

// The C interface declared in include/glasskit.h. Electron's main process calls it on the main thread.

private func data(_ string: UnsafePointer<CChar>?) -> Data {
    guard let string else { return Data() }
    return Data(bytes: string, count: strlen(string))
}

/// Pointers do not cross into the main actor; the address does.
private func address(_ root: UnsafeMutableRawPointer?) -> UInt {
    UInt(bitPattern: root)
}

private func text(_ string: UnsafePointer<CChar>?) -> String {
    string.map { String(cString: $0) } ?? ""
}

private func encode(_ value: some Encodable) -> String? {
    (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) }
}

private func copy(_ string: String?) -> UnsafeMutablePointer<CChar>? {
    string.flatMap { strdup($0) }
}

@_cdecl("gk_free")
public func gk_free(_ string: UnsafeMutablePointer<CChar>?) {
    free(string)
}

@_cdecl("gk_take_error")
public func gk_take_error() -> UnsafeMutablePointer<CChar>? {
    copy(MainActor.assumeIsolated { Runtime.shared.takeError() })
}

@_cdecl("gk_capabilities")
public func gk_capabilities() -> UnsafeMutablePointer<CChar>? {
    copy(MainActor.assumeIsolated { encode(CapabilitiesInfo.current) })
}

@_cdecl("gk_set_event_callback")
public func gk_set_event_callback(_ callback: EventCallback?) {
    MainActor.assumeIsolated { Runtime.shared.eventCallback = callback }
}

@_cdecl("gk_background_set")
public func gk_background_set(_ root: UnsafeMutableRawPointer?, _ options: UnsafePointer<CChar>?) -> Int32 {
    let json = data(options)
    let root = address(root)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt { try Runtime.shared.setBackground(root: root, json: json) } ?? -1
    }
}

@_cdecl("gk_group_create")
public func gk_group_create(_ root: UnsafeMutableRawPointer?, _ options: UnsafePointer<CChar>?) -> Int32 {
    let json = data(options)
    let root = address(root)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt { try Runtime.shared.createGroup(root: root, json: json) } ?? -1
    }
}

@_cdecl("gk_region_create")
public func gk_region_create(_ root: UnsafeMutableRawPointer?, _ group: Int32, _ options: UnsafePointer<CChar>?) -> Int32 {
    let json = data(options)
    let root = address(root)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt { try Runtime.shared.createRegion(root: root, groupId: group, json: json) } ?? -1
    }
}

@_cdecl("gk_island_create")
public func gk_island_create(_ root: UnsafeMutableRawPointer?, _ options: UnsafePointer<CChar>?) -> Int32 {
    let json = data(options)
    let root = address(root)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt { try Runtime.shared.createIsland(root: root, json: json) } ?? -1
    }
}

@_cdecl("gk_object_update")
public func gk_object_update(_ id: Int32, _ options: UnsafePointer<CChar>?) -> Bool {
    let json = data(options)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt { try Runtime.shared.update(id, json: json) } != nil
    }
}

@_cdecl("gk_object_set_frame")
public func gk_object_set_frame(_ id: Int32, _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ animate: Double) -> Bool {
    MainActor.assumeIsolated {
        Runtime.shared.attempt {
            try Runtime.shared.setFrame(id, CGRect(x: x, y: y, width: width, height: height), animate: animate)
        } != nil
    }
}

@_cdecl("gk_object_remove")
public func gk_object_remove(_ id: Int32) {
    MainActor.assumeIsolated { Runtime.shared.remove(id) }
}

@_cdecl("gk_island_set_content")
public func gk_island_set_content(_ id: Int32, _ content: UnsafePointer<CChar>?, _ animation: UnsafePointer<CChar>?) -> Bool {
    let json = data(content)
    let animationJSON = animation.map { data($0) }
    return MainActor.assumeIsolated {
        Runtime.shared.attempt {
            guard #available(macOS 14.0, *) else { throw GlassKitError("Islands need macOS 14 or later") }
            try Runtime.shared.island(id).setContent(json, animation: animationJSON)
        } != nil
    }
}

@_cdecl("gk_island_set_value")
public func gk_island_set_value(_ id: Int32, _ node: UnsafePointer<CChar>?, _ value: UnsafePointer<CChar>?) -> Bool {
    let name = text(node)
    let json = data(value)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt {
            guard #available(macOS 14.0, *) else { throw GlassKitError("Islands need macOS 14 or later") }
            return try Runtime.shared.island(id).setValue(node: name, json: json)
        } ?? false
    }
}

@_cdecl("gk_island_focus")
public func gk_island_focus(_ id: Int32, _ node: UnsafePointer<CChar>?) -> Bool {
    let name = text(node)
    return MainActor.assumeIsolated {
        Runtime.shared.attempt {
            guard #available(macOS 14.0, *) else { throw GlassKitError("Islands need macOS 14 or later") }
            return try Runtime.shared.island(id).focus(node: name)
        } ?? false
    }
}

@_cdecl("gk_host_detach")
public func gk_host_detach(_ root: UnsafeMutableRawPointer?) {
    let key = address(root)
    MainActor.assumeIsolated { Runtime.shared.detach(key: key) }
}

@_cdecl("gk_host_inspect")
public func gk_host_inspect(_ root: UnsafeMutableRawPointer?) -> UnsafeMutablePointer<CChar>? {
    let root = address(root)
    return copy(MainActor.assumeIsolated { Runtime.shared.inspect(root: root).flatMap(encode) })
}
