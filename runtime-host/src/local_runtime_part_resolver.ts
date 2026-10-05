import { stat } from "node:fs/promises";

import type {
  ResolvedRuntimePart,
  RuntimePartResolver,
} from "./packet_translation.ts";
import type { RuntimeContentPart } from "./protocol.ts";
import { runtimePartPath } from "./runtime_part_paths.ts";

type FetchedRuntimePart = Exclude<RuntimeContentPart, { type: "text" }>;

export class LocalRuntimePartResolver implements RuntimePartResolver {
  constructor(private readonly directory: string) {}

  async resolve(part: FetchedRuntimePart): Promise<ResolvedRuntimePart> {
    const path = runtimePartPath(this.directory, part);
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size !== part.fetch.byteLength) {
      throw new Error(`Materialized runtime part is unavailable: ${part.partId}`);
    }
    return { source: "local", path, sha256: part.fetch.sha256 };
  }
}
