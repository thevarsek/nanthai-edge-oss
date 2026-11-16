// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "NanthAIRuntimeMenu",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "NanthAIKeychain", targets: ["NanthAIKeychain"]),
        .executable(name: "NanthAIRuntime", targets: ["NanthAIRuntimeApp"]),
        .library(
            name: "NanthAIRuntimeMenu",
            targets: ["NanthAIRuntimeMenu"]
        ),
    ],
    targets: [
        .executableTarget(name: "NanthAIKeychain", dependencies: ["NanthAIRuntimeMenu"]),        .executableTarget(name: "NanthAIRuntimeApp", dependencies: ["NanthAIRuntimeMenu"]),
        .target(name: "RuntimeKeychainAccess", linkerSettings: [.linkedFramework("Security")]),
        .target(name: "NanthAIRuntimeMenu", dependencies: ["RuntimeKeychainAccess"]),
        .testTarget(
            name: "NanthAIRuntimeMenuTests",
            dependencies: ["NanthAIRuntimeMenu"]
        ),
    ]
)
