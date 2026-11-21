import type { BoardStep } from '../types/board.ts';

export interface LessonScene {
  kind: 'code' | 'schema' | 'example' | 'calculation' | 'concept';
  currentLine: string;
  activeIndex: number;
  variables?: Array<{ name: string; value: string }>;
  edges?: Array<{ from: string; to: string; label: string }>;
  activeEdge?: { from: string; to: string; label: string };
  input?: string;
  process?: string;
  result?: string;
  before?: string;
  after?: string;
}

export function buildLessonScene(
  step: Pick<BoardStep, 'step_type' | 'title' | 'content'>,
  activeLineNumber = 1,
  subject = '',
): LessonScene {
  let content = step.content;
  if (step.step_type === 'code') {
    content = content.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trimEnd();
  }
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const activeIndex = Math.max(0, Math.min(lines.length - 1, Number(activeLineNumber || 1) - 1));
  const currentLine = lines[activeIndex] || step.title;
  const context = `${subject} ${step.title}`.toLowerCase();

  if (step.step_type === 'code') {
    const memory = new Map<string, string>();
    lines.slice(0, activeIndex + 1).forEach((line) => {
      const assignment = line.match(
        /^\s*(?:(?:let|const|var)\s+)?([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)\s*=\s*(.+?)\s*;?\s*$/,
      );
      if (assignment) {
        const names = assignment[1].split(/\s*,\s*/);
        const values = assignment[2].split(/\s*,\s*/);
        names.forEach((name, index) => memory.set(name, values[index] || assignment[2]));
      }
    });
    return {
      kind: 'code',
      currentLine,
      variables: [...memory].map(([name, value]) => ({ name, value })),
      activeIndex,
    };
  }

  const arrowMatch = currentLine.match(/^(.*?)\s*(?:-->|=>|->|→)\s*(.*)$/);
  if (step.step_type === 'exemple' || (step.step_type === 'synthese' && arrowMatch)) {
    const parts = currentLine.split(/\s*(?:-->|=>|->|→)\s*/).filter(Boolean);
    return {
      kind: 'example',
      currentLine,
      input: parts[0] || currentLine,
      process: parts.length > 2 ? parts.slice(1, -1).join(' → ') : '',
      result: parts.length > 1 ? parts[parts.length - 1] : '',
      activeIndex,
    };
  }

  if (step.step_type === 'schema' || arrowMatch || /logique|algorith/.test(context)) {
    const parsedEdges = lines
      .map((line) => {
        const match = line.match(/^(.*?)\s*(?:-->|=>|->|→)\s*(.*)$/);
        if (!match) return null;
        const [to, label] = match[2].split(/\s*:\s*/, 2);
        return { from: match[1].trim(), to: to.trim(), label: label?.trim() || '' };
      });
    if (!parsedEdges[activeIndex]) {
      return { kind: 'concept', currentLine, activeIndex };
    }
    const edges = parsedEdges.filter(
      (edge): edge is { from: string; to: string; label: string } => edge !== null,
    );
    return {
      kind: 'schema',
      currentLine,
      edges,
      activeEdge: parsedEdges[activeIndex] || undefined,
      activeIndex,
    };
  }

  const equation = currentLine.split(/\s*=\s*/);
  if (step.step_type === 'calcul' || equation.length > 1) {
    return {
      kind: 'calculation',
      currentLine,
      before: activeIndex > 0 ? lines[activeIndex - 1] : equation[0] || currentLine,
      after: activeIndex > 0 ? currentLine : equation.slice(1).join(' = '),
      activeIndex,
    };
  }

  return { kind: 'concept', currentLine, activeIndex };
}
