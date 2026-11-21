import { useEffect, useRef } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'motion/react';
import type { BoardStep } from '../types/board.ts';
import { buildLessonScene } from '../utils/lessonScene.ts';

interface BoardMotionSceneProps {
  step: BoardStep;
  activeLineNumber: number;
  playbackSpeed: number;
  isPaused: boolean;
  subject?: string;
}

function readableText(value: string | undefined): string {
  return String(value || '')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\\times/g, '×')
    .replace(/\\cdot/g, '·')
    .replace(/\\to/g, '→')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .trim();
}

export function BoardMotionScene({
  step,
  activeLineNumber,
  playbackSpeed,
  isPaused,
  subject,
}: BoardMotionSceneProps) {
  const scene = buildLessonScene(step, activeLineNumber, subject);
  const reducedMotion = useReducedMotion();
  const controls = useAnimationControls();
  const pathControls = useAnimationControls();
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const sceneKey = `${step.step_number}:${scene.kind}:${scene.activeIndex}:${scene.currentLine}`;

  useEffect(() => {
    controls.stop();
    if (reducedMotion || isPausedRef.current) {
      controls.set({ opacity: 1, y: 0 });
      pathControls.set({ pathLength: 1 });
      return;
    }
    controls.set({ opacity: 0.35, y: 8 });
    pathControls.set({ pathLength: 0 });
  }, [controls, pathControls, reducedMotion, sceneKey]);

  useEffect(() => {
    if (reducedMotion) return;
    if (isPaused) {
      controls.stop();
      return;
    }
    void controls.start({
      opacity: 1,
      y: 0,
      transition: { duration: Math.min(1.4, 0.8 / playbackSpeed), ease: 'easeOut' },
    });
  }, [controls, isPaused, playbackSpeed, reducedMotion, sceneKey]);

  useEffect(() => {
    if (reducedMotion) return;
    if (isPaused) {
      pathControls.stop();
      return;
    }
    void pathControls.start({
      pathLength: 1,
      transition: { duration: Math.min(1.4, 0.8 / playbackSpeed), ease: 'easeInOut' },
    });
  }, [isPaused, pathControls, playbackSpeed, reducedMotion, sceneKey]);

  const edge = scene.activeEdge;

  return (
    <section
      aria-label={`Visualisation pédagogique ${scene.kind}`}
      className="min-h-36 rounded-xl border border-[#E2DDD2] bg-[#FAF8F3] p-4 flex flex-col justify-center gap-4"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-stone-600">
          VISUALISATION · {scene.kind.toUpperCase()}
        </span>
        <span className="font-mono-code tabular-nums text-[11px] font-semibold text-rose-700">
          Ligne {scene.activeIndex + 1}
        </span>
      </header>

      <motion.div animate={controls} className="min-h-16 flex items-center justify-center">
        {scene.kind === 'schema' && edge ? (
          <div className="w-full flex items-center justify-center gap-2">
            <span className="max-w-[38%] rounded-lg border border-[#D3C6B0] bg-white px-3 py-2 text-center font-handwriting font-bold text-stone-900">
              {readableText(edge.from)}
            </span>
            <div className="relative min-w-8 flex-1">
              <svg viewBox="0 0 180 28" className="h-7 w-full overflow-visible" aria-hidden="true">
                <motion.path
                  d="M 2 14 H 168 L 158 6 M 168 14 L 158 22"
                  fill="none"
                  stroke="#1D4ED8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={false}
                  animate={pathControls}
                />
              </svg>
              {edge.label && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 max-w-full truncate text-center text-[10px] font-medium text-blue-900">
                  {readableText(edge.label)}
                </span>
              )}
            </div>
            <span className="max-w-[38%] rounded-lg border border-blue-700/70 bg-white px-3 py-2 text-center font-handwriting font-bold text-blue-900">
              {readableText(edge.to)}
            </span>
          </div>
        ) : scene.kind === 'calculation' ? (
          <div className="w-full flex items-center justify-center gap-3">
            <span className="min-w-0 flex-1 break-words text-center font-mono-code text-sm font-bold text-blue-800">
              {readableText(scene.before)}
            </span>
            <span className="text-xl font-extrabold text-rose-700">→</span>
            <span className="min-w-0 flex-1 break-words text-center font-mono-code text-sm font-bold text-emerald-800">
              {readableText(scene.after || scene.currentLine)}
            </span>
          </div>
        ) : scene.kind === 'code' ? (
          <div className="w-full space-y-2 rounded-lg bg-stone-900 p-3">
            {scene.variables?.length ? (
              scene.variables.map((item) => (
                <motion.div
                  key={item.name}
                  layout
                  className="flex items-center gap-3 rounded-md bg-white/10 px-2.5 py-1.5 font-mono-code text-sm"
                >
                  <span className="min-w-8 font-bold text-blue-200">{item.name}</span>
                  <span className="text-rose-300">←</span>
                  <span className="min-w-0 break-all text-stone-100">{readableText(item.value)}</span>
                </motion.div>
              ))
            ) : (
              <p className="text-center text-xs text-stone-300">
                Suivez les affectations pour voir évoluer la mémoire.
              </p>
            )}
          </div>
        ) : scene.kind === 'example' ? (
          <div className="w-full flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-center font-semibold text-stone-900">
              {readableText(scene.input)}
            </span>
            <span className="text-xl font-extrabold text-emerald-700">→</span>
            {scene.process && (
              <>
                <span className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-900">
                  {readableText(scene.process)}
                </span>
                <span className="text-xl font-extrabold text-emerald-700">→</span>
              </>
            )}
            <span className="rounded-lg border border-emerald-700/50 bg-white px-3 py-2 text-center font-bold text-emerald-800">
              {readableText(scene.result || scene.currentLine)}
            </span>
          </div>
        ) : (
          <p className="w-full border-l-[3px] border-amber-600 pl-3 font-handwriting text-base font-semibold leading-relaxed text-stone-900">
            {readableText(scene.currentLine)}
          </p>
        )}
      </motion.div>
    </section>
  );
}
