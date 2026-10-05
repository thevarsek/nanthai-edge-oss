import SwiftUI

public struct RuntimeReadinessLabel: View {
    let name: String
    let ready: Bool
    let selected: Bool

    public init(name: String, ready: Bool, selected: Bool) {
        self.name = name
        self.ready = ready
        self.selected = selected
    }

    public var body: some View {
        Label(ready ? "\(name) ready" : selected ? "\(name) needs setup" : "\(name) not selected",
              systemImage: ready ? "checkmark.circle.fill" : selected ? "exclamationmark.triangle.fill" : "circle")
            .foregroundStyle(ready ? Color.green : selected ? Color.orange : Color.secondary)
    }
}
