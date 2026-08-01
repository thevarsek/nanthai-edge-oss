import { UriTemplate } from "@modelcontextprotocol/client";
import { ConvexError } from "convex/values";

export function resolveAllowedResourceUri(
  kind: "resource" | "resource_template",
  item: { uri?: string; uriTemplate?: string },
  requestedUri?: string,
  templateArguments?: unknown,
): string | undefined {
  if (kind === "resource") return item.uri;
  let resolvedUri = requestedUri;
  if (item.uriTemplate && templateArguments !== undefined) {
    if (
      typeof templateArguments !== "object"
      || templateArguments === null
      || Array.isArray(templateArguments)
    ) {
      throw new ConvexError({
        code: "MCP_RESOURCE_URI_MISMATCH",
        message: "The resource template arguments are invalid.",
      });
    }
    const values = Object.fromEntries(Object.entries(templateArguments).map(([name, value]) => {
      if (typeof value !== "string") {
        throw new ConvexError({
          code: "MCP_RESOURCE_URI_MISMATCH",
          message: "The resource template arguments are invalid.",
        });
      }
      return [name, value];
    }));
    try {
      resolvedUri = new UriTemplate(item.uriTemplate).expand(values);
    } catch {
      throw new ConvexError({
        code: "MCP_RESOURCE_URI_MISMATCH",
        message: "The resource URI does not match the allowed template.",
      });
    }
  }
  let matches = false;
  try {
    matches = Boolean(
      item.uriTemplate
      && resolvedUri
      && new UriTemplate(item.uriTemplate).match(resolvedUri) !== null,
    );
  } catch {
    matches = false;
  }
  if (!matches) {
    throw new ConvexError({
      code: "MCP_RESOURCE_URI_MISMATCH",
      message: "The resource URI does not match the allowed template.",
    });
  }
  return resolvedUri;
}
