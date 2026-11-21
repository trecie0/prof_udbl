import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eraser,
  FlaskConical,
  GitBranch,
  GraduationCap,
  Layers,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { useChalkWriter } from '../hooks/useChalkWriter.ts';
import type { BoardPointer, BoardStep, CourseItem, LessonSession, StepType } from '../types/board.ts';
import { extractBoardLines } from '../utils/professorTracker.ts';
import { StepContentRenderer } from './StepContentRenderer.tsx';

interface TeacherBoardProps {
  session: LessonSession | null;
  activeCourse?: CourseItem | null;
  steps: BoardStep[];
  activePointer: BoardPointer | null;
  animatedStepSignatures: Set<string>;
  isTeacherSpeaking: boolean;
  isSimulating: boolean;
  isLoading: boolean;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenCourseMenu?: () => void;
  onClearBoard: () => void;
  onHighlightStep: (step: BoardStep) => void;
  onRenameSession: (title: string) => void;
  onRunSimulation: () => void;
}

const STEP_TYPE_META: Record<
  StepType,
  { label: string; icon: typeof BookOpen; chalkColor: string }
> = {
  etape: {
    label: 'Notion',
    icon: BookOpen,
    chalkColor: 'text-stone-900',
  },
  calcul: {
    label: 'Calcul',
    icon: Calculator,
    chalkColor: 'text-blue-800',
  },
  schema: {
    label: 'Schéma',
    icon: GitBranch,
    chalkColor: 'text-blue-800',
  },
  code: {
    label: 'Code',
    icon: Code2,
    chalkColor: 'text-stone-800',
  },
  exemple: {
    label: 'Exemple',
    icon: FlaskConical,
    chalkColor: 'text-emerald-800',
  },
  synthese: {
    label: 'À retenir',
    icon: GraduationCap,
    chalkColor: 'text-rose-800',
  },
};

const FILTER_OPTIONS: Array<{ id: 'all' | StepType; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'etape', label: 'Notions' },
  { id: 'calcul', label: 'Calculs' },
  { id: 'schema', label: 'Schémas' },
  { id: 'exemple', label: 'Exemples' },
  { id: 'code', label: 'Code' },
  { id: 'synthese', label: 'Synthèse' },
];

export function buildStepSignature(step: BoardStep): string {
  return `${step.session_id}:${step.step_number}:${step.step_type}:${step.title}:${step.content}`;
}

function BlackChalkTipSvg() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="drop-shadow-[0_3px_6px_rgba(28,25,23,0.28)]"
    >
      {/* Tilted black chalk stick */}
      <g transform="rotate(-32 8 24)">
        <rect x="6" y="3" width="8" height="19" rx="2" fill="#1C1917" />
        <rect x="7.5" y="4.5" width="2" height="15" rx="1" fill="#44403C" opacity="0.65" />
        <path d="M6 21L10 26L14 21H6Z" fill="#292524" />
        <circle cx="10" cy="25.5" r="1.4" fill="#0C0A09" />
      </g>
    </svg>
  );
}

interface OverlayCoords {
  x: number;
  y: number;
  visible: boolean;
}

