import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked } from 'lucide-react';
import { ControlDeck } from './components/ControlDeck.tsx';
import { CourseMenuModal } from './components/CourseMenuModal.tsx';
import { TeacherBoard, buildStepSignature } from './components/TeacherBoard.tsx';
import { useLiveProfessor } from './hooks/useLiveProfessor.ts';
import type {
  BoardPointer,
  BoardStep,
  CourseItem,
  LessonSession,
  LiveConfigResponse,
  StepType,
} from './types/board.ts';
import {
  detectMentionedStep,
  extractBoardLines,
  findBestMatchingLine,
} from './utils/professorTracker.ts';
import {
  parseInitialLaunchParams,
  postToReactNative,
  subscribeToReactNativeCommands,
} from './utils/reactNativeBridge.ts';

interface SimulationStepPayload {
  step_number: number;
  type: StepType;
  title: string;
  content: string;
  pointerPath: Array<{ line_number: number; label: string }>;
}

const DEFAULT_SIMULATION_SEQUENCE: SimulationStepPayload[] = [
  {
    step_number: 1,
    type: 'etape',
    title: 'Principe : additionner les 2 précédents',
    content:
      '- **Départ** : $F_0 = 0$ et $F_1 = 1$\n- **Règle** : chaque terme = somme des 2 précédents\n- **Usage** : algorithmique, nature, proportions',
    pointerPath: [
      { line_number: 1, label: 'Conditions de départ' },
      { line_number: 2, label: 'Règle clé' },
    ],
  },
  {
    step_number: 2,
    type: 'calcul',
    title: 'Formule de récurrence',
    content: '$$F_n = F_{n-1} + F_{n-2}$$\nF_2 = 1 + 0 = 1\nF_3 = 1 + 1 = 2',
    pointerPath: [
      { line_number: 1, label: 'Formule générale' },
      { line_number: 3, label: 'Calcul pas à pas' },
    ],
  },
  {
    step_number: 3,
    type: 'exemple',
    title: 'Exemples chiffrés pas à pas',
    content:
      'n = 4 -> F(3) + F(2) = 2 + 1 = 3\nn = 5 -> F(4) + F(3) = 3 + 2 = 5\nn = 6 -> F(5) + F(4) = 5 + 3 = 8',
    pointerPath: [
      { line_number: 1, label: 'Exemple n = 4' },
      { line_number: 2, label: 'Exemple n = 5' },
      { line_number: 3, label: 'Exemple n = 6' },
    ],
  },
  {
    step_number: 4,
    type: 'schema',
    title: 'Arbre des dépendances',
    content:
      'F(4) -> F(3) : branche principale\nF(4) -> F(2) : sous-calcul\nF(3) -> F(2) : doublon évitable',
    pointerPath: [
      { line_number: 1, label: 'Branche gauche' },
      { line_number: 3, label: 'Calcul redondant' },
    ],
  },
  {
    step_number: 5,
    type: 'code',
    title: 'Version itérative en Python',
    content:
      'def fibonacci(n: int) -> int:\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a',
    pointerPath: [
      { line_number: 2, label: 'Initialisation' },
      { line_number: 4, label: 'Mise à jour O(n)' },
    ],
  },
  {
    step_number: 6,
    type: 'synthese',
    title: 'À retenir',
    content:
      '- **Récursion naïve** : lente ($O(2^n)$)\n- **Approche itérative** : rapide ($O(n)$)\n- Toujours vérifier $n = 0$ et $n = 1$',
    pointerPath: [{ line_number: 2, label: 'Meilleure méthode' }],
  },
];

