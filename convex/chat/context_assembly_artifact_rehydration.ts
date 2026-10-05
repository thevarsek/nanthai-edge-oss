import type { ActionCtx } from "../_generated/server";
import type { AssemblyArtifactCandidate } from "./context_assembler";

export async function rehydrateStoredArtifacts(
  ctx: ActionCtx,
  artifacts: AssemblyArtifactCandidate[],
  artifactIds: Set<string>,
): Promise<{ artifacts: AssemblyArtifactCandidate[]; bytesRead: number; durationMs: number }> {
  const startedAt = Date.now();
  let bytesRead = 0;
  const rehydrated = await Promise.all(artifacts.map(async (artifact) => {
    if (!artifactIds.has(String(artifact._id))) return artifact;
    const storageId = artifact.resultStorageId;
    if (artifact.resultRaw || !storageId) return artifact;
    const blob = await ctx.storage.get(storageId);
    if (!blob) return artifact;
    const resultRaw = await blob.text();
    bytesRead += resultRaw.length;
    return {
      ...artifact,
      resultRaw,
    };
  }));
  return {
    artifacts: rehydrated,
    bytesRead,
    durationMs: Date.now() - startedAt,
  };
}

