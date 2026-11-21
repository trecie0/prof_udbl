import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookMarked } from 'lucide-react';
import { ControlDeck } from './components/ControlDeck.tsx';
import { CourseMenuModal } from './components/CourseMenuModal.tsx';
import { TeacherBoard, buildStepSignature } from './components/TeacherBoard.tsx';
import { estimateChalkWritingDurationMs } from './hooks/useChalkWriter.ts';
import { useLiveProfessor } from './hooks/useLiveProfessor.ts';
import type {
  BoardPointer,
  BoardStep,
  CourseItem,
  LessonSession,
  LiveConfigResponse,
  PdfExerciseItem,
  StepType,
} from './types/board.ts';
import {
  detectMentionedStep,
  extractBoardLines,
  findBestMatchingLine,
} from './utils/professorTracker.ts';
import type { User } from 'firebase/auth';
import {
  clearCloudBoardSteps,
  createOrEnsureCloudSession,
  deleteCloudCourse,
  deleteCloudSession,
  ensureCloudUserProfile,
  fetchCloudCourses,
  fetchCloudSessionSteps,
  saveCloudCourse,
  signInWithGoogle,
  signOutFromCloud,
  subscribeToCloudAuth,
  subscribeToCloudSessions,
  syncCloudSessionSnapshot,
  testFirestoreConnection,
  updateCloudSessionMeta,
  upsertCloudBoardStep,
} from './utils/firebase.ts';
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
      '- **Départ** : $F_0 = 0$ et $F_1 = 1$ | Valeurs initiales fixes pour démarrer la suite\n- **Règle** : chaque terme = somme des 2 précédents | On réutilise toujours les deux derniers résultats\n- **Usage** : algorithmique, croissance, proportions | Sert à modéliser des étapes dépendantes',
    pointerPath: [
      { line_number: 1, label: 'Conditions de départ' },
      { line_number: 2, label: 'Règle clé' },
      { line_number: 3, label: 'Utilité' },
    ],
  },
  {
    step_number: 2,
    type: 'calcul',
    title: 'Formule de récurrence pas à pas',
    content:
      '$$F_n = F_{n-1} + F_{n-2}$$ | Formule générale : le rang n dépend de n-1 et n-2\nF_2 = F_1 + F_0 = 1 + 0 = 1 | On remplace F_1 par 1 et F_0 par 0\nF_3 = F_2 + F_1 = 1 + 1 = 2 | On réutilise F_2 = 1 qu’on vient de trouver',
    pointerPath: [
      { line_number: 1, label: 'Formule générale' },
      { line_number: 2, label: 'Calcul de F2' },
      { line_number: 3, label: 'Calcul de F3' },
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
      '- **Récursion naïve** : lente ($O(2^n)$) | Recalcule plusieurs fois les mêmes termes\n- **Approche itérative** : rapide ($O(n)$) | Ne garde en mémoire que les 2 derniers termes\n- Toujours vérifier $n = 0$ et $n = 1$ | Évite toute boucle infinie ou erreur de départ',
    pointerPath: [
      { line_number: 1, label: 'Limite récursive' },
      { line_number: 2, label: 'Meilleure méthode' },
    ],
  },
];

function inferDocumentMimeType(file: File): string {
  const lower = file.name.toLowerCase();
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) return 'application/pdf';
  if (file.type === 'text/markdown' || lower.endsWith('.md')) return 'text/markdown';
  if (file.type === 'text/plain' || lower.endsWith('.txt')) return 'text/plain';
  return file.type || 'application/pdf';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Impossible de lire le fichier sélectionné.'));
    reader.readAsDataURL(file);
  });
}