function buildCourseSimulationSequence(
  course: CourseItem,
  moduleId: string | null,
): SimulationStepPayload[] {
  if (course.id === 'udbl-prog-algo' && (!moduleId || moduleId === 'algo-recursivite')) {
    return DEFAULT_SIMULATION_SEQUENCE;
  }

  const targetMod = moduleId
    ? course.modules.find((m) => m.id === moduleId) ?? course.modules[0]
    : course.modules[0];

  const keyPoints =
    targetMod && targetMod.key_points.length > 0
      ? targetMod.key_points.slice(0, 3)
      : [course.summary.slice(0, 90) || `Introduction à ${course.title}`];

  const isMathOrLogic =
    course.id.includes('algebre') || course.id.includes('logique') || course.code.startsWith('MATH');

  return [
    {
      step_number: 1,
      type: 'etape',
      title: `${course.code} · ${targetMod ? targetMod.title : course.title}`,
      content: keyPoints.map((pt) => `- **Notion** : ${pt}`).join('\n'),
      pointerPath: keyPoints.map((_, idx) => ({
        line_number: idx + 1,
        label: `Point ${idx + 1}`,
      })),
    },
    isMathOrLogic
      ? {
          step_number: 2,
          type: 'calcul',
          title: 'Relation & expression clé',
          content: course.id.includes('algebre')
            ? '$$A \\cdot X = B \\iff X = A^{-1} \\cdot B$$\ndet(A) != 0 -> solution unique\nPivot de Gauss -> forme échelonnée'
            : '$$\\neg(A \\land B) \\equiv (\\neg A) \\lor (\\neg B)$$\nP => Q équivaut à non-Q => non-P\nTable de vérité -> validation complète',
          pointerPath: [
            { line_number: 1, label: 'Formule clé' },
            { line_number: 2, label: 'Propriété' },
          ],
        }
      : {
          step_number: 2,
          type: 'schema',
          title: 'Structure du raisonnement',
          content: `${course.title} -> Analyse du problème : étape 1\nAnalyse du problème -> Application guidée : étape 2\nApplication guidée -> Validation : étape 3`,
          pointerPath: [
            { line_number: 1, label: 'Départ' },
            { line_number: 2, label: 'Méthode' },
          ],
        },
    {
      step_number: 3,
      type: 'exemple',
      title: `Exemple appliqué (${course.title})`,
      content:
        targetMod && targetMod.key_points.length >= 2
          ? `Cas 1 -> ${targetMod.key_points[0]}\nCas 2 -> ${targetMod.key_points[1]}`
          : `Données de départ -> Application directe de ${course.title}\nVérification -> Résultat validé`,
      pointerPath: [
        { line_number: 1, label: 'Cas 01' },
        { line_number: 2, label: 'Cas 02' },
      ],
    },
    {
      step_number: 4,
      type: 'synthese',
      title: `À retenir · ${course.title}`,
      content: `- **Cours** : ${course.code} (${course.professor_name})\n- **Priorité** : maîtriser ${targetMod?.title ?? course.title}\n- **Pratique** : refaire les exercices du syllabus`,
      pointerPath: [{ line_number: 2, label: 'Objectif clé' }],
    },
  ];
}

