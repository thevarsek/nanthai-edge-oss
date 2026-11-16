import Foundation
import NanthAIRuntimeMenu

// Standalone CLI compatibility. Secrets never enter arguments or the environment.
let vault = RuntimeCredentialVault()
do {
    switch CommandLine.arguments.dropFirst().first {
    case "read":
        if let data = try vault.read() { FileHandle.standardOutput.write(data) }
        else { exit(44) }
    case "write":
        let data = FileHandle.standardInput.readDataToEndOfFile()
        _ = try JSONSerialization.jsonObject(with: data)
        try vault.write(data, trustCurrentApplication: false)
    case "delete": try vault.delete()
    default: exit(64)
    }
} catch {
    FileHandle.standardError.write(Data("macOS Keychain operation failed.\n".utf8))
    exit(1)
}
