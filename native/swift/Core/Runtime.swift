import AppKit

public typealias EventCallback = @convention(c) (Int32, UnsafePointer<CChar>) -> Void

/// Owns every host and object, and maps the ids JavaScript holds to them.
@MainActor
final class Runtime {
    static let shared = Runtime()

    private struct Entry {
        let object: any ManagedObject
        let hostKey: UInt
        let group: Int32?
    }

    private var hosts: [UInt: WindowHost] = [:]
    private var entries: [Int32: Entry] = [:]
    private var nextId: Int32 = 1
    private var lastError: String?
    var eventCallback: EventCallback?

    // MARK: Errors

    func takeError() -> String? {
        defer { lastError = nil }
        return lastError
    }

    /// Runs `body`, recording a thrown error for `gk_take_error` and returning `nil`.
    func attempt<Result>(_ body: () throws -> Result) -> Result? {
        lastError = nil
        do {
            return try body()
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    // MARK: Hosts

    /// `root` is the address of the window's content view; it doubles as the host's key.
    private func host(for root: UInt) throws -> WindowHost {
        if let existing = hosts[root] { return existing }
        guard let pointer = UnsafeRawPointer(bitPattern: root) else { throw GlassKitError("The window handle is empty") }
        let key = root
        let view = Unmanaged<NSView>.fromOpaque(pointer).takeUnretainedValue()
        let created = WindowHost(root: view, key: key) { [weak self] key in self?.detach(key: key) }
        hosts[key] = created
        return created
    }

    /// Safe to call with the handle of a window that is already gone: the key is never dereferenced.
    func detach(key: UInt) {
        guard let host = hosts.removeValue(forKey: key) else { return }
        for (id, entry) in entries where entry.hostKey == key {
            entry.object.removeViews()
            entries[id] = nil
        }
        host.detach()
    }

    private func register(_ object: any ManagedObject, host: WindowHost, group: Int32? = nil) -> Int32 {
        let id = nextId
        nextId += 1
        entries[id] = Entry(object: object, hostKey: host.key, group: group)
        return id
    }

    // MARK: Creation

    func setBackground(root: UInt, json: Data) throws -> Int32 {
        let host = try host(for: root)
        let existing = host.background
        let background = try host.setBackground(json)
        if existing != nil, let id = entries.first(where: { $0.value.object === background })?.key { return id }
        return register(background, host: host)
    }

    func createGroup(root: UInt, json: Data) throws -> Int32 {
        let host = try host(for: root)
        let group = try Group(json: json)
        host.addGroup(group.view)
        return register(group, host: host)
    }

    func createRegion(root: UInt, groupId: Int32, json: Data) throws -> Int32 {
        let host = try host(for: root)
        var group: Group?
        if groupId != 0 {
            guard let found = entries[groupId]?.object as? Group, entries[groupId]?.hostKey == host.key else {
                throw GlassKitError("Group \(groupId) does not exist in this window")
            }
            group = found
        }
        let region = try Region(json: json)
        host.add(region.view, to: group?.view)
        return register(region, host: host, group: group == nil ? nil : groupId)
    }

    func createIsland(root: UInt, json: Data) throws -> Int32 {
        guard #available(macOS 14.0, *) else { throw GlassKitError("Islands need macOS 14 or later") }
        let host = try host(for: root)
        let id = nextId
        let island = try Island(json: json) { [weak self] event in self?.emit(id, event) }
        guard let slot = island.placedView else { throw GlassKitError("The island has no view") }
        host.add(slot)
        return register(island, host: host)
    }

    private func emit(_ id: Int32, _ json: String) {
        guard let eventCallback else { return }
        json.withCString { eventCallback(id, $0) }
    }

    // MARK: Objects

    private func entry(_ id: Int32) throws -> Entry {
        guard let entry = entries[id] else { throw GlassKitError("Glass object \(id) does not exist") }
        return entry
    }

    func update(_ id: Int32, json: Data) throws {
        let entry = try entry(id)
        let zIndex = entry.object.placedView?.zIndex
        try entry.object.update(json)
        guard entry.object.placedView?.zIndex != zIndex else { return }
        let group = entry.group.flatMap { entries[$0]?.object as? Group }
        hosts[entry.hostKey]?.restack(in: group?.view)
    }

    func setFrame(_ id: Int32, _ frame: CGRect, animate seconds: Double) throws {
        guard let view = try entry(id).object.placedView else { throw GlassKitError("Object \(id) has no frame") }
        // AppKit raises on a frame it cannot represent.
        guard [frame.minX, frame.minY, frame.width, frame.height, seconds].allSatisfy(\.isFinite) else {
            throw GlassKitError("A frame needs finite numbers")
        }
        let frame = CGRect(x: frame.minX, y: frame.minY, width: max(0, frame.width), height: max(0, frame.height))
        guard seconds > 0 else {
            view.frame = frame
            return
        }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = seconds
            context.allowsImplicitAnimation = true
            view.animator().frame = frame
        }
    }

    func remove(_ id: Int32) {
        guard let entry = entries.removeValue(forKey: id) else { return }
        // A group takes its regions with it.
        for (memberId, member) in entries where member.group == id {
            member.object.removeViews()
            entries[memberId] = nil
        }
        if entry.object is Background {
            hosts[entry.hostKey]?.clearBackground()
        } else {
            entry.object.removeViews()
        }
    }

    @available(macOS 14.0, *)
    func island(_ id: Int32) throws -> Island {
        guard let island = try entry(id).object as? Island else { throw GlassKitError("Object \(id) is not an island") }
        return island
    }

    // MARK: Inspection

    func inspect(root: UInt) -> HostInfo? {
        // A window with nothing added yet still has a state worth reporting.
        guard let host = try? host(for: root) else { return nil }
        let ids = Dictionary(uniqueKeysWithValues: entries.compactMap { id, entry in
            entry.object.placedView.map { (ObjectIdentifier($0), (id, entry)) }
        })
        func info(_ view: NSView) -> ObjectInfo? {
            guard let (id, entry) = ids[ObjectIdentifier(view)] else { return nil }
            let members = (entry.object as? Group)?.view.members.subviews.compactMap(info)
            return ObjectInfo(
                id: id,
                kind: entry.object.kind,
                viewClass: String(describing: type(of: view)),
                frame: FrameOptions(view.frame),
                zIndex: entry.object.placedView?.zIndex ?? 0,
                hidden: view.isHidden,
                members: members
            )
        }
        return HostInfo(
            overlay: host.overlayInfo,
            background: host.background?.surfaceView.map { BackgroundInfo(viewClass: String(describing: type(of: $0)), frame: FrameOptions($0.frame)) },
            objects: host.stackedViews.compactMap(info)
        )
    }
}

struct ObjectInfo: Encodable {
    let id: Int32
    let kind: String
    let viewClass: String
    let frame: FrameOptions
    let zIndex: Int
    let hidden: Bool
    /// Regions inside a group, back to front.
    let members: [ObjectInfo]?
}

struct BackgroundInfo: Encodable {
    let viewClass: String
    let frame: FrameOptions
}

/// What `gk_host_inspect` reports. Objects are listed back to front.
struct HostInfo: Encodable {
    let overlay: OverlayInfo
    let background: BackgroundInfo?
    let objects: [ObjectInfo]

    private enum CodingKeys: CodingKey {
        case overlay, background, objects
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(overlay, forKey: .overlay)
        // An explicit null, so the shape is the same with or without a background.
        try container.encode(background, forKey: .background)
        try container.encode(objects, forKey: .objects)
    }
}

struct CapabilitiesInfo: Encodable {
    let osVersion: String
    let glass: Bool
    let fallback: Bool
    let interactiveRegions: Bool
    let islands: Bool

    @MainActor
    static var current: CapabilitiesInfo {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        let islands: Bool = if #available(macOS 14.0, *) { true } else { false }
        return CapabilitiesInfo(
            osVersion: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)",
            glass: Materials.glassAvailable,
            fallback: !Materials.glassAvailable,
            interactiveRegions: Materials.interactiveAvailable,
            islands: islands
        )
    }
}