function buildExerciseSimulationSequence(
  course: CourseItem,
  exercise: PdfExerciseItem,
): SimulationStepPayload[] {
  const profile = course.pdf_profile;
  const methodStepLines =
    exercise.method_steps.length > 0
      ? exercise.method_steps.map((step, i) => `Étape ${i + 1} : ${step} | Suivant la méthode du PDF`)
      : [profile?.methodology_pattern || 'Application directe de la démarche du document PDF.'];

  const formatSample =
    exercise.exact_format_sample ||
    profile?.verbatim_excerpts[0] ||
    'Rédaction conforme au modèle du document.';

  const conventionPrefix = profile
    ? [`- **Style** : ${profile.writing_style}`, `- **Notations** : ${profile.notation_conventions}`]
    : [];
  const step2Lines = [...conventionPrefix, ...methodStepLines];

  return [
    {
      step_number: 1,
      type: 'exemple',
      title: `Énoncé recopié · ${exercise.title}`,
      content: exercise.statement,
      pointerPath: [{ line_number: 1, label: 'Énoncé exact du PDF' }],
    },
    {
      step_number: 2,
      type: 'etape',
      title: 'Méthode & notations du PDF (pas à pas)',
      content: step2Lines.join('\n'),
      pointerPath: step2Lines.slice(0, 4).map((_, idx) => ({
        line_number: idx + 1,
        label: idx < conventionPrefix.length ? 'Conventions du PDF' : `Étape ${idx - conventionPrefix.length + 1}`,
      })),
    },
    {
      step_number: 3,
      type: 'calcul',
      title: 'Rédaction & résultat dans le format du PDF',
      content: formatSample,
      pointerPath: [{ line_number: 1, label: 'Mise en forme fidèle' }],
    },
    {
      step_number: 4,
      type: 'synthese',
      title: `À retenir · ${course.title}`,
      content: `- **Source PDF** : ${profile?.filename ?? course.title} | Support officiel\n- **Démarche type** : ${profile?.methodology_pattern ?? 'Respecter exactement l’énoncé et les notations du support.'} | À reproduire à l’examen`,
      pointerPath: [{ line_number: 2, label: 'Démarche à reproduire' }],
    },
  ];
}