function StepCanvasSheet({
  step,
  activePointer,
  shouldAnimate,
  isFocusedMode,
  onSelectStep,
}: {
  step: BoardStep;
  activePointer: BoardPointer | null;
  shouldAnimate: boolean;
  isFocusedMode: boolean;
  onSelectStep?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [replayCount, setReplayCount] = useState(0);
  const [chalkCoords, setChalkCoords] = useState<OverlayCoords>({ x: 0, y: 0, visible: false });
  const [pointerCoords, setPointerCoords] = useState<OverlayCoords>({
    x: 0,
    y: 0,
    visible: false,
  });

  const baseSignature = buildStepSignature(step);
  const signature = replayCount > 0 ? `${baseSignature}#${replayCount}` : baseSignature;
  const lines = useMemo(() => extractBoardLines(step), [step]);

  useEffect(() => {
    setReplayCount(0);
  }, [baseSignature]);

  const writingState = useChalkWriter({
    stepSignature: signature,
    title: step.title,
    lines,
    shouldAnimate: shouldAnimate || replayCount > 0,
  });

  const isPointerOnThisStep =
    !writingState.isWriting &&
    activePointer !== null &&
    activePointer.step_number === step.step_number;
  const activeLineNumber = isPointerOnThisStep ? activePointer.line_number : null;

  // Measure moving black chalk tip while actively writing
  useLayoutEffect(() => {
    if (!writingState.isWriting || !stageRef.current) {
      setChalkCoords((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const stage = stageRef.current;
    const tipEl = stage.querySelector<HTMLElement>('[data-chalk-tip="true"]');
    if (!tipEl) {
      setChalkCoords((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const sRect = stage.getBoundingClientRect();
    const tRect = tipEl.getBoundingClientRect();
    const x = Math.max(0, tRect.left - sRect.left - 3);
    const y = Math.max(0, tRect.top - sRect.top - 22);

    setChalkCoords({ x, y, visible: true });
  }, [
    writingState.isWriting,
    writingState.visibleTitle,
    writingState.activeWriteLineIndex,
    writingState.activeWriteProgress,
  ]);

  // Measure professor's explaining pointer when writing finishes
  const measurePointer = useCallback(() => {
    if (!isPointerOnThisStep || !stageRef.current || !activeLineNumber) {
      setPointerCoords((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const stage = stageRef.current;
    const candidates = Array.from(stage.querySelectorAll<HTMLElement>('[data-line-index]'));
    if (candidates.length === 0) {
      setPointerCoords((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const clampedIndex = Math.max(1, Math.min(activeLineNumber, candidates.length));
    const target =
      candidates.find((el) => Number(el.dataset.lineIndex) === clampedIndex) ??
      candidates[candidates.length - 1];

    const sRect = stage.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();

    const nextX = Math.max(-10, tRect.left - sRect.left - 14);
    const nextY = Math.max(8, tRect.top - sRect.top + Math.min(22, tRect.height / 2) - 10);

    setPointerCoords({ x: nextX, y: nextY, visible: true });
  }, [activeLineNumber, isPointerOnThisStep]);

  useLayoutEffect(() => {
    const raf = window.requestAnimationFrame(measurePointer);
    return () => window.cancelAnimationFrame(raf);
  }, [measurePointer, writingState.isWriting, step.content]);

  useEffect(() => {
    if (!stageRef.current) return;
    const observer = new ResizeObserver(() => measurePointer());
    observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [measurePointer]);

  const meta = STEP_TYPE_META[step.step_type] ?? STEP_TYPE_META.etape;
  const Icon = meta.icon;
  const isHighlighted = step.highlight;

  return (
    <article
      onClick={() => {
        if (!isHighlighted && onSelectStep) onSelectStep();
      }}
      className={`transition-colors ${
        isFocusedMode
          ? 'py-2'
          : `rounded-xl p-5 sm:p-6 border ${
              isHighlighted
                ? 'bg-white/85 border-stone-800/40 shadow-sm'
                : 'bg-white/45 border-stone-300/80 hover:border-stone-400 cursor-pointer'
            }`
      }`}
    >
      {/* Clean Classroom Metadata Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-xs">
        <div className="flex items-center gap-2 text-stone-600">
          <span className="font-mono-code font-bold text-stone-900">
            Étape {String(step.step_number).padStart(2, '0')}
          </span>
          <span aria-hidden="true">·</span>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${meta.chalkColor}`}>
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{meta.label}</span>
          </span>
          {writingState.isWriting ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-stone-900">Écriture au tableau…</span>
            </>
          ) : (
            isHighlighted && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-rose-700">En cours</span>
              </>
            )
          )}
        </div>

        <div className="flex items-center gap-3">
          {!writingState.isWriting && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setReplayCount((c) => c + 1);
              }}
              title="Revoir l'écriture du professeur"
              className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Réécrire</span>
            </button>
          )}
          <time dateTime={step.created_at} className="font-mono-code text-stone-500">
            {new Date(step.created_at).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
      </div>

      {/* Interactive Writing & Explaining Stage */}
      <div ref={stageRef} className="relative pl-4">
        {/* Handwritten Chalk Title */}
        <h3
          className={`font-handwriting font-bold text-stone-950 pb-2 mb-5 chalk-underline ${
            isFocusedMode ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'
          }`}
        >
          <span>{writingState.visibleTitle}</span>
          {writingState.isWriting && writingState.writingTarget === 'title' && (
            <span
              data-chalk-tip="true"
              aria-hidden="true"
              className="inline-block w-0.5 h-7 align-middle bg-stone-900/70 ml-0.5"
            />
          )}
        </h3>

        {/* Written Step Lines */}
        <StepContentRenderer
          stepType={step.step_type}
          content={step.content}
          activeLineNumber={activeLineNumber}
          writingState={writingState}
        />

        {/* Animated Black Chalk Nib during active writing */}
        {chalkCoords.visible && (
          <div
            style={{
              transform: `translate3d(${chalkCoords.x}px, ${chalkCoords.y}px, 0)`,
            }}
            className="pointer-events-none absolute top-0 left-0 z-30 transition-transform duration-75 ease-out"
          >
            <BlackChalkTipSvg />
          </div>
        )}

        {/* Professor's Explaining Pointer after writing finishes */}
        {pointerCoords.visible && (
          <motion.div
            aria-live="polite"
            aria-label={activePointer?.label ? `Curseur du professeur : ${activePointer.label}` : 'Curseur du professeur'}
            initial={false}
            animate={{ x: pointerCoords.x, y: pointerCoords.y }}
            transition={{ type: 'spring', stiffness: 280, damping: 26 }}
            className="pointer-events-none absolute top-0 left-0 z-20 flex items-center"
          >
            <span className="relative flex items-center justify-center">
              <span className="absolute w-5 h-5 rounded-full bg-rose-500/25 blur-[2px]" />
              <MousePointer2
                className="relative w-4 h-4 text-rose-700 fill-rose-600 drop-shadow-[0_2px_4px_rgba(190,18,60,0.45)]"
                aria-hidden="true"
              />
            </span>
          </motion.div>
        )}
      </div>
    </article>
  );
}

export function TeacherBoard({
  session,
  activeCourse,
  steps,
  activePointer,
  animatedStepSignatures,
  isTeacherSpeaking,
  isSimulating,
  isLoading,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenCourseMenu,
  onClearBoard,
  onHighlightStep,
  onRenameSession,
  onRunSimulation,
}: TeacherBoardProps) {
  const [viewMode, setViewMode] = useState<'focus' | 'all'>('focus');
  const [filterType, setFilterType] = useState<'all' | StepType>('all');
  const [focusedStepNumber, setFocusedStepNumber] = useState<number | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  // Only auto-switch focusedStepNumber when the backend highlighted step or pointer actually changes
  const lastHighlightedRef = useRef<number | null>(null);
  const lastPointerStepRef = useRef<number | null>(null);

  useEffect(() => {
    if (steps.length === 0) {
      setFocusedStepNumber(null);
      lastHighlightedRef.current = null;
      return;
    }

    const active = steps.find((s) => s.highlight);
    if (active && active.step_number !== lastHighlightedRef.current) {
      lastHighlightedRef.current = active.step_number;
      setFocusedStepNumber(active.step_number);
      return;
    }

    if (
      focusedStepNumber === null ||
      !steps.some((s) => s.step_number === focusedStepNumber)
    ) {
      setFocusedStepNumber(active?.step_number ?? steps[steps.length - 1].step_number);
    }
  }, [steps, focusedStepNumber]);

  useEffect(() => {
    if (
      activePointer &&
      activePointer.step_number !== lastPointerStepRef.current &&
      steps.some((s) => s.step_number === activePointer.step_number)
    ) {
      lastPointerStepRef.current = activePointer.step_number;
      setFocusedStepNumber(activePointer.step_number);
    }
  }, [activePointer, steps]);

  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.step_number === focusedStepNumber),
  );
  const focusedStep = steps[currentIndex] ?? steps[steps.length - 1] ?? null;

  const goToStepIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(steps.length - 1, index));
      const target = steps[clamped];
      if (!target) return;
      lastHighlightedRef.current = target.step_number;
      setFocusedStepNumber(target.step_number);
      onHighlightStep(target);
    },
    [onHighlightStep, steps],
  );

  // Keyboard navigation (Left/Right arrows) in Focus view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'focus' || steps.length <= 1) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        goToStepIndex(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < steps.length - 1) {
        goToStepIndex(currentIndex + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, goToStepIndex, steps.length, viewMode]);

  const visibleListSteps =
    filterType === 'all' ? steps : steps.filter((s) => s.step_type === filterType);

  const startEditingTitle = () => {
    if (!session) return;
    setDraftTitle(session.title);
    setIsEditingTitle(true);
  };

  const commitTitle = () => {
    setIsEditingTitle(false);
    if (draftTitle.trim() && session && draftTitle.trim() !== session.title) {
      onRenameSession(draftTitle.trim());
    }
  };

  return (
    <main
      id="section-tableau"
      className="flex-1 min-w-0 bg-[#EFECE3] p-3 sm:p-5 flex flex-col"
    >
      {/* Classroom Whiteboard Wooden Frame */}
      <div className="flex-1 flex flex-col rounded-xl border-[5px] border-[#D3C6B0] shadow-md overflow-hidden whiteboard-surface text-stone-900">
        {/* Whiteboard Top Toolbar */}
        <div className="border-b border-[#E4DFD3] px-5 py-3.5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3 bg-white/75 backdrop-blur-xs">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onToggleSidebar}
              title={isSidebarCollapsed ? 'Afficher le pupitre' : 'Élargir le tableau'}
              aria-label={isSidebarCollapsed ? 'Afficher le pupitre' : 'Masquer le pupitre'}
              className="hidden lg:inline-flex items-center justify-center p-2 rounded-lg border border-stone-300 bg-white text-stone-700 hover:text-stone-950 hover:bg-stone-100 transition-colors shrink-0 cursor-pointer"
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>

            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                {isEditingTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitTitle();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                      }}
                      autoFocus
                      className="rounded-md bg-white border border-stone-400 px-2.5 py-1 text-base font-handwriting font-bold text-stone-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={commitTitle}
                      className="p-1.5 rounded-md bg-stone-900 text-white hover:bg-stone-800 cursor-pointer"
                      aria-label="Valider le titre"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startEditingTitle}
                    className="group inline-flex items-center gap-2 text-left min-w-0 cursor-pointer"
                    title="Renommer la séance"
                  >
                    <h2 className="font-handwriting text-xl sm:text-2xl font-bold text-stone-900 truncate">
                      {session ? session.title : 'Tableau du Professeur'}
                    </h2>
                    <Pencil className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-700 shrink-0 transition-colors" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <span>Tableau blanc scolaire</span>
                {activeCourse && (
                  <>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={onOpenCourseMenu}
                      className="font-medium text-sky-800 hover:underline cursor-pointer"
                    >
                      {activeCourse.code} — {activeCourse.title}
                    </button>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono-code tabular-nums">
                  {steps.length === 0
                    ? '0 étape'
                    : viewMode === 'focus'
                      ? `Étape ${currentIndex + 1} / ${steps.length}`
                      : `${steps.length} étape${steps.length > 1 ? 's' : ''}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Focus vs All Segmented Toggle */}
            <div
              role="tablist"
              aria-label="Mode d’affichage du tableau"
              className="flex items-center gap-1 p-1 rounded-lg bg-[#EFECE3] border border-[#DFD9CC]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'focus'}
                onClick={() => setViewMode('focus')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'focus'
                    ? 'bg-white text-stone-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                Vue focus
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'all'}
                onClick={() => setViewMode('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'all'
                    ? 'bg-white text-stone-950 shadow-xs'
                    : 'text-stone-600 hover:text-stone-950'
                }`}
              >
                Tout voir
              </button>
            </div>

            {viewMode === 'all' && (
              <div
                role="tablist"
                aria-label="Filtrer les blocs du tableau"
                className="flex items-center gap-1 p-1 rounded-lg bg-[#EFECE3] border border-[#DFD9CC] overflow-x-auto"
              >
                {FILTER_OPTIONS.map((opt) => {
                  const active = filterType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilterType(opt.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        active
                          ? 'bg-white text-stone-950 shadow-xs'
                          : 'text-stone-600 hover:text-stone-950'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={onClearBoard}
              disabled={steps.length === 0}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Effacer le tableau</span>
            </button>
          </div>
        </div>

        {/* Whiteboard Writing Canvas */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-10 flex flex-col">
          {isLoading ? (
            <div className="max-w-3xl w-full mx-auto space-y-4">
              <div className="h-48 rounded-xl bg-stone-200/50 border border-stone-300/70 animate-pulse" />
            </div>
          ) : steps.length === 0 ? (
            <div className="max-w-xl mx-auto my-auto text-center space-y-5 px-4">
              <div className="mx-auto w-12 h-12 rounded-xl bg-white border border-stone-300 flex items-center justify-center text-stone-800 shadow-xs">
                <Layers className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="font-handwriting text-2xl sm:text-3xl font-bold text-stone-900 text-balance">
                  Le tableau blanc est prêt pour le cours
                </h3>
                <p className="text-sm text-stone-600 leading-relaxed max-w-md mx-auto">
                  Posez une question au professeur en direct : il tracera ses explications à la
                  craie noire étape par étape, avec formules, schémas et exemples concrets.
                </p>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={onRunSimulation}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>Voir le professeur écrire un cours</span>
                </button>
              </div>
            </div>
          ) : viewMode === 'focus' && focusedStep ? (
            <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col justify-between gap-6">
              {/* Classroom Step Index Bar */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  {steps.map((s, idx) => {
                    const isCurrent = s.step_number === focusedStep.step_number;
                    const meta = STEP_TYPE_META[s.step_type] ?? STEP_TYPE_META.etape;
                    return (
                      <button
                        key={s.step_number}
                        type="button"
                        onClick={() => goToStepIndex(idx)}
                        title={`${s.title} (${meta.label})`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isCurrent
                            ? 'bg-stone-900 border-stone-900 text-white'
                            : 'bg-white/80 border-stone-300 text-stone-600 hover:text-stone-950 hover:border-stone-400'
                        }`}
                      >
                        <span className="font-mono-code font-semibold">
                          {String(s.step_number).padStart(2, '0')}
                        </span>
                        <span className="hidden sm:inline max-w-[120px] truncate">{s.title}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => goToStepIndex(currentIndex - 1)}
                    disabled={currentIndex <= 0}
                    aria-label="Étape précédente"
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-2 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-35 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStepIndex(currentIndex + 1)}
                    disabled={currentIndex >= steps.length - 1}
                    aria-label="Étape suivante"
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-2 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-35 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Main Whiteboard Writing Sheet */}
              <div className="my-auto">
                <StepCanvasSheet
                  step={focusedStep}
                  activePointer={activePointer}
                  shouldAnimate={animatedStepSignatures.has(buildStepSignature(focusedStep))}
                  isFocusedMode={true}
                />
              </div>

              {/* Whiteboard Footer Status */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500 border-t border-stone-300/80 pt-3">
                <span className="inline-flex items-center gap-1.5">
                  {isTeacherSpeaking || isSimulating ? (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />
                      <span className="text-stone-900 font-medium">
                        Le professeur écrit et commente en direct
                      </span>
                    </>
                  ) : (
                    <span>Écriture et pointeur pilotés par le professeur</span>
                  )}
                </span>
                <span className="font-mono-code text-stone-500">
                  Navigation étapes : ← / →
                </span>
              </div>
            </div>
          ) : visibleListSteps.length === 0 ? (
            <div className="max-w-xl mx-auto my-12 rounded-xl border border-stone-300 bg-white/80 p-6 text-center space-y-2">
              <p className="text-sm text-stone-700">
                Aucun bloc de type « {FILTER_OPTIONS.find((f) => f.id === filterType)?.label} » sur
                ce tableau.
              </p>
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 underline cursor-pointer"
              >
                Afficher toutes les étapes
              </button>
            </div>
          ) : (
            <div className="max-w-3xl w-full mx-auto space-y-6">
              {visibleListSteps.map((step) => (
                <StepCanvasSheet
                  key={step.step_number}
                  step={step}
                  activePointer={activePointer}
                  shouldAnimate={animatedStepSignatures.has(buildStepSignature(step))}
                  isFocusedMode={false}
                  onSelectStep={() => onHighlightStep(step)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Classroom Chalk & Eraser Tray Ledge */}
        <div
          aria-hidden="true"
          className="h-6 px-6 bg-gradient-to-b from-[#DDD2BE] to-[#C8B99E] border-t border-[#C0B094] flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="w-9 h-2 rounded-full bg-stone-900 shadow-xs" />
            <span className="w-7 h-2 rounded-full bg-blue-700 shadow-xs" />
            <span className="w-7 h-2 rounded-full bg-rose-700 shadow-xs" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-16 h-3 rounded-sm bg-[#8C6D46] border-b-2 border-stone-800 shadow-xs" />
          </div>
        </div>
      </div>
    </main>
  );
}
