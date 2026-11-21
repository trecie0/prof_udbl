import { useState, type ReactNode } from 'react';
import katex from 'katex';
import { ArrowRight, Check, Copy } from 'lucide-react';
import type { ChalkWritingState } from '../hooks/useChalkWriter.ts';
import type { StepType } from '../types/board.ts';

interface StepContentRendererProps {
  stepType: StepType;
  content: string;
  activeLineNumber?: number | null;
  writingState?: ChalkWritingState;
}

function renderKatexMarkup(expression: string, displayMode: boolean): string {
  return katex.renderToString(expression, {
    displayMode,
    throwOnError: false,
    strict: false,
    trust: false,
  });
}

function renderInlineFormattedText(
  text: string,
  keyPrefix: string,
  isPartial = false,
): ReactNode[] {
  if (isPartial) {
    // While actively typing characters, strip unfinished markdown/LaTeX delimiters cleanly
    return [<span key={`${keyPrefix}-partial`}>{text.replace(/[$`*_]/g, '')}</span>];
  }

  const tokenRegex = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`\n]+`)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;
    if (part.startsWith('$$') && part.endsWith('$$') && part.length > 4) {
      const expr = part.slice(2, -2).trim();
      return (
        <span
          key={key}
          className="inline-block align-middle mx-1"
          dangerouslySetInnerHTML={{ __html: renderKatexMarkup(expr, false) }}
        />
      );
    }
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const expr = part.slice(1, -1).trim();
      return (
        <span
          key={key}
          className="inline-block align-middle mx-0.5"
          dangerouslySetInnerHTML={{ __html: renderKatexMarkup(expr, false) }}
        />
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong
          key={key}
          className="font-bold text-stone-950 underline decoration-blue-700/45 decoration-2 underline-offset-4"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="font-mono-code text-[0.86em] px-1.5 py-0.5 rounded bg-stone-200/70 text-blue-900 border border-stone-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

interface LineRenderProps {
  activeLineNumber?: number | null;
  writingState?: ChalkWritingState;
}

function ChalkCaret() {
  return (
    <span
      data-chalk-tip="true"
      aria-hidden="true"
      className="inline-block w-0.5 h-5 align-middle bg-stone-900/70 ml-0.5"
    />
  );
}

function splitExpressionAndJustification(rawLine: string): {
  expression: string;
  justification: string | null;
} {
  // Split on ` | ` or ` :: ` while ignoring LaTeX `||` norms
  const match = rawLine.match(/^(.+?)\s+(?:\|(?!\|)|::)\s+(.+)$/);
  if (!match) {
    return { expression: rawLine, justification: null };
  }
  return {
    expression: match[1].trim(),
    justification: match[2].trim(),
  };
}

function CalculRenderer({ content, activeLineNumber, writingState }: { content: string } & LineRenderProps) {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return <p className="text-stone-500 text-sm italic">Aucun calcul saisi.</p>;
  }

  return (
    <div className="space-y-4">
      {lines.map((rawLine, index) => {
        const lineNum = index + 1;
        const reveal = writingState?.lineStates[index];
        const isActivelyWritingThisLine =
          Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === index;

        if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
          return null;
        }

        const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;
        const { expression, justification } = splitExpressionAndJustification(rawLine);

        const exprLen = expression.length;
        const shownChars = reveal && !reveal.done ? reveal.chars : rawLine.length;
        const shownExpr =
          reveal && !reveal.done ? expression.slice(0, Math.min(exprLen, shownChars)) : expression;
        const justificationOffset = rawLine.length - (justification?.length ?? 0);
        const shownJustification =
          justification && reveal && !reveal.done
            ? shownChars > justificationOffset
              ? justification.slice(0, shownChars - justificationOffset)
              : ''
            : justification;

        const cleanDisplay =
          expression.startsWith('$$') && expression.endsWith('$$')
            ? expression.slice(2, -2).trim()
            : null;

        const looksLikeLatex =
          cleanDisplay !== null ||
          /\\(frac|sqrt|sum|int|prod|alpha|beta|gamma|delta|Delta|pm|times|cdot|leq|geq|neq|approx|rightarrow|Rightarrow|iff|equiv|neg|land|lor)/.test(
            expression,
          ) ||
          (/\^|_/.test(expression) && /[=+\-*/]/.test(expression));

        const baseHighlight = isPointed
          ? 'bg-amber-200/35 border-amber-600/65 ring-1 ring-amber-500/35'
          : 'bg-white/70 border-stone-300/85';

        const lineTag = (
          <span className="font-mono-code tabular-nums text-xs font-semibold text-stone-500 shrink-0 pt-1">
            L{lineNum}
          </span>
        );

        if (cleanDisplay !== null || looksLikeLatex) {
          const latexExpr = cleanDisplay ?? expression.replace(/^\$|\$$/g, '');
          const exprProgress =
            reveal && !reveal.done
              ? Math.min(100, Math.round((shownExpr.length / Math.max(1, exprLen)) * 100))
              : 100;
          const clipRight = Math.max(0, 100 - exprProgress);

          return (
            <div
              key={index}
              data-line-index={lineNum}
              className={`rounded-lg border px-4 py-3.5 transition-colors ${baseHighlight}`}
            >
              <div className="flex items-start gap-3">
                {lineTag}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="relative overflow-x-auto">
                    <div
                      style={
                        writingState?.isWriting && reveal && !reveal.done
                          ? { clipPath: `inset(0 ${clipRight}% 0 0)` }
                          : undefined
                      }
                      dangerouslySetInnerHTML={{ __html: renderKatexMarkup(latexExpr, true) }}
                    />
                    {isActivelyWritingThisLine && !shownJustification && (
                      <span
                        data-chalk-tip="true"
                        aria-hidden="true"
                        style={{ left: `${Math.min(92, Math.max(8, exprProgress))}%` }}
                        className="absolute top-1/2 -translate-y-1/2 w-0.5 h-6 bg-stone-900/60"
                      />
                    )}
                  </div>

                  {shownJustification && (
                    <p className="text-sm sm:text-[15px] text-stone-700 leading-relaxed pt-1 border-t border-stone-200/80">
                      <span className="font-medium text-blue-800 mr-1.5">Pourquoi :</span>
                      <span>{shownJustification}</span>
                      {isActivelyWritingThisLine && <ChalkCaret />}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        }

        const isEquationLine = /[=≈<>]/.test(expression);

        return (
          <div
            key={index}
            data-line-index={lineNum}
            className={`rounded-lg border px-4 py-3 transition-colors ${baseHighlight}`}
          >
            <div className="flex items-start gap-3">
              {lineTag}
              <div className="flex-1 min-w-0 space-y-1">
                <div
                  className={
                    isEquationLine
                      ? 'font-handwriting text-xl sm:text-2xl font-bold text-stone-900 tracking-wide'
                      : 'font-handwriting text-lg sm:text-xl leading-relaxed text-stone-900'
                  }
                >
                  <span>
                    {isEquationLine
                      ? shownExpr
                      : renderInlineFormattedText(
                          shownExpr,
                          `calc-${index}`,
                          Boolean(reveal && !reveal.done && shownExpr.length < exprLen),
                        )}
                  </span>
                  {isActivelyWritingThisLine && !shownJustification && <ChalkCaret />}
                </div>

                {shownJustification && (
                  <p className="text-sm sm:text-[15px] text-stone-700 leading-relaxed pt-1 border-t border-stone-200/80">
                    <span className="font-medium text-blue-800 mr-1.5">Pourquoi :</span>
                    <span>{shownJustification}</span>
                    {isActivelyWritingThisLine && <ChalkCaret />}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface SchemaEdge {
  from: string;
  to: string;
  label?: string;
}

function parseSchemaContent(content: string): { edges: SchemaEdge[]; notes: string[] } {
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const edges: SchemaEdge[] = [];
  const notes: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-•*]\s+/, '');
    const arrowMatch = cleaned.match(/(.+?)\s*(?:-->|=>|->|→)\s*(.+)/);
    if (arrowMatch) {
      const left = arrowMatch[1].trim();
      const rightFull = arrowMatch[2].trim();

      const chainParts = cleaned.split(/\s*(?:-->|=>|->|→)\s*/);
      if (chainParts.length > 2) {
        for (let i = 0; i < chainParts.length - 1; i++) {
          const targetRaw = chainParts[i + 1].trim();
          const colonIdx = i === chainParts.length - 2 ? targetRaw.indexOf(':') : -1;
          if (colonIdx > 0) {
            edges.push({
              from: chainParts[i].trim(),
              to: targetRaw.slice(0, colonIdx).trim(),
              label: targetRaw.slice(colonIdx + 1).trim(),
            });
          } else {
            edges.push({ from: chainParts[i].trim(), to: targetRaw });
          }
        }
      } else {
        const colonIdx = rightFull.indexOf(':');
        if (colonIdx > 0) {
          edges.push({
            from: left,
            to: rightFull.slice(0, colonIdx).trim(),
            label: rightFull.slice(colonIdx + 1).trim(),
          });
        } else {
          edges.push({ from: left, to: rightFull });
        }
      }
    } else {
      notes.push(cleaned);
    }
  }

  return { edges, notes };
}

function SchemaRenderer({ content, activeLineNumber, writingState }: { content: string } & LineRenderProps) {
  const { edges, notes } = parseSchemaContent(content);

  if (edges.length === 0) {
    return (
      <ProseRenderer
        content={content}
        activeLineNumber={activeLineNumber}
        writingState={writingState}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white/60 border border-stone-300/90 p-4 space-y-3">
        {edges.map((edge, idx) => {
          const lineNum = idx + 1;
          const reveal = writingState?.lineStates[idx];
          const isActivelyWritingThisLine =
            Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === idx;

          if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
            return null;
          }

          const progress = reveal ? reveal.progress : 1;
          const showArrow = progress >= 0.3;
          const showTarget = progress >= 0.6;
          const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;

          return (
            <div
              key={idx}
              data-line-index={lineNum}
              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg p-2 transition-colors ${
                isPointed ? 'bg-amber-200/35 ring-1 ring-amber-500/45' : ''
              }`}
            >
              <div className="px-3.5 py-2 rounded-lg bg-white border-2 border-stone-800/80 text-stone-900 font-handwriting text-base sm:text-lg font-bold shrink-0 max-w-full sm:max-w-[230px]">
                {edge.from}
                {isActivelyWritingThisLine && !showArrow && <ChalkCaret />}
              </div>

              {showArrow && (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="hidden sm:flex items-center flex-1 min-w-[28px]">
                    <svg
                      className="w-full h-5 text-blue-700"
                      viewBox="0 0 120 20"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <line
                        x1="2"
                        y1="10"
                        x2="108"
                        y2="10"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeDasharray={edge.label ? '5 3' : undefined}
                      />
                      <polygon points="105,4 118,10 105,16" fill="currentColor" />
                    </svg>
                  </div>
                  <ArrowRight className="w-4 h-4 text-blue-700 sm:hidden shrink-0" aria-hidden="true" />
                  {edge.label && (
                    <span className="font-handwriting text-sm sm:text-base text-blue-800 font-bold px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                      {edge.label}
                    </span>
                  )}
                  {isActivelyWritingThisLine && showArrow && !showTarget && <ChalkCaret />}
                </div>
              )}

              {showTarget && (
                <div className="px-3.5 py-2 rounded-lg bg-white border-2 border-blue-700/80 text-stone-900 font-handwriting text-base sm:text-lg font-bold shrink-0 max-w-full sm:max-w-[230px]">
                  {edge.to}
                  {isActivelyWritingThisLine && showTarget && <ChalkCaret />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {notes.length > 0 && (
        <div className="space-y-1.5 font-handwriting text-lg text-stone-800">
          {notes.map((note, idx) => {
            const lineIdx = edges.length + idx;
            const lineNum = lineIdx + 1;
            const reveal = writingState?.lineStates[lineIdx];
            const isActivelyWritingThisLine =
              Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === lineIdx;
            if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
              return null;
            }
            const shownNote = reveal && !reveal.done ? note.slice(0, reveal.chars) : note;
            const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;
            return (
              <p
                key={idx}
                data-line-index={lineNum}
                className={`leading-relaxed rounded-md px-2.5 py-1 transition-colors ${
                  isPointed ? 'bg-amber-200/35 ring-1 ring-amber-500/40' : ''
                }`}
              >
                {renderInlineFormattedText(shownNote, `schema-note-${idx}`, Boolean(reveal && !reveal.done))}
                {isActivelyWritingThisLine && <ChalkCaret />}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExempleRenderer({ content, activeLineNumber, writingState }: { content: string } & LineRenderProps) {
  const lines = content
    .split('\n')
    .map((l) => l.trim().replace(/^[-•*]\s+/, ''))
    .filter(Boolean);

  if (lines.length === 0) {
    return <p className="text-stone-500 text-sm italic">Aucun exemple saisi.</p>;
  }

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const lineNum = index + 1;
        const reveal = writingState?.lineStates[index];
        const isActivelyWritingThisLine =
          Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === index;

        if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
          return null;
        }

        const shownLine = reveal && !reveal.done ? line.slice(0, reveal.chars) : line;
        const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;
        const arrowSplit = shownLine.split(/\s*(?:-->|=>|->|→)\s*/);
        const isPartial = Boolean(reveal && !reveal.done);

        return (
          <div
            key={index}
            data-line-index={lineNum}
            className={`rounded-lg border px-4 py-3 transition-colors flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 ${
              isPointed
                ? 'bg-amber-200/35 border-amber-600/65 ring-1 ring-amber-500/35'
                : 'bg-white/70 border-emerald-700/30'
            }`}
          >
            <span className="font-mono-code text-xs font-semibold text-emerald-800 shrink-0">
              Cas {String(lineNum).padStart(2, '0')}
            </span>

            {arrowSplit.length >= 2 ? (
              <div className="flex flex-wrap items-center gap-2.5 font-handwriting text-lg sm:text-xl text-stone-900">
                <span className="font-bold">
                  {renderInlineFormattedText(arrowSplit[0], `ex-in-${index}`, isPartial)}
                </span>
                <ArrowRight className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <span className="font-bold text-emerald-800">
                  {renderInlineFormattedText(arrowSplit.slice(1).join(' → '), `ex-out-${index}`, isPartial)}
                </span>
                {isActivelyWritingThisLine && <ChalkCaret />}
              </div>
            ) : (
              <p className="font-handwriting text-lg sm:text-xl text-stone-900 leading-relaxed">
                {renderInlineFormattedText(shownLine, `ex-line-${index}`, isPartial)}
                {isActivelyWritingThisLine && <ChalkCaret />}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CODE_KEYWORDS = new Set([
  'def',
  'return',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'in',
  'import',
  'from',
  'as',
  'class',
  'function',
  'const',
  'let',
  'var',
  'async',
  'await',
  'try',
  'catch',
  'True',
  'False',
  'None',
  'true',
  'false',
  'null',
  'SELECT',
  'FROM',
  'WHERE',
]);

function highlightCodeLine(line: string, lineIndex: number): ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return <span className="text-stone-500 italic">{line}</span>;
  }

  const tokenRegex = /(".*?"|'.*?'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const segments = line.split(tokenRegex);

  return segments.map((seg, idx) => {
    const key = `${lineIndex}-${idx}`;
    if ((seg.startsWith('"') && seg.endsWith('"')) || (seg.startsWith("'") && seg.endsWith("'"))) {
      return (
        <span key={key} className="text-emerald-700">
          {seg}
        </span>
      );
    }
    if (/^\d+(?:\.\d+)?$/.test(seg)) {
      return (
        <span key={key} className="text-amber-700 font-medium">
          {seg}
        </span>
      );
    }
    if (CODE_KEYWORDS.has(seg)) {
      return (
        <span key={key} className="text-blue-700 font-semibold">
          {seg}
        </span>
      );
    }
    return <span key={key}>{seg}</span>;
  });
}

function CodeRenderer({ content, activeLineNumber, writingState }: { content: string } & LineRenderProps) {
  const [copied, setCopied] = useState(false);

  const cleanCode = content
    .replace(/^```[a-zA-Z0-9_-]*\n?/, '')
    .replace(/\n?```$/, '')
    .trimEnd();

  const lines = cleanCode.split('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleanCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="rounded-lg bg-[#F5F2EB] border border-[#D8D0C0] overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[#E2DDD2] bg-[#ECE7DC]">
        <span className="text-xs text-stone-600 font-mono-code">Extrait de code</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handleCopy();
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-stone-700 hover:text-stone-950 hover:bg-stone-200/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-700" />
              <span>Copié</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-stone-500" />
              <span>Copier</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto font-mono-code text-[13.5px] leading-6 text-stone-900 space-y-0.5">
        {lines.map((line, i) => {
          const lineNum = i + 1;
          const reveal = writingState?.lineStates[i];
          const isActivelyWritingThisLine =
            Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === i;

          if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
            return null;
          }

          const shownLine = reveal && !reveal.done ? line.slice(0, reveal.chars) : line;
          const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;

          return (
            <div
              key={i}
              data-line-index={lineNum}
              className={`flex gap-4 px-2 py-0.5 rounded transition-colors ${
                isPointed ? 'bg-amber-200/45 ring-1 ring-amber-500/45' : ''
              }`}
            >
              <span className="select-none text-stone-400 w-6 text-right shrink-0">{lineNum}</span>
              <pre className="whitespace-pre font-mono-code">
                {highlightCodeLine(shownLine, i)}
                {isActivelyWritingThisLine && <ChalkCaret />}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProseRenderer({ content, activeLineNumber, writingState }: { content: string } & LineRenderProps) {
  const lines = content
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  return (
    <div className="space-y-3.5 font-handwriting text-[19px] sm:text-[21px] leading-relaxed text-stone-900">
      {lines.map((line, index) => {
        const lineNum = index + 1;
        const reveal = writingState?.lineStates[index];
        const isActivelyWritingThisLine =
          Boolean(writingState?.isWriting) && writingState?.activeWriteLineIndex === index;

        if (writingState?.isWriting && reveal && reveal.progress <= 0 && !isActivelyWritingThisLine) {
          return null;
        }

        const shownLine = reveal && !reveal.done ? line.slice(0, reveal.chars) : line;
        const isPointed = !writingState?.isWriting && activeLineNumber === lineNum;
        const trimmed = shownLine.trim();
        const isPartial = Boolean(reveal && !reveal.done);
        const highlightCls = isPointed
          ? 'bg-amber-200/35 ring-1 ring-amber-500/45 rounded-lg px-3 py-2'
          : 'rounded-lg px-2 py-1';

        const { expression: fullExpr, justification: fullJustif } = splitExpressionAndJustification(
          line.trim().replace(/^[-•*]\s+/, ''),
        );
        const shownClean = trimmed.replace(/^[-•*]\s*/, '');
        const splitShown = fullJustif
          ? splitExpressionAndJustification(shownClean)
          : { expression: shownClean, justification: null };

        if (/^[-•*]\s+/.test(line.trim())) {
          return (
            <div
              key={index}
              data-line-index={lineNum}
              className={`flex items-start gap-2.5 transition-colors ${highlightCls}`}
            >
              <span className="text-blue-700 mt-1 text-base select-none font-bold" aria-hidden="true">
                •
              </span>
              <div className="flex-1 space-y-0.5">
                <p>
                  {renderInlineFormattedText(
                    splitShown.expression,
                    `list-${index}`,
                    isPartial && splitShown.expression.length < fullExpr.length,
                  )}
                  {isActivelyWritingThisLine && !splitShown.justification && <ChalkCaret />}
                </p>
                {splitShown.justification && (
                  <p className="font-sans text-sm text-stone-600 leading-relaxed">
                    <span className="font-medium text-blue-800 mr-1">Pourquoi :</span>
                    {splitShown.justification}
                    {isActivelyWritingThisLine && <ChalkCaret />}
                  </p>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            key={index}
            data-line-index={lineNum}
            className={`leading-relaxed transition-colors space-y-0.5 ${highlightCls}`}
          >
            <p>
              {renderInlineFormattedText(
                splitShown.expression,
                `prose-${index}`,
                isPartial && splitShown.expression.length < fullExpr.length,
              )}
              {isActivelyWritingThisLine && !splitShown.justification && <ChalkCaret />}
            </p>
            {splitShown.justification && (
              <p className="font-sans text-sm text-stone-600 leading-relaxed">
                <span className="font-medium text-blue-800 mr-1">Pourquoi :</span>
                {splitShown.justification}
                {isActivelyWritingThisLine && <ChalkCaret />}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StepContentRenderer({
  stepType,
  content,
  activeLineNumber,
  writingState,
}: StepContentRendererProps) {
  switch (stepType) {
    case 'calcul':
      return (
        <CalculRenderer
          content={content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />
      );
    case 'schema':
      return (
        <SchemaRenderer
          content={content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />
      );
    case 'code':
      return (
        <CodeRenderer
          content={content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />
      );
    case 'exemple':
      return (
        <ExempleRenderer
          content={content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />
      );
    case 'synthese':
    case 'etape':
    default:
      return (
        <ProseRenderer
          content={content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />
      );
  }
}
