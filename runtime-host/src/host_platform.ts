export type RuntimeOperatingSystem = "macos" | "windows" | "linux";
export type RuntimeArchitecture = "arm64" | "x64";

export function runtimeOperatingSystem(platform: NodeJS.Platform): RuntimeOperatingSystem {
  switch (platform) {
    case "darwin": return "macos";
    case "win32": return "windows";
    case "linux": return "linux";
    default: throw new Error(`Unsupported Runtime Host operating system: ${platform}`);
  }
}

export function runtimeArchitecture(architecture: string): RuntimeArchitecture {
  switch (architecture) {
    case "arm64": return "arm64";
    case "x64": return "x64";
    default: throw new Error(`Unsupported Runtime Host architecture: ${architecture}`);
  }
}
