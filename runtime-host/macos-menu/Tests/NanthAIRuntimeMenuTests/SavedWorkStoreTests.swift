import Foundation
import Testing
@testable import NanthAIRuntimeMenu

private actor SavedCommandFixture: RuntimeOperatorOutputReading {
    private(set) var calls: [[String]] = []
    func output(arguments: [String]) async throws -> Data {
        calls.append(arguments)
        if arguments == ["saved", "list"] {
            return Data(#"{"tasks":[{"id":"run-1","title":"Draft","adapter":"pi","modelId":"gpt-test","output":"Saved answer","updatedAt":1.0,"outcome":"completed","results":[{"id":"local-1","prompt":"Review","output":"Local answer","outcome":"completed","synced":true,"disposition":"review","filenames":["review.md"]}]}]}"#.utf8)
        }
        return Data(#"{"completed":true}"#.utf8)
    }
}
struct SavedWorkStoreTests {
    @Test @MainActor func savedTaskJourneyUsesLinkedIdAndReturnsSeparateDisposition() async {
        let commands = SavedCommandFixture()
        let store = SavedWorkStore(commands: commands)
        await store.refresh()
        #expect(store.tasks.first?.results.first?.disposition == "review")
        await store.continueTask("run-1", prompt: "Add references")
        #expect(await commands.calls.contains(["saved", "continue", "run-1", "Add references"]))
        #expect(await commands.calls.contains(["saved", "sync"]))
        #expect(!store.isRunning)
    }
}

extension SavedWorkStoreTests {
    @Test func nativeFormsKeepCodexSuggestionsAndTypedValues() throws {
        let form = try JSONDecoder().decode(SavedNativeInputForm.self, from: Data(#"{"source":"request_user_input","fields":[{"id":"answer","label":"Your answer","type":"string","required":true,"secret":false,"options":["Blue","Green"]}]}"#.utf8))
        let content = nativeInputContent(form: form, values: ["answer": "A custom answer"])
        #expect((content["answers"] as? [String: String])?["answer"] == "A custom answer")
        #expect(form.fields.first?.options == ["Blue", "Green"])
    }
}
