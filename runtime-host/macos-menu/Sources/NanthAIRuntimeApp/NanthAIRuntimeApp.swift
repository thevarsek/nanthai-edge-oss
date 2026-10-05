import AppKit
import NanthAIRuntimeMenu
import SwiftUI

@main
struct NanthAIRuntimeApp: App {
    @NSApplicationDelegateAdaptor(RuntimeAppDelegate.self) private var delegate
    @State private var model = RuntimeAppModel.shared
    @Environment(\.openWindow) private var openWindow

    var body: some Scene {
        Window("NanthAI Runtime", id: "setup") {
            RuntimeSetupContent(model: model)
                .onOpenURL { url in Task { await model.finishAccountConnection(url) } }
        }
        .defaultSize(width: 540, height: 580)
        .windowResizability(.contentMinSize)
        Window("Saved NanthAI tasks", id: "saved-work") {
            SavedWorkContent(store: model.savedWork)
        }.defaultSize(width: 880, height: 640)
        MenuBarExtra {
            RuntimeMenuContent(store: model.menu, openSettings: {
                openWindow(id: "setup")
                NSApp.activate(ignoringOtherApps: true)
            }, openSavedWork: {
                openWindow(id: "saved-work")
                NSApp.activate(ignoringOtherApps: true)
            }, quit: { Task { await model.quit() } })
        } label: {
            Image(nsImage: Self.menuIcon)
                .overlay(alignment: .bottomTrailing) {
                    Circle().fill(model.connectionIndicator.tone == .ready ? Color.green : model.connectionIndicator.tone == .problem ? Color.red : Color.orange)
                        .frame(width: 6, height: 6)
                }
                .accessibilityLabel("NanthAI Runtime: \(model.connectionIndicator.label)")
        }
        .menuBarExtraStyle(.window)
    }

    private static var menuIcon: NSImage {
        let resource = Bundle.main.url(forResource: "NanthAIMenuIcon", withExtension: "png")
        let image = resource.flatMap { NSImage(contentsOf: $0) }
            ?? NSImage(systemSymbolName: "desktopcomputer", accessibilityDescription: "NanthAI Runtime")
            ?? NSImage()
        image.size = NSSize(width: 18, height: 18)
        return image
    }
}

@MainActor
final class RuntimeAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.activate(ignoringOtherApps: true)
        Task { await RuntimeAppModel.shared.launch() }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task { sender.reply(toApplicationShouldTerminate: await RuntimeAppModel.shared.stopBeforeQuit()) }
        return .terminateLater
    }
}
