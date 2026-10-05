import Foundation
import SwiftUI

public struct SavedNativeRequest: Decodable, Identifiable, Sendable {
    public let id: String
    public let resultId: String
    public let type: String
    public let prompt: String
    public let choices: [String]
    public let form: SavedNativeInputForm?
}
public struct SavedNativeInputForm: Decodable, Sendable {
    public let source: String
    public let url: String?
    public let fields: [SavedNativeInputField]
}
public struct SavedNativeInputField: Decodable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let type: String
    public let required: Bool
    public let secret: Bool
    public let options: [String]
}

@MainActor
public struct SavedNativeRequestView: View {
    public let request: SavedNativeRequest
    public let respond: @MainActor ([String: Any]) async -> Void
    @State private var values: [String: String] = [:]
    @State private var submitting = false

    private func text(_ field: SavedNativeInputField) -> Binding<String> {
        Binding(get: { values[field.id] ?? "" }, set: { values[field.id] = $0 })
    }
    private func send(_ payload: [String: Any]) {
        Task {
            submitting = true
            await respond(payload.merging(["resultId": request.resultId, "requestId": request.id]) { _, new in new })
            submitting = false
        }
    }
    public var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                Text(request.prompt).font(.headline).textSelection(.enabled)
                if request.type == "permission" {
                    HStack {
                        ForEach(request.choices, id: \.self) { choice in
                            Button(permissionLabel(choice)) { send(["action": "permission", "decision": choice]) }
                        }
                    }
                } else if let form = request.form {
                    if let raw = form.url, let url = URL(string: raw) { Link("Open native request", destination: url) }
                    ForEach(form.fields) { field in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(field.label)
                            if field.type == "boolean" {
                                Toggle(field.label, isOn: Binding(get: { values[field.id] == "true" }, set: { values[field.id] = String($0) })).labelsHidden()
                            } else if field.secret {
                                SecureField(field.label, text: text(field))
                            } else if !field.options.isEmpty && form.source != "request_user_input" {
                                Picker(field.label, selection: text(field)) {
                                    Text("Choose…").tag("")
                                    ForEach(field.options, id: \.self) { Text($0).tag($0) }
                                }.labelsHidden()
                            } else {
                                if !field.options.isEmpty {
                                    HStack { ForEach(field.options, id: \.self) { option in Button(option) { values[field.id] = option } } }
                                }
                                TextField(field.label, text: text(field))
                            }
                        }
                    }
                    HStack {
                        Button("Send response") {
                            let content = nativeInputContent(form: form, values: values)
                            send(["action": "input", "cancelled": false, "content": content])
                            values = [:]
                        }
                        Button("Cancel request") { send(["action": "input", "cancelled": true, "content": NSNull()]); values = [:] }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.disabled(submitting)
        .id(request.id)
    }
}

public func nativeInputContent(form: SavedNativeInputForm, values: [String: String]) -> [String: Any] {
    var content: [String: Any] = [:]
    for field in form.fields {
        guard field.required || values[field.id] != nil else { continue }
        if field.type == "boolean" { content[field.id] = values[field.id] == "true" }
        else if field.type == "number" || field.type == "integer" {
            if let number = Double(values[field.id] ?? "") { content[field.id] = number }
            else { content[field.id] = NSNull() }
        } else { content[field.id] = values[field.id] ?? "" }
    }
    return form.source == "request_user_input" ? ["answers": content] : content
}
private func permissionLabel(_ choice: String) -> String {
    switch choice {
    case "allow_once": "Allow once"
    case "allow_session": "Allow for this session"
    case "deny": "Deny"
    case "cancel": "Cancel"
    default: choice
    }
}
