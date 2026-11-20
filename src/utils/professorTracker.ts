import type { BoardStep } from '../types/board.ts';

const STOP_WORDS = new Set([
  'les',
  'des',
  'une',
  'uns',
  'est',
  'sont',
  'pour',
  'dans',
  'avec',
  'sur',
  'par',
  'qui',
  'que',
  'quoi',
  'dont',
  'mais',
  'donc',
  'alors',
  'cette',
  'cet',
  'ces',
  'mon',
  'ton',
  'son',
  'nous',
  'vous',
  'ils',
  'elles',
  'plus',
  'tres',
  'tout',
  'tous',
  'comme',
  'ainsi',
  'voici',
  'voila',
  'maintenant',
  'ensuite',
  'puis',
  'etape',
]);

export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[$`*_\\{}]/g, ' ')
    .replace(/[^a-z0-9=+\-*/<>.,:\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTokens(raw: string): string[] {
  const cleaned = normalizeText(raw);
  const matches = cleaned.match(/[a-z0-9]+/g) ?? [];
  return matches.filter((tok) => {
    if (/^\d+$/.test(tok)) return true;
    if (tok.length >= 3 && !STOP_WORDS.has(tok)) return true;
    return false;
  });
}

export function extractBoardLines(step: BoardStep): string[] {
  let rawContent = step.content;
  if (step.step_type === 'code') {
    rawContent = rawContent
      .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
      .replace(/\n?```$/, '')
      .trimEnd();
  }

  return rawContent
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function detectMentionedStep(recentSpeech: string, steps: BoardStep[]): BoardStep | null {
  if (steps.length === 0) return null;
  const normSpeech = normalizeText(recentSpeech);

  // Explicit "etape X" mention
  const stepMatch = normSpeech.match(/\betape\s+(\d+)\b/);
  if (stepMatch) {
    const num = Number(stepMatch[1]);
    const found = steps.find((s) => s.step_number === num);
    if (found) return found;
  }

  // Check if recent speech strongly references a specific step title
  const speechTokens = new Set(extractTokens(recentSpeech));
  if (speechTokens.size === 0) return null;

  let bestStep: BoardStep | null = null;
  let bestOverlap = 0;

  for (const step of steps) {
    const titleTokens = extractTokens(step.title);
    let overlap = 0;
    for (const tok of titleTokens) {
      if (speechTokens.has(tok)) overlap += 1;
    }
    if (overlap >= 2 && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestStep = step;
    }
  }

  return bestStep;
}

export function findBestMatchingLine(
  recentSpeech: string,
  step: BoardStep,
  currentLine: number,
): { lineNumber: number; score: number } | null {
  const lines = extractBoardLines(step);
  if (lines.length <= 1) return null;

  // Focus on the tail of the professor's speech (most recent clause)
  const tailSpeech = recentSpeech.slice(-140);
  const speechTokens = extractTokens(tailSpeech);
  if (speechTokens.length === 0) return null;

  const speechSet = new Set(speechTokens);
  const normTail = normalizeText(tailSpeech);

  let bestLine = currentLine;
  let bestScore = 0;
  let currentScore = 0;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const lineTokens = extractTokens(line);
    let score = 0;

    for (const tok of lineTokens) {
      if (speechSet.has(tok)) {
        // Numbers and distinct longer words carry higher matching signal
        score += /^\d+$/.test(tok) ? 2.2 : tok.length >= 5 ? 2 : 1.2;
      }
    }

    // Bonus for explicit "ligne X" or "cas X"
    if (
      normTail.includes(`ligne ${lineNum}`) ||
      normTail.includes(`cas ${lineNum}`) ||
      normTail.includes(`cas 0${lineNum}`)
    ) {
      score += 5;
    }

    if (lineNum === currentLine) {
      currentScore = score;
    }

    if (score > bestScore) {
      bestScore = score;
      bestLine = lineNum;
    }
  });

  // Require clear improvement over the current line to avoid jitter
  if (bestScore >= 1.5 && bestLine !== currentLine && bestScore > currentScore + 0.5) {
    return { lineNumber: bestLine, score: bestScore };
  }

  return null;
}
