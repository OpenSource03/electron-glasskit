import Foundation

/// Every failure an island reports. The message is written for the developer who sent the JSON.
struct IslandError: LocalizedError, Equatable {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

extension IslandError {
    /// Rewrites a Foundation decoding error as one sentence naming what was being decoded and where.
    init(_ error: DecodingError, decoding subject: String) {
        switch error {
        case .keyNotFound(let key, let context):
            self.init("\(subject): missing required key \"\(key.stringValue)\"\(Self.location(context.codingPath))")
        case .typeMismatch(_, let context):
            self.init("\(subject): wrong type\(Self.location(context.codingPath)) (\(context.debugDescription))")
        case .valueNotFound(_, let context):
            self.init("\(subject): missing value\(Self.location(context.codingPath)) (\(context.debugDescription))")
        case .dataCorrupted(let context):
            let problem = context.codingPath.isEmpty && context.underlyingError != nil ? "invalid JSON" : "invalid value"
            self.init("\(subject): \(problem)\(Self.location(context.codingPath)) (\(context.debugDescription))")
        @unknown default:
            self.init("\(subject): \(error.localizedDescription)")
        }
    }

    /// `children[1].label` style path, or nothing at the root.
    static func location(_ path: [any CodingKey]) -> String {
        let text = path.reduce(into: "") { text, key in
            if let index = key.intValue {
                text += "[\(index)]"
            } else {
                text += text.isEmpty ? key.stringValue : ".\(key.stringValue)"
            }
        }
        return text.isEmpty ? "" : " at \(text)"
    }
}

enum IslandJSON {
    /// Decodes `data`, turning every failure into an `IslandError`.
    static func decode<Value: Decodable>(_ type: Value.Type, from data: Data, subject: String) throws -> Value {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch let error as DecodingError {
            throw IslandError(error, decoding: subject)
        }
    }
}
