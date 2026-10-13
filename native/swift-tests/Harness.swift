import Foundation

struct ExpectationFailure: Error, CustomStringConvertible {
    let description: String
}

/// Runs named tests, prints one line per test and remembers whether any failed.
@MainActor
enum Tests {
    private(set) static var passed = 0
    private(set) static var failed = 0

    static func run(_ name: String, _ body: @MainActor () throws -> Void) {
        do {
            try body()
            passed += 1
            print("ok    \(name)")
        } catch {
            failed += 1
            print("FAIL  \(name)\n      \(error)")
        }
    }
}

func expect(_ condition: Bool, _ message: @autoclosure () -> String, line: Int = #line) throws {
    guard condition else {
        throw ExpectationFailure(description: "line \(line): \(message())")
    }
}

func expectEqual<Value: Equatable>(_ actual: Value, _ expected: Value, line: Int = #line) throws {
    try expect(actual == expected, "expected \(expected), got \(actual)", line: line)
}

func expectClose(_ actual: Double, _ expected: Double, tolerance: Double = 1e-6, line: Int = #line) throws {
    try expect(abs(actual - expected) <= tolerance, "expected \(expected) ± \(tolerance), got \(actual)", line: line)
}

func expectClose(_ actual: CGPoint, _ expected: CGPoint, tolerance: Double = 1e-6, line: Int = #line) throws {
    try expectClose(actual.x, expected.x, tolerance: tolerance, line: line)
    try expectClose(actual.y, expected.y, tolerance: tolerance, line: line)
}

func expectClose(_ actual: CGRect, _ expected: CGRect, tolerance: Double = 1e-6, line: Int = #line) throws {
    try expectClose(actual.origin, expected.origin, tolerance: tolerance, line: line)
    try expectClose(actual.width, expected.width, tolerance: tolerance, line: line)
    try expectClose(actual.height, expected.height, tolerance: tolerance, line: line)
}

/// Passes when `body` throws an error whose message contains every fragment.
func expectError(containing fragments: String..., line: Int = #line, _ body: () throws -> Void) throws {
    do {
        try body()
    } catch {
        let message = error.localizedDescription
        for fragment in fragments {
            try expect(message.contains(fragment), "error \"\(message)\" does not mention \"\(fragment)\"", line: line)
        }
        return
    }
    throw ExpectationFailure(description: "line \(line): expected an error")
}

func decodeNode(_ json: String) throws -> Node {
    try IslandJSON.decode(Node.self, from: Data(json.utf8), subject: "island content")
}