function buildCourseSimulationSequence(
  course: CourseItem,
  moduleId: string | null,
): SimulationStepPayload[] {
  if (course.pdf_profile && course.pdf_profile.exercises.length > 0 && !moduleId) {
    return buildExerciseSimulationSequence(course, course.pdf_profile.exercises[0]);
  }

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
          title: 'Démonstration détaillée ligne par ligne',
          content: course.id.includes('algebre')
            ? '$$A \\cdot X = B$$ | Équation matricielle de départ\n$$\\det(A) \\neq 0$$ | On vérifie d’abord que la matrice A est inversible\n$$A^{-1} \\cdot A \\cdot X = A^{-1} \\cdot B$$ | On multiplie à gauche par l’inverse des deux côtés\n$$X = A^{-1} \\cdot B$$ | Car A^-1 · A = I (matrice identité), d’où la solution unique'
            : '$$\\neg(A \\land B)$$ | Expression de départ à simplifier\n$$\\neg(A \\land B) \\equiv (\\neg A) \\lor (\\neg B)$$ | Loi de De Morgan : la négation transforme ET en OU\n$$(P \\Rightarrow Q) \\equiv (\\neg Q \\Rightarrow \\neg P)$$ | Contraposée : utile quand la preuve directe est difficile',
          pointerPath: [
            { line_number: 1, label: 'Point de départ' },
            { line_number: 2, label: 'Condition ou loi' },
            { line_number: 3, label: 'Étape suivante' },
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
      content: `- **Cours** : ${course.code} (${course.professor_name}) | Cadre officiel de référence\n- **Priorité** : maîtriser ${targetMod?.title ?? course.title} | Chaque étape repose sur la précédente\n- **Pratique** : refaire les exercices du syllabus | Fixer la méthode ligne par ligne`,
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
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

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
  const [playbackSpeed, setPlaybackSpeed] = useState(0.75);
  const [isBoardPaused, setIsBoardPaused] = useState(false);

  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const stepsRef = useRef<BoardStep[]>([]);
  const seenSignaturesRef = useRef<Set<string>>(new Set());
  const activePointerRef = useRef<BoardPointer | null>(null);
  const lastAiToolPointerAtRef = useRef<number>(0);
  const lastAutoAdvanceAtRef = useRef<number>(0);
  const activeSessionRef = useRef<LessonSession | null>(null);
  const coursesRef = useRef<CourseItem[]>([]);
  const sessionsRef = useRef<LessonSession[]>([]);
  const cloudUserRef = useRef<User | null>(null);
  const selectedVoiceRef = useRef<string>('Charon');
  const playbackSpeedRef = useRef(playbackSpeed);
  const isBoardPausedRef = useRef(isBoardPaused);
  const pendingPointerRef = useRef<BoardPointer | null>(null);
  playbackSpeedRef.current = playbackSpeed;
  isBoardPausedRef.current = isBoardPaused;

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

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    cloudUserRef.current = cloudUser;
  }, [cloudUser]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  useEffect(() => {
    if (isBoardPaused || !pendingPointerRef.current) return;
    const pointer = pendingPointerRef.current;
    pendingPointerRef.current = null;
    setActivePointer(pointer);
    postToReactNative({ type: 'POINTER_MOVED', pointer });
  }, [isBoardPaused]);

  const waitForPlayback = useCallback(async (durationMs: number, speedAtStart: number) => {
    let remaining = durationMs;
    let lastTime = performance.now();
    while (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const now = performance.now();
      const delta = Math.min(100, Math.max(0, now - lastTime));
      lastTime = now;
      if (!isBoardPausedRef.current && speedAtStart > 0) {
        remaining -= delta * (playbackSpeedRef.current / speedAtStart);
      }
    }
  }, []);

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

      const uid = cloudUserRef.current?.uid;
      const currentSess = activeSessionRef.current;
      if (uid && currentSess && currentSess.id === updatedSteps[0].session_id) {
        void syncCloudSessionSnapshot(
          uid,
          currentSess,
          updatedSteps,
          selectedVoiceRef.current,
        );
      }
    }
  }, []);

  const handlePointerMoved = useCallback((pointer: BoardPointer) => {
    lastAiToolPointerAtRef.current = Date.now();
    lastAutoAdvanceAtRef.current = Date.now();
    if (isBoardPausedRef.current) {
      pendingPointerRef.current = pointer;
      return;
    }
    setActivePointer(pointer);
    postToReactNative({ type: 'POINTER_MOVED', pointer });
  }, []);

  const handleTeacherSpeech = useCallback((_chunk: string, fullTurnText: string) => {
    if (isBoardPausedRef.current) return;
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
    const pointerDelayMs = 4800 / playbackSpeedRef.current;
    if (totalLines > 1 && now - lastAutoAdvanceAtRef.current > pointerDelayMs && currentLine < totalLines) {
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
    playbackSpeed,
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
    pendingPointerRef.current = null;
    setIsLoadingBoard(true);
    try {
      let detail: LessonSession | null = null;
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/`);
      if (res.ok) {
        detail = (await res.json()) as LessonSession;
      } else if (cloudUserRef.current?.uid) {
        const cloudSessionMeta = sessionsRef.current.find((s) => s.id === sessionId);
        if (cloudSessionMeta) {
          const cloudSteps = await fetchCloudSessionSteps(cloudUserRef.current.uid, sessionId);
          detail = { ...cloudSessionMeta, steps: cloudSteps };
        }
      }

      if (!detail) return null;
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
        if (cloudUserRef.current?.uid) {
          void clearCloudBoardSteps(cloudUserRef.current.uid, sessionId);
        }
        seenSignaturesRef.current = new Set();
        pendingPointerRef.current = null;
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
          let stepLines: string[] = item.content
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          if (res.ok) {
            const data = (await res.json()) as { step: BoardStep; steps: BoardStep[] };
            const sig = buildStepSignature(data.step);
            seenSignaturesRef.current.add(sig);
            setAnimatedStepSignatures((prev) => new Set(prev).add(sig));
            setSteps(data.steps);
            stepLines = extractBoardLines(data.step);

            if (cloudUserRef.current?.uid && activeSessionRef.current) {
              void upsertCloudBoardStep(
                cloudUserRef.current.uid,
                activeSessionRef.current,
                data.step,
                selectedVoiceRef.current,
              );
            }
          }

          // Wait for the slow chalk handwriting animation to finish plus a calm reading pause
          const speedAtStart = playbackSpeedRef.current;
          const writeMs = estimateChalkWritingDurationMs(item.title, stepLines, speedAtStart);
          await waitForPlayback(writeMs, speedAtStart);

          for (const pt of item.pointerPath) {
            setActivePointer({
              step_number: item.step_number,
              line_number: pt.line_number,
              label: pt.label,
            });
            await waitForPlayback(1850 / speedAtStart, speedAtStart);
          }
        }
        if (cloudUserRef.current?.uid && activeSessionRef.current) {
          void syncCloudSessionSnapshot(
            cloudUserRef.current.uid,
            activeSessionRef.current,
            stepsRef.current,
            selectedVoiceRef.current,
          );
        }
        await refreshSessionsList();
      } finally {
        setIsSimulating(false);
      }
    },
    [isSimulating, refreshSessionsList, waitForPlayback],
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

        if (cloudUserRef.current?.uid) {
          void saveCloudCourse(cloudUserRef.current.uid, course);
          void updateCloudSessionMeta(cloudUserRef.current.uid, updatedSession.id, {
            courseId: course.id,
            courseTitle: course.title,
            courseCode: course.code,
          });
        }

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
        if (cloudUserRef.current?.uid) {
          void clearCloudBoardSteps(cloudUserRef.current.uid, targetSessionId);
        }
        seenSignaturesRef.current = new Set();
        pendingPointerRef.current = null;
        setAnimatedStepSignatures(new Set());
        setSteps([]);
        setActivePointer(null);

        const targetModule = moduleId
          ? course.modules.find((m) => m.id === moduleId)
          : undefined;
        const explanationPrompt = targetModule
          ? `Explique-moi très calmement et lentement le chapitre "${targetModule.title}" du cours "${course.title}" (${course.code}). Écris d'abord une étape courte au tableau (en justifiant chaque ligne de calcul avec \`Formule | Pourquoi\`), marque une pause, puis explique-la ligne par ligne avec ton pointeur avant de passer à la suite.`
          : `Explique-moi très calmement et lentement le cours "${course.title}" (${course.code}) selon le programme. Écris d'abord une étape courte au tableau (avec \`Opération | Pourquoi\` pour chaque ligne), marque une pause, puis explique-la posément ligne par ligne avec ton pointeur.`;

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

  const handleUploadPdfForCourse = useCallback(
    async (file: File, targetCourseId?: string): Promise<CourseItem | null> => {
      if (file.size > 10 * 1024 * 1024) {
        setPdfError('Le fichier dépasse la limite de 10 Mo.');
        return null;
      }

      setPdfError(null);
      setIsUploadingPdf(true);
      try {
        const dataBase64 = await fileToBase64(file);
        const mimeType = inferDocumentMimeType(file);
        const endpoint = targetCourseId
          ? `/api/courses/${encodeURIComponent(targetCourseId)}/pdf`
          : '/api/courses/import-pdf';

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            mimeType,
            dataBase64,
          }),
        });

        if (!res.ok) {
          const errPayload = (await res.json().catch(() => ({}))) as { detail?: string };
          setPdfError(errPayload.detail || 'Impossible de lire et analyser ce document.');
          return null;
        }

        const updatedCourse = (await res.json()) as CourseItem;
        await refreshCoursesList();

        if (cloudUserRef.current?.uid) {
          void saveCloudCourse(cloudUserRef.current.uid, updatedCourse);
        }

        const currentSessionId = activeSessionRef.current?.id;
        if (currentSessionId) {
          const linkRes = await fetch(
            `/api/sessions/${encodeURIComponent(currentSessionId)}/connect-course/`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ course_id: updatedCourse.id }),
            },
          );
          if (linkRes.ok) {
            const updatedSession = (await linkRes.json()) as LessonSession;
            setActiveSession(updatedSession);
            setActiveModuleId(null);
            await refreshSessionsList();
            if (cloudUserRef.current?.uid) {
              void updateCloudSessionMeta(cloudUserRef.current.uid, updatedSession.id, {
                courseId: updatedCourse.id,
                courseTitle: updatedCourse.title,
                courseCode: updatedCourse.code,
              });
            }
            postToReactNative({
              type: 'COURSE_CONNECTED',
              sessionId: updatedSession.id,
              course: updatedCourse,
              moduleId: null,
            });
          }
        }

        return updatedCourse;
      } catch (err) {
        setPdfError(
          err instanceof Error ? err.message : 'Erreur lors de la lecture du document PDF.',
        );
        return null;
      } finally {
        setIsUploadingPdf(false);
      }
    },
    [refreshCoursesList, refreshSessionsList],
  );

  const handleExplainPdfExercise = useCallback(
    async (course: CourseItem, exercise: PdfExerciseItem) => {
      const targetSessionId = activeSessionRef.current?.id;
      if (!targetSessionId) return;

      setIsConnectingCourse(true);
      try {
        await connectCourseAndExplain(course, null, {
          shouldExplain: false,
          sessionIdOverride: targetSessionId,
        });

        await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}/clear/`, {
          method: 'POST',
        });
        seenSignaturesRef.current = new Set();
        pendingPointerRef.current = null;
        setAnimatedStepSignatures(new Set());
        setSteps([]);
        setActivePointer(null);
        setIsCourseMenuOpen(false);

        const profile = course.pdf_profile;
        const promptParts = [
          `Travaillons lentement et clairement, exactement comme dans le document "${profile?.filename ?? course.title}".`,
          `1) Écris d'abord uniquement l'énoncé fidèle (titre "${exercise.title}") au tableau :`,
          `"""\n${exercise.statement}\n"""`,
          `2) Ensuite, résous ce travail très calmement ligne par ligne en justifiant chaque étape (\`Ligne ou calcul | Pourquoi on fait cela\`), tout en imitant le style rédactionnel (${profile?.writing_style ?? 'style académique du PDF'}), les notations (${profile?.notation_conventions ?? 'notations du PDF'}) et la démarche (${exercise.method_steps.join(' -> ') || profile?.methodology_pattern || 'démarche du PDF'}). Explique chaque ligne posément avec ton pointeur.`,
        ];
        if (exercise.exact_format_sample) {
          promptParts.push(
            `Respecte ce format exact d'écriture au tableau :\n${exercise.exact_format_sample}`,
          );
        }

        const sent = await sendTextPrompt(promptParts.join('\n\n'), {
          sessionId: targetSessionId,
          courseId: course.id,
          moduleId: null,
        });

        if (!sent) {
          const seq = buildExerciseSimulationSequence(course, exercise);
          await runSimulationSequence(targetSessionId, seq);
        }
      } finally {
        setIsConnectingCourse(false);
      }
    },
    [connectCourseAndExplain, runSimulationSequence, sendTextPrompt],
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

  // Firebase Auth listener & Cloud Firestore synchronization
  useEffect(() => {
    void testFirestoreConnection();
    const unsubAuth = subscribeToCloudAuth((user) => {
      setCloudUser(user);
      if (user) {
        void ensureCloudUserProfile(user);
      }
    });
    return () => {
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!cloudUser?.uid) return;
    const uid = cloudUser.uid;
    let active = true;

    void fetchCloudCourses(uid).then((cloudCourses) => {
      if (!active || cloudCourses.length === 0) return;
      setCourses((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const additions = cloudCourses.filter((c) => !existingIds.has(c.id));
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
    });

    const unsubSessions = subscribeToCloudSessions(uid, (cloudSessions) => {
      if (!active) return;
      if (cloudSessions.length === 0) {
        const currentSess = activeSessionRef.current;
        if (currentSess) {
          void syncCloudSessionSnapshot(
            uid,
            currentSess,
            stepsRef.current,
            selectedVoiceRef.current,
          );
        }
        return;
      }
      setSessions((prev) => {
        const map = new Map<string, LessonSession>();
        for (const item of prev) map.set(item.id, item);
        for (const cs of cloudSessions) {
          if (!map.has(cs.id)) {
            map.set(cs.id, cs);
          }
        }
        return Array.from(map.values());
      });
    });

    return () => {
      active = false;
      unsubSessions();
    };
  }, [cloudUser?.uid]);

  const handleSignInCloud = useCallback(async () => {
    setCloudError(null);
    setIsCloudSyncing(true);
    try {
      const user = await signInWithGoogle();
      await ensureCloudUserProfile(user);
      if (activeSessionRef.current) {
        await syncCloudSessionSnapshot(
          user.uid,
          activeSessionRef.current,
          stepsRef.current,
          selectedVoiceRef.current,
        );
      }
      for (const course of coursesRef.current.slice(0, 12)) {
        await saveCloudCourse(user.uid, course);
      }
    } catch (err) {
      setCloudError(
        err instanceof Error ? err.message : 'Connexion Google Cloud annulée ou impossible.',
      );
    } finally {
      setIsCloudSyncing(false);
    }
  }, []);

  const handleSignOutCloud = useCallback(async () => {
    setCloudError(null);
    await signOutFromCloud();
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
            pendingPointerRef.current = null;
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
    if (cloudUserRef.current?.uid) {
      void createOrEnsureCloudSession(cloudUserRef.current.uid, created, selectedVoiceRef.current);
    }
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
    if (cloudUserRef.current?.uid) {
      void deleteCloudSession(cloudUserRef.current.uid, sessionId);
    }
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
    if (cloudUserRef.current?.uid) {
      void updateCloudSessionMeta(cloudUserRef.current.uid, updated.id, { title: newTitle });
    }
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
    if (cloudUserRef.current?.uid) {
      void clearCloudBoardSteps(cloudUserRef.current.uid, activeSession.id);
    }
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
    if (cloudUserRef.current?.uid) {
      void syncCloudSessionSnapshot(
        cloudUserRef.current.uid,
        activeSession,
        data.steps,
        selectedVoiceRef.current,
      );
    }
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
    if (cloudUserRef.current?.uid) {
      void updateCloudSessionMeta(cloudUserRef.current.uid, updated.id, {
        courseId: '',
        courseTitle: '',
        courseCode: '',
      });
    }
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
    if (cloudUserRef.current?.uid) {
      void saveCloudCourse(cloudUserRef.current.uid, created);
    }
    await refreshCoursesList();
    return created;
  };

  const handleDeleteCourse = async (courseId: string) => {
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/`, {
      method: 'DELETE',
    });
    if (cloudUserRef.current?.uid) {
      void deleteCloudCourse(cloudUserRef.current.uid, courseId);
    }
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
            className="min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 text-xs sm:text-sm font-medium text-stone-800 bg-[#FAF9F6] border border-[#D6D0C4] rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
              className="hidden sm:inline-flex min-h-[44px] items-center px-4 py-2 text-xs sm:text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
            isConnectingCourse={isConnectingCourse}
            isUploadingPdf={isUploadingPdf}
            pdfError={pdfError}
            onOpenCourseMenu={() => setIsCourseMenuOpen(true)}
            onQuickExplainCourse={(course, moduleId) => {
              void connectCourseAndExplain(course, moduleId, { shouldExplain: true });
            }}
            onUploadPdfForCourse={handleUploadPdfForCourse}
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
            onClearTranscripts={clearTranscripts}
            cloudUserEmail={cloudUser?.email ?? null}
            cloudUserName={cloudUser?.displayName ?? null}
            isCloudSyncing={isCloudSyncing}
            cloudError={cloudError}
            onSignInCloud={() => {
              void handleSignInCloud();
            }}
            onSignOutCloud={() => {
              void handleSignOutCloud();
            }}
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
          playbackSpeed={playbackSpeed}
          isBoardPaused={isBoardPaused}
          onChangePlaybackSpeed={setPlaybackSpeed}
          onToggleBoardPause={() => setIsBoardPaused((paused) => !paused)}
          onSelectLine={(stepNumber, lineNumber) => {
            pendingPointerRef.current = null;
            setActivePointer({
              step_number: stepNumber,
              line_number: lineNumber,
              label: 'Sélectionné',
            });
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
        isUploadingPdf={isUploadingPdf}
        pdfError={pdfError}
        onClose={() => setIsCourseMenuOpen(false)}
        onConnectAndExplain={async (course, moduleId) => {
          await connectCourseAndExplain(course, moduleId, { shouldExplain: true });
        }}
        onExplainPdfExercise={handleExplainPdfExercise}
        onSimulateCourse={handleSimulateCourse}
        onDisconnectCourse={handleDisconnectCourse}
        onUploadPdfForCourse={handleUploadPdfForCourse}
        onCreateCourse={handleCreateCourse}
        onDeleteCourse={handleDeleteCourse}
      />
    </div>
  );
}
