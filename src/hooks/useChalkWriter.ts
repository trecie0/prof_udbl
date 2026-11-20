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

    // Writing speed: ~68 characters per second (snappy yet clearly visible)
    const titleDurationMs = Math.max(220, (title.length / 68) * 1000);
    const lineDurationsMs = lines.map((line) =>
      Math.max(280, Math.min(950, (line.length / 68) * 1000)),
    );

    let phase: 'title' | 'lines' | 'done' = 'title';
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
          phase = 'lines';
          currentLineIdx = 0;
          elapsedInPhase = 0;
        }
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (phase === 'lines') {
        const duration = lineDurationsMs[currentLineIdx] ?? 320;
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
          currentLineIdx += 1;
          elapsedInPhase = 0;
          if (currentLineIdx >= lines.length) {
            phase = 'done';
            setState(buildImmediateState(title, lines));
            return;
          }
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
