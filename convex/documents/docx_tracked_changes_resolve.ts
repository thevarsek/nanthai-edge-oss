"use node";

import { attrs, builder, children, loadDocumentXml, nodeName, type XmlArray } from "./docx_tracked_changes_xml";

function convertDeletedText(nodes: XmlArray): void {
  for (const node of nodes) {
    if (nodeName(node) === "w:delText") {
      node["w:t"] = node["w:delText"];
      delete node["w:delText"];
    }
    const inner = children(node);
    if (inner) convertDeletedText(inner);
  }
}

function resolveNodes(nodes: XmlArray, changeIds: Set<string>, mode: "accept" | "reject"): { nodes: XmlArray; found: boolean } {
  let found = false;
  const output: XmlArray = [];
  for (const node of nodes) {
    const name = nodeName(node);
    const match = (name === "w:ins" || name === "w:del")
      && (changeIds.has(attrs(node)["nanthai:changeId"] ?? "") || changeIds.has(attrs(node)["w:id"] ?? ""));
    if (match) {
      found = true;
      const inner = children(node) ?? [];
      if ((name === "w:ins" && mode === "accept") || (name === "w:del" && mode === "reject")) {
        if (name === "w:del") convertDeletedText(inner);
        output.push(...inner);
      }
      continue;
    }
    const inner = children(node);
    if (inner) {
      const resolved = resolveNodes(inner, changeIds, mode);
      found ||= resolved.found;
      node[name!] = resolved.nodes;
    }
    output.push(node);
  }
  return { nodes: output, found };
}

export async function resolveTrackedDocxChange(
  bytes: ArrayBuffer,
  changeIds: string[],
  mode: "accept" | "reject",
): Promise<{ bytes: ArrayBuffer; found: boolean }> {
  const { zip, path, tree } = await loadDocumentXml(bytes);
  const resolved = resolveNodes(tree, new Set(changeIds), mode);
  if (!resolved.found) return { bytes, found: false };
  zip.file(path, builder.build(resolved.nodes));
  return { bytes: await zip.generateAsync({ type: "arraybuffer" }), found: true };
}
