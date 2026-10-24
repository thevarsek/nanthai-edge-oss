export interface DiagramNode {
  label: string;
  children?: DiagramNode[];
}
export interface DiagramPanel {
  heading?: string;
  steps?: string[];
  tree?: DiagramNode[];
  lines?: string[];
}
export interface Diagram {
  title: string;
  panels?: DiagramPanel[];
  columns?: string[];
  rows?: string[][];
  notes?: string[];
}
