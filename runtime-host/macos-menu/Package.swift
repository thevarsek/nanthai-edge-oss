// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "NanthAIRuntimeMenu",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "NanthAIRuntime", targets: ["NanthAIRuntimeApp"]),
        .library(
            name: "NanthAIRuntimeMenu",
            targets: ["NanthAIRuntimeMenu"]
        ),
    ],
    targets: [
        .executableTarget(name: "NanthAIRuntimeApp", dependencies: ["NanthAIRuntimeMenu"]),
        .target(name: "NanthAIRuntimeMenu"),
        .testTarget(
            name: "NanthAIRuntimeMenuTests",
            dependencies: ["NanthAIRuntimeMenu"]
        ),
    ]
)
