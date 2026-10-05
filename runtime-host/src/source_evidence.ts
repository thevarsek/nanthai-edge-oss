import * as sourceImport from "../../convex/chat/source_evidence_quotes.ts";
export const { stripSourceEvidence, validateSourceEvidence } = cjsCompatible(sourceImport);
function cjsCompatible<T extends object>(module: T): T {
  if (!("default" in module)) return module;
  return (module as T & { default: T }).default;
}
