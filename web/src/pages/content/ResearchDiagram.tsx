import type { DiagramNode } from "./diagramTypes";
import { diagrams } from "./diagramData";

function DiagramTree({ nodes }: { nodes: DiagramNode[] }) {
  return <ul className="diagram-tree">{nodes.map((node, i) => <li key={i}><span>{node.label}</span>{node.children && <DiagramTree nodes={node.children} />}</li>)}</ul>;
}

/** Semantic tables and flows retain the original figures' labels without bitmap text. */
export function ResearchDiagram({ id }: { id: string }) {
  const diagram = diagrams[id];
  if (!diagram) throw new Error(`Unknown research diagram: ${id}`);
  return <figure aria-labelledby={`${id}-title`}>
    <figcaption id={`${id}-title`}>{diagram.title}</figcaption>
    {diagram.panels && <div className="diagram-columns">{diagram.panels.map((panel, i) => <section className="diagram-panel" key={i}>
      {panel.heading && <h4>{panel.heading}</h4>}
      {panel.tree && <DiagramTree nodes={panel.tree} />}
      {panel.steps && <ol className="diagram-flow">{panel.steps.map((step, j) => <li className="diagram-step" key={j}>{step}</li>)}</ol>}
      {panel.lines?.map((line, j) => <p key={j}>{line}</p>)}
    </section>)}</div>}
    {diagram.columns && <table><thead><tr>{diagram.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{diagram.rows?.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th scope="row" key={j}>{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table>}
    {diagram.notes?.map((note, i) => <p key={i}>{note}</p>)}
  </figure>;
}
