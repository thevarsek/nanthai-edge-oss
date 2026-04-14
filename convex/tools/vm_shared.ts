"use node";

export type VmEnvironment = "python" | "node";

export function parseVmEnvironment(value: unknown): VmEnvironment {
  return value === "node" ? "node" : "python";
}
