import AppKit
import SwiftUI

@MainActor
public struct SavedWorkContent: View {
    @Bindable private var store: SavedWorkStore
    @State private var selection: String?
    @State private var prompt = ""
    public init(store: SavedWorkStore) { self.store = store }
    private func artifactLinks(_ files: [SavedWorkArtifact]) -> some View {
        ForEach(files) { file in
            Button { NSWorkspace.shared.open(URL(fileURLWithPath: file.path)) } label: { Label(file.filename, systemImage: "doc") }
        }
    }
    public var body: some View {
        NavigationSplitView {
            List(store.tasks, selection: $selection) { task in
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title).lineLimit(2)
                    Text("\(task.adapter.capitalized) · \(task.modelId ?? "Runtime default")")
                        .font(.caption).foregroundStyle(.secondary)
                }.tag(task.id)
            }
            .overlay { if store.tasks.isEmpty { ContentUnavailableView("No saved tasks yet", systemImage: "tray", description: Text("Run a task through NanthAI on this Mac. Its saved context will appear here.")) } }
        } detail: {
            if let task = store.tasks.first(where: { $0.id == selection }) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(task.title).font(.title2)
                    Text("Continue from the context saved on this Mac. Internet-based models still need internet. Answers and files sync when NanthAI is reachable; if the shared task changed, your work returns as a separate result.")
                        .font(.callout).foregroundStyle(.secondary)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(task.output).textSelection(.enabled)
                            artifactLinks(task.artifacts ?? [])
                            ForEach(task.results) { result in
                                Divider()
                                Text(result.prompt).font(.headline)
                                Text(result.output).textSelection(.enabled)
                                Text(result.synced ? (result.disposition == "review" ? "Saved as a separate result in NanthAI" : "Synchronized with NanthAI") : (result.outcome == nil ? "Working locally…" : "Saved on this Mac · waiting to sync"))
                                    .font(.caption).foregroundStyle(.secondary)
                                artifactLinks(result.artifacts ?? [])
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(task.requests ?? []) { request in
                        SavedNativeRequestView(request: request) { payload in
                            await store.nativeControl(task.id, payload: payload)
                        }
                    }
                    TextField("What would you like to do next?", text: $prompt, axis: .vertical).lineLimit(2...5)
                    HStack {
                        Button("Continue locally") { let text = prompt; prompt = ""; Task { await store.continueTask(task.id, prompt: text) } }
                            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.runningTaskIds.contains(task.id) || task.results.contains(where: { $0.outcome == nil }))
                        if let active = task.results.last(where: { $0.outcome == nil }) {
                            ProgressView().controlSize(.small)
                            Button("Stop") { Task { await store.nativeControl(task.id, payload: ["action": "stop", "resultId": active.id]) } }
                        }
                    }
                    if let error = store.error { Text(error).font(.caption).foregroundStyle(.red).textSelection(.enabled) }
                }.padding(20)
            } else { ContentUnavailableView("Select a saved task", systemImage: "text.bubble") }
        }
        .toolbar {
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
            Button("Sync saved work", systemImage: "arrow.triangle.2.circlepath") { Task { await store.synchronize() } }
        }
        .task {
            while !Task.isCancelled {
                await store.refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .frame(minWidth: 700, minHeight: 500)
    }
}
