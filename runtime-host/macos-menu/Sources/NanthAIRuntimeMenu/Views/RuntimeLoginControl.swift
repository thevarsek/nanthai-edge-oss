import SwiftUI

@MainActor
public struct RuntimeLoginControl: View {
    @Bindable private var store: RuntimeMenuStore

    public init(store: RuntimeMenuStore) { self.store = store }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle("Run at login", isOn: Binding(
                get: { store.runAtLoginEnabled },
                set: { enabled in Task { await store.setRunAtLogin(enabled) } }
            ))
            .disabled(store.isPerformingAction)
            Text("Open NanthAI Runtime automatically when you sign in to this Mac.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
