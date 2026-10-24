import type { DiagramNode } from "./diagramTypes";
import { skillDiagrams } from "./skillDiagrams";
import { transcriptDiagrams } from "./transcriptDiagrams";
import { beyondDiagrams } from "./beyondDiagrams";

export const diagrams = { ...skillDiagrams, ...transcriptDiagrams, ...beyondDiagrams };

function treeLines(nodes: DiagramNode[], depth = 0): string[] {
  return nodes.flatMap(node => [`${"  ".repeat(depth)}- ${node.label}`, ...treeLines(node.children ?? [], depth + 1)]);
}

export function expandArticleDiagrams(body: string) {
  return body.replace(/!\[[^\]]*\]\(diagram:([^)]+)\)/g, (_, id: string) => {
    const diagram = diagrams[id];
    if (!diagram) throw new Error(`Unknown research diagram: ${id}`);
    const lines = [`**${diagram.title}**`];
    for (const panel of diagram.panels ?? []) {
      if (panel.heading) lines.push(`\n**${panel.heading}**`);
      lines.push(...treeLines(panel.tree ?? []));
      lines.push(...(panel.steps ?? []).map((step, i) => `${i + 1}. ${step}`));
      lines.push(...(panel.lines ?? []).map(line => `\n${line}`));
    }
    if (diagram.columns) {
      lines.push(`\n| ${diagram.columns.join(" | ")} |`, `| ${diagram.columns.map(() => "---").join(" | ")} |`);
      lines.push(...(diagram.rows ?? []).map(row => `| ${row.join(" | ")} |`));
    }
    lines.push(...(diagram.notes ?? []).map(note => `\n${note}`));
    return lines.join("\n");
  });
}