export default function App() {
  const launchParams = useMemo(() => parseInitialLaunchParams(), []);

  const [config, setConfig] = useState<LiveConfigResponse | null>(null);
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(launchParams.moduleId);
  const [isCourseMenuOpen, setIsCourseMenuOpen] = useState(false);
  const [isConnectingCourse, setIsConnectingCourse] = useState(false);

  const [sessions, setSessions] = useState<LessonSession[]>([]);
  const [activeSession, setActiveSession] = useState<LessonSession | null>(null);
  const [steps, setSteps] = useState<BoardStep[]>([]);
  const [animatedStepSignatures, setAnimatedStepSignatures] = useState<Set<string>>(new Set());
  const [activePointer, setActivePointer] = useState<BoardPointer | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(launchParams.isEmbed);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-live');
  const [selectedVoice, setSelectedVoice] = useState('Charon');
  const [isLoadingBoard, setIsLoadingBoard] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);

  const stepsRef = useRef<BoardStep[]>([]);
  const seenSignaturesRef = useRef<Set<string>>(new Set());
  const activePointerRef = useRef<BoardPointer | null>(null);
  const lastAiToolPointerAtRef = useRef<number>(0);
  const lastAutoAdvanceAtRef = useRef<number>(0);
  const activeSessionRef = useRef<LessonSession | null>(null);
  const coursesRef = useRef<CourseItem[]>([]);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  useEffect(() => {
    activePointerRef.current = activePointer;
  }, [activePointer]);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    coursesRef.current = courses;
  }, [courses]);

  const activeCourse = useMemo(() => {
    if (!activeSession?.course_id) return null;
    return courses.find((c) => c.id === activeSession.course_id) ?? null;
  }, [activeSession?.course_id, courses]);

  const handleBoardStepsUpdated = useCallback((updatedSteps: BoardStep[]) => {
    const newlyAdded: string[] = [];
    for (const s of updatedSteps) {
      const sig = buildStepSignature(s);
      if (!seenSignaturesRef.current.has(sig)) {
        seenSignaturesRef.current.add(sig);
        newlyAdded.push(sig);
      }
    }

    if (newlyAdded.length > 0) {
      setAnimatedStepSignatures((prev) => {
        const next = new Set(prev);
        for (const sig of newlyAdded) next.add(sig);
        return next;
      });
    }

    setSteps(updatedSteps);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === updatedSteps[0]?.session_id
          ? { ...s, step_count: updatedSteps.length, updated_at: new Date().toISOString() }
          : s,
      ),
    );

    if (updatedSteps[0]?.session_id) {
      postToReactNative({
        type: 'BOARD_UPDATED',
        sessionId: updatedSteps[0].session_id,
        steps: updatedSteps,
      });
    }
  }, []);

  const handlePointerMoved = useCallback((pointer: BoardPointer) => {
    lastAiToolPointerAtRef.current = Date.now();
    lastAutoAdvanceAtRef.current = Date.now();
    setActivePointer(pointer);
    postToReactNative({ type: 'POINTER_MOVED', pointer });
  }, []);

  const handleTeacherSpeech = useCallback((_chunk: string, fullTurnText: string) => {
    const currentSteps = stepsRef.current;
    if (currentSteps.length === 0) return;

    const now = Date.now();
    if (now - lastAiToolPointerAtRef.current < 1800) {
      return;
    }

    const currentPtr = activePointerRef.current;
    const highlightedStep =
      currentSteps.find((s) => s.highlight) ?? currentSteps[currentSteps.length - 1];

    const mentionedStep = detectMentionedStep(fullTurnText, currentSteps);
    const targetStep =
      mentionedStep ??
      (currentPtr
        ? currentSteps.find((s) => s.step_number === currentPtr.step_number) ?? highlightedStep
        : highlightedStep);

    if (!targetStep) return;

    const currentLine =
      currentPtr && currentPtr.step_number === targetStep.step_number
        ? currentPtr.line_number
        : 1;

    const matched = findBestMatchingLine(fullTurnText, targetStep, currentLine);
    if (matched) {
      lastAutoAdvanceAtRef.current = now;
      setActivePointer({
        step_number: targetStep.step_number,
        line_number: matched.lineNumber,
        label: 'En explication',
      });
      return;
    }

    if (mentionedStep && (!currentPtr || currentPtr.step_number !== mentionedStep.step_number)) {
      lastAutoAdvanceAtRef.current = now;
      setActivePointer({
        step_number: mentionedStep.step_number,
        line_number: 1,
        label: 'En explication',
      });
      return;
    }

    const totalLines = extractBoardLines(targetStep).length;
    if (totalLines > 1 && now - lastAutoAdvanceAtRef.current > 3200 && currentLine < totalLines) {
      lastAutoAdvanceAtRef.current = now;
      setActivePointer({
        step_number: targetStep.step_number,
        line_number: currentLine + 1,
        label: 'Suite',
      });
    }
  }, []);

  const {
    connectionState,
    isMicActive,
    isTeacherSpeaking,
    micLevel,
    errorMessage,
    transcripts,
    connect,
    disconnect,
    toggleMicrophone,
    sendTextPrompt,
    clearTranscripts,
  } = useLiveProfessor({
    sessionId: activeSession?.id ?? null,
    courseId: activeSession?.course_id ?? null,
    moduleId: activeModuleId,
    model: selectedModel,
    voice: selectedVoice,
    onBoardStepsUpdated: handleBoardStepsUpdated,
    onPointerMoved: handlePointerMoved,
    onTeacherSpeech: handleTeacherSpeech,
  });

  // Notify React Native when Live state or transcripts update
  useEffect(() => {
    postToReactNative({
      type: 'LIVE_STATE_CHANGED',
      state: connectionState,
      isTeacherSpeaking,
    });
  }, [connectionState, isTeacherSpeaking]);

  useEffect(() => {
    const latest = transcripts[transcripts.length - 1];
    if (latest) {
      postToReactNative({
        type: 'TRANSCRIPT',
        role: latest.role,
        text: latest.text,
      });
    }
  }, [transcripts]);

  const refreshSessionsList = useCallback(async () => {
    const res = await fetch('/api/sessions/');
    if (!res.ok) return [] as LessonSession[];
    const list = (await res.json()) as LessonSession[];
    setSessions(list);
    return list;
  }, []);

  const refreshCoursesList = useCallback(async () => {
    const res = await fetch('/api/courses/');
    if (!res.ok) return [] as CourseItem[];
    const list = (await res.json()) as CourseItem[];
    setCourses(list);
    return list;
  }, []);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    setIsLoadingBoard(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/`);
      if (!res.ok) return null;
      const detail = (await res.json()) as LessonSession;
      setActiveSession(detail);
      const loadedSteps = detail.steps ?? [];

      seenSignaturesRef.current = new Set(loadedSteps.map(buildStepSignature));
      setAnimatedStepSignatures(new Set());
      setSteps(loadedSteps);

      const activeStep = loadedSteps.find((s) => s.highlight) ?? loadedSteps[loadedSteps.length - 1];
      setActivePointer(
        activeStep ? { step_number: activeStep.step_number, line_number: 1 } : null,
      );
      if (detail.model_name) {
        setSelectedModel(detail.model_name);
      }
      return detail;
    } finally {
      setIsLoadingBoard(false);
    }
  }, []);

  const runSimulationSequence = useCallback(
    async (sessionId: string, sequence: SimulationStepPayload[]) => {
      if (isSimulating) return;
      setIsSimulating(true);
      try {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/clear/`, {
          method: 'POST',
        });
        seenSignaturesRef.current = new Set();
        setAnimatedStepSignatures(new Set());
        setSteps([]);
        setActivePointer(null);

        for (const item of sequence) {
          const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/steps/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step_number: item.step_number,
              type: item.type,
              title: item.title,
              content: item.content,
              highlight: true,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as { step: BoardStep; steps: BoardStep[] };
            const sig = buildStepSignature(data.step);
            seenSignaturesRef.current.add(sig);
            setAnimatedStepSignatures((prev) => new Set(prev).add(sig));
            setSteps(data.steps);
          }

          await new Promise((r) => window.setTimeout(r, 1750));

          for (const pt of item.pointerPath) {
            setActivePointer({
              step_number: item.step_number,
              line_number: pt.line_number,
              label: pt.label,
            });
            await new Promise((r) => window.setTimeout(r, 650));
          }
        }
        await refreshSessionsList();
      } finally {
        setIsSimulating(false);
      }
    },
    [isSimulating, refreshSessionsList],
  );

  const connectCourseAndExplain = useCallback(
    async (
      course: CourseItem,
      moduleId: string | null,
      options?: { shouldExplain?: boolean; sessionIdOverride?: string },
    ) => {
      const targetSessionId = options?.sessionIdOverride ?? activeSessionRef.current?.id;
      if (!targetSessionId) return;
      const shouldExplain = options?.shouldExplain !== false;

      setIsConnectingCourse(true);
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(targetSessionId)}/connect-course/`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_id: course.id }),
          },
        );
        if (!res.ok) return;
        const updatedSession = (await res.json()) as LessonSession;
        setActiveSession(updatedSession);
        setActiveModuleId(moduleId);
        await refreshSessionsList();

        postToReactNative({
          type: 'COURSE_CONNECTED',
          sessionId: updatedSession.id,
          course,
          moduleId,
        });

        setIsCourseMenuOpen(false);

        if (!shouldExplain) return;

        // Clear old board content before starting the fresh course explanation
        await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/clear/`, {
          method: 'POST',
        });
        seenSignaturesRef.current = new Set();
        setAnimatedStepSignatures(new Set());
        setSteps([]);
        setActivePointer(null);

        const targetModule = moduleId
          ? course.modules.find((m) => m.id === moduleId)
          : undefined;
        const explanationPrompt = targetModule
          ? `Explique-moi le chapitre "${targetModule.title}" du cours "${course.title}" (${course.code}). Écris l'essentiel au tableau étape par étape (avec formule ou schéma et un bloc exemple concret), et guide-moi avec ton pointeur.`
          : `Explique-moi le cours "${course.title}" (${course.code}) selon le programme. Commence par les notions fondamentales au tableau avec un bloc exemple concret et utilise ton pointeur pour me guider.`;

        const sent = await sendTextPrompt(explanationPrompt, {
          sessionId: targetSessionId,
          courseId: course.id,
          moduleId,
        });

        // Graceful fallback if Live API key is not present or Live session cannot connect
        if (!sent) {
          const seq = buildCourseSimulationSequence(course, moduleId);
          await runSimulationSequence(targetSessionId, seq);
        }
      } finally {
        setIsConnectingCourse(false);
      }
    },
    [refreshSessionsList, runSimulationSequence, sendTextPrompt],
  );

  const handleSimulateCourse = useCallback(
    async (course: CourseItem, moduleId: string | null) => {
      const targetSessionId = activeSessionRef.current?.id;
      if (!targetSessionId) return;
      await connectCourseAndExplain(course, moduleId, { shouldExplain: false });
      setIsCourseMenuOpen(false);
      const seq = buildCourseSimulationSequence(course, moduleId);
      await runSimulationSequence(targetSessionId, seq);
    },
    [connectCourseAndExplain, runSimulationSequence],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const [configRes, sessionsRes, coursesRes] = await Promise.all([
          fetch('/api/live-config/'),
          fetch('/api/sessions/'),
          fetch('/api/courses/'),
        ]);

        if (cancelled) return;

        if (configRes.ok) {
          const cfg = (await configRes.json()) as LiveConfigResponse;
          setConfig(cfg);
          setSelectedModel(cfg.model);
          setSelectedVoice(cfg.default_voice);
        }

        let loadedCourses: CourseItem[] = [];
        if (coursesRes.ok) {
          loadedCourses = (await coursesRes.json()) as CourseItem[];
          setCourses(loadedCourses);
        }

        let list: LessonSession[] = [];
        if (sessionsRes.ok) {
          list = (await sessionsRes.json()) as LessonSession[];
        }

        if (list.length === 0) {
          const createdRes = await fetch('/api/sessions/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Séance 1 · Introduction',
              course_id: launchParams.courseId ?? loadedCourses[0]?.id ?? null,
            }),
          });
          if (createdRes.ok) {
            const created = (await createdRes.json()) as LessonSession;
            list = [created];
          }
        }

        if (cancelled) return;
        setSessions(list);

        if (list.length > 0) {
          const detail = await loadSessionDetail(list[0].id);
          postToReactNative({
            type: 'READY',
            embed: launchParams.isEmbed,
            sessionId: detail?.id ?? list[0].id,
            courseId: launchParams.courseId ?? detail?.course_id ?? null,
          });

          if (launchParams.courseId && detail) {
            const targetCourse = loadedCourses.find((c) => c.id === launchParams.courseId);
            if (targetCourse) {
              await connectCourseAndExplain(targetCourse, launchParams.moduleId, {
                shouldExplain: launchParams.autoExplain,
                sessionIdOverride: detail.id,
              });
            }
          }
        } else {
          setIsLoadingBoard(false);
        }
      } catch (err) {
        console.error('Initialization failed:', err);
        setIsLoadingBoard(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to bidirectional commands from React Native / Expo WebView
  useEffect(() => {
    return subscribeToReactNativeCommands(async (cmd) => {
      switch (cmd.type) {
        case 'SYNC_COURSES': {
          for (const item of cmd.courses) {
            await fetch('/api/courses/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            });
          }
          await refreshCoursesList();
          break;
        }
        case 'CONNECT_COURSE': {
          const list = coursesRef.current.length > 0 ? coursesRef.current : await refreshCoursesList();
          const found = list.find((c) => c.id === cmd.courseId);
          if (found) {
            await connectCourseAndExplain(found, cmd.moduleId ?? null, {
              shouldExplain: cmd.autoExplain !== false,
            });
          }
          break;
        }
        case 'ASK_PROFESSOR':
          await sendTextPrompt(cmd.text);
          break;
        case 'START_LIVE':
          await connect();
          break;
        case 'STOP_LIVE':
          disconnect();
          break;
        case 'CLEAR_BOARD': {
          const sid = activeSessionRef.current?.id;
          if (sid) {
            await fetch(`/api/sessions/${encodeURIComponent(sid)}/clear/`, { method: 'POST' });
            setSteps([]);
            setActivePointer(null);
          }
          break;
        }
      }
    });
  }, [connect, connectCourseAndExplain, disconnect, refreshCoursesList, sendTextPrompt]);

  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSession?.id) return;
    disconnect();
    clearTranscripts();
    setActivePointer(null);
    setActiveModuleId(null);
    await loadSessionDetail(sessionId);
  };

  const handleCreateSession = async () => {
    disconnect();
    clearTranscripts();
    setActivePointer(null);
    seenSignaturesRef.current = new Set();
    setAnimatedStepSignatures(new Set());
    const res = await fetch('/api/sessions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_name: selectedModel,
        course_id: activeSession?.course_id ?? null,
      }),
    });
    if (!res.ok) return;
    const created = (await res.json()) as LessonSession;
    await refreshSessionsList();
    setActiveSession(created);
    setSteps(created.steps ?? []);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (activeSession?.id === sessionId) {
      disconnect();
      clearTranscripts();
      setActivePointer(null);
    }
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/`, {
      method: 'DELETE',
    });
    if (!res.ok) return;

    const updated = await refreshSessionsList();
    if (activeSession?.id === sessionId) {
      if (updated.length > 0) {
        await loadSessionDetail(updated[0].id);
      } else {
        await handleCreateSession();
      }
    }
  };

  const handleRenameSession = async (newTitle: string) => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as LessonSession;
    setActiveSession(updated);
    await refreshSessionsList();
  };

  const handleClearBoard = async () => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/clear/`, {
      method: 'POST',
    });
    if (!res.ok) return;
    seenSignaturesRef.current = new Set();
    setAnimatedStepSignatures(new Set());
    setSteps([]);
    setActivePointer(null);
    await refreshSessionsList();
  };

  const handleHighlightStep = async (step: BoardStep) => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/steps/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        step_number: step.step_number,
        type: step.step_type,
        title: step.title,
        content: step.content,
        highlight: true,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { steps: BoardStep[] };
    setSteps(data.steps);
  };

  const handleRunSimulation = async () => {
    if (!activeSession || isSimulating) return;
    const sequence = activeCourse
      ? buildCourseSimulationSequence(activeCourse, activeModuleId)
      : DEFAULT_SIMULATION_SEQUENCE;
    await runSimulationSequence(activeSession.id, sequence);
  };

  const handleDisconnectCourse = async () => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(activeSession.id)}/connect-course/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: null }),
    });
    if (!res.ok) return;
    const updated = (await res.json()) as LessonSession;
    setActiveSession(updated);
    setActiveModuleId(null);
    await refreshSessionsList();
    postToReactNative({
      type: 'COURSE_CONNECTED',
      sessionId: updated.id,
      course: null,
      moduleId: null,
    });
  };

  const handleCreateCourse = async (payload: {
    code: string;
    title: string;
    professor_name: string;
    summary: string;
    chaptersText: string;
  }) => {
    const lines = payload.chaptersText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const modules = lines.map((line, idx) => ({
      id: `mod-${idx + 1}`,
      title: line,
      key_points: [line],
    }));

    const res = await fetch('/api/courses/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: payload.code,
        title: payload.title,
        professor_name: payload.professor_name,
        summary: payload.summary,
        modules,
      }),
    });
    if (!res.ok) return null;
    const created = (await res.json()) as CourseItem;
    await refreshCoursesList();
    return created;
  };

  const handleDeleteCourse = async (courseId: string) => {
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/`, {
      method: 'DELETE',
    });
    if (!res.ok) return;
    if (activeSession?.course_id === courseId) {
      await handleDisconnectCourse();
    }
    await refreshCoursesList();
  };

  const scrollToSection = (id: string) => {
    if (isSidebarCollapsed && id !== 'section-tableau') {
      setIsSidebarCollapsed(false);
    }
    window.setTimeout(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F3EC] text-stone-900">
      {/* Strict 3-Zone Top Bar */}
      <header className="flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3.5 bg-white border-b border-[#E2DDD2] shrink-0">
        <a
          href="/"
          className="font-handwriting text-xl sm:text-2xl font-bold tracking-tight text-stone-900 whitespace-nowrap shrink-0"
        >
          Professeur au Tableau Live
        </a>

        {!launchParams.isEmbed && (
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600">
            <button
              type="button"
              onClick={() => setIsCourseMenuOpen(true)}
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Cours
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('section-seances')}
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Séances
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('section-tableau')}
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Tableau
            </button>
            <button
              type="button"
              onClick={() => {
                void handleRunSimulation();
              }}
              className="hover:text-stone-950 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Simulation
            </button>
          </nav>
        )}

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsCourseMenuOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-stone-800 bg-[#FAF9F6] border border-[#D6D0C4] rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookMarked className="w-4 h-4 text-sky-700" />
            <span className="max-w-[140px] truncate">
              {activeCourse ? activeCourse.title : 'Connecter un cours'}
            </span>
          </button>

          {!launchParams.isEmbed && (
            <button
              type="button"
              onClick={handleCreateSession}
              className="hidden sm:inline-flex px-4 py-2 text-xs sm:text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Nouvelle séance
            </button>
          )}
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {!isSidebarCollapsed && (
          <ControlDeck
            config={config}
            courses={courses}
            activeCourse={activeCourse}
            activeModuleId={activeModuleId}
            sessions={sessions}
            activeSessionId={activeSession?.id ?? null}
            selectedModel={selectedModel}
            selectedVoice={selectedVoice}
            connectionState={connectionState}
            isMicActive={isMicActive}
            isTeacherSpeaking={isTeacherSpeaking}
            micLevel={micLevel}
            errorMessage={errorMessage}
            transcripts={transcripts}
            isSimulating={isSimulating}
            isConnectingCourse={isConnectingCourse}
            onOpenCourseMenu={() => setIsCourseMenuOpen(true)}
            onQuickExplainCourse={(course, moduleId) => {
              void connectCourseAndExplain(course, moduleId, { shouldExplain: true });
            }}
            onSelectSession={handleSelectSession}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onChangeModel={setSelectedModel}
            onChangeVoice={setSelectedVoice}
            onConnect={() => {
              void connect();
            }}
            onDisconnect={disconnect}
            onToggleMic={() => {
              void toggleMicrophone();
            }}
            onSendPrompt={sendTextPrompt}
            onRunSimulation={() => {
              void handleRunSimulation();
            }}
            onClearTranscripts={clearTranscripts}
          />
        )}

        <TeacherBoard
          session={activeSession}
          activeCourse={activeCourse}
          steps={steps}
          activePointer={activePointer}
          animatedStepSignatures={animatedStepSignatures}
          isTeacherSpeaking={isTeacherSpeaking}
          isSimulating={isSimulating}
          isLoading={isLoadingBoard}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
          onOpenCourseMenu={() => setIsCourseMenuOpen(true)}
          onClearBoard={() => {
            void handleClearBoard();
          }}
          onHighlightStep={(step) => {
            void handleHighlightStep(step);
          }}
          onRenameSession={(title) => {
            void handleRenameSession(title);
          }}
          onRunSimulation={() => {
            void handleRunSimulation();
          }}
        />
      </div>

      {/* Course Menu & React Native Integration Modal */}
      <CourseMenuModal
        isOpen={isCourseMenuOpen}
        courses={courses}
        activeCourseId={activeCourse?.id ?? null}
        activeModuleId={activeModuleId}
        isConnectingCourse={isConnectingCourse}
        onClose={() => setIsCourseMenuOpen(false)}
        onConnectAndExplain={async (course, moduleId) => {
          await connectCourseAndExplain(course, moduleId, { shouldExplain: true });
        }}
        onSimulateCourse={handleSimulateCourse}
        onDisconnectCourse={handleDisconnectCourse}
        onCreateCourse={handleCreateCourse}
        onDeleteCourse={handleDeleteCourse}
      />
    </div>
  );
}
