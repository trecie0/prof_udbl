import { useEffect, useState } from 'react';

export interface LineRevealState {
  chars: number;
  progress: number;
  done: boolean;
}

export interface ChalkWritingState {
  isWriting: boolean;
  writingTarget: 'title' | 'line' | null;
  activeWriteLineIndex: number | null;
  activeWriteProgress: number;
  visibleTitle: string;
  lineStates: LineRevealState[];
}

interface UseChalkWriterOptions {
  stepSignature: string;
  title: string;
  lines: string[];
  shouldAnimate: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function buildImmediateState(title: string, lines: string[]): ChalkWritingState {
  return {
    isWriting: false,
    writingTarget: null,
    activeWriteLineIndex: null,
    activeWriteProgress: 1,
    visibleTitle: title,
    lineStates: lines.map((line) => ({
      chars: line.length,
      progress: 1,
      done: true,
    })),
  };
}

// Calm, deliberate blackboard handwriting cadence (~28 characters/second) with breathing pauses
const CHARS_PER_SECOND = 28;
const TITLE_PAUSE_MS = 350;
const LINE_PAUSE_MS = 450;

function computeTitleDurationMs(title: string): number {
  return Math.max(450, Math.min(2000, (title.length / CHARS_PER_SECOND) * 1000));
}

function computeLineDurationMs(line: string): number {
  return Math.max(600, Math.min(2600, (line.length / CHARS_PER_SECOND) * 1000));
}

export function estimateChalkWritingDurationMs(title: string, lines: string[]): number {
  if (prefersReducedMotion()) return 250;
  const titleMs = computeTitleDurationMs(title);
  if (lines.length === 0) return titleMs;
  const linesMs = lines.reduce((acc, line) => acc + computeLineDurationMs(line), 0);
  const pausesMs = TITLE_PAUSE_MS + Math.max(0, lines.length - 1) * LINE_PAUSE_MS;
  return Math.round(titleMs + linesMs + pausesMs);
}

export function useChalkWriter({
  stepSignature,
  title,
  lines,
  shouldAnimate,
}: UseChalkWriterOptions): ChalkWritingState {
  const [state, setState] = useState<ChalkWritingState>(() =>
    shouldAnimate && !prefersReducedMotion()
      ? {
          isWriting: true,
          writingTarget: 'title',
          activeWriteLineIndex: null,
          activeWriteProgress: 0,
          visibleTitle: '',
          lineStates: lines.map(() => ({ chars: 0, progress: 0, done: false })),
        }
      : buildImmediateState(title, lines),
  );

  useEffect(() => {
    if (!shouldAnimate || prefersReducedMotion()) {
      setState(buildImmediateState(title, lines));
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();

    const titleDurationMs = computeTitleDurationMs(title);
    const lineDurationsMs = lines.map((line) => computeLineDurationMs(line));

    let phase: 'title' | 'title_pause' | 'lines' | 'line_pause' | 'done' = 'title';
    let elapsedInPhase = 0;
    let currentLineIdx = 0;

    setState({
      isWriting: true,
      writingTarget: 'title',
      activeWriteLineIndex: null,
      activeWriteProgress: 0,
      visibleTitle: '',
      lineStates: lines.map(() => ({ chars: 0, progress: 0, done: false })),
    });

    const tick = (now: number) => {
      const dt = Math.min(50, now - lastTime);
      lastTime = now;
      elapsedInPhase += dt;

      if (phase === 'title') {
        const progress = Math.min(1, elapsedInPhase / titleDurationMs);
        const chars = Math.round(progress * title.length);
        setState({
          isWriting: true,
          writingTarget: 'title',
          activeWriteLineIndex: null,
          activeWriteProgress: progress,
          visibleTitle: title.slice(0, chars),
          lineStates: lines.map(() => ({ chars: 0, progress: 0, done: false })),
        });

        if (progress >= 1) {
          if (lines.length === 0) {
            phase = 'done';
            setState(buildImmediateState(title, lines));
            return;
          }
          phase = 'title_pause';
          elapsedInPhase = 0;
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (phase === 'title_pause') {
        if (elapsedInPhase >= TITLE_PAUSE_MS) {
          phase = 'lines';
          currentLineIdx = 0;
          elapsedInPhase = 0;
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (phase === 'lines') {
        const duration = lineDurationsMs[currentLineIdx] ?? 700;
        const lineProgress = Math.min(1, elapsedInPhase / duration);

        setState({
          isWriting: true,
          writingTarget: 'line',
          activeWriteLineIndex: currentLineIdx,
          activeWriteProgress: lineProgress,
          visibleTitle: title,
          lineStates: lines.map((line, idx) => {
            if (idx < currentLineIdx) {
              return { chars: line.length, progress: 1, done: true };
            }
            if (idx === currentLineIdx) {
              return {
                chars: Math.round(lineProgress * line.length),
                progress: lineProgress,
                done: lineProgress >= 1,
              };
            }
            return { chars: 0, progress: 0, done: false };
          }),
        });

        if (lineProgress >= 1) {
          if (currentLineIdx + 1 >= lines.length) {
            phase = 'done';
            setState(buildImmediateState(title, lines));
            return;
          }
          phase = 'line_pause';
          elapsedInPhase = 0;
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (phase === 'line_pause') {
        if (elapsedInPhase >= LINE_PAUSE_MS) {
          currentLineIdx += 1;
          phase = 'lines';
          elapsedInPhase = 0;
        }
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSignature, shouldAnimate]);

  return state;
}
