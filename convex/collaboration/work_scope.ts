import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export function scopedWork(rows: Doc<"collaborationWork">[], ids?: Id<"collaborationWork">[]) {
  return rows.filter(row => (row.deferred !== true || row.status === "done" || row.status === "cancelled") && (!ids || ids.includes(row._id)));
}
/** Explicitly starting a goal also starts its required, unfinished inputs. */
export async function activateWorkScope(ctx: MutationCtx, rows: Doc<"collaborationWork">[], ids: Id<"collaborationWork">[]) {
  const byId = new Map(rows.map(row => [row._id, row]));
  const selected = new Set<Id<"collaborationWork">>();
  const visit = async (id: Id<"collaborationWork">) => {
    const row = byId.get(id);
    if (!row || selected.has(id)) return;
    selected.add(id);
    if (row.status === "done" || row.status === "cancelled") return;
    await ctx.db.patch(id, { deferred: false });
    for (const dependency of row.dependencyIds) await visit(dependency);
  };
  for (const id of ids) await visit(id);
  return [...selected];
}
