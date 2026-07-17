import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export interface PresentationGeneratedFileSnapshotInput {
  storageId: Id<"_storage">;
  sizeBytes?: number;
  presentationProjectId?: Id<"presentationProjects">;
  presentationRevision?: number;
}

export async function preferCurrentPresentationSnapshot<
  T extends PresentationGeneratedFileSnapshotInput,
>(ctx: MutationCtx, userId: string, file: T): Promise<T> {
  if (!file.presentationProjectId || file.presentationRevision === undefined) return file;
  const project = await ctx.db.get("presentationProjects", file.presentationProjectId);
  if (
    project?.userId !== userId ||
    project.snapshotKind !== "browser_html" ||
    project.snapshotRevision !== file.presentationRevision ||
    !project.snapshotStorageId
  ) {
    return file;
  }
  return {
    ...file,
    storageId: project.snapshotStorageId,
    sizeBytes: project.snapshotSizeBytes ?? file.sizeBytes,
  };
}
