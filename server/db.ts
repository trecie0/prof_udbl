import crypto from 'node:crypto';
import type {
  BoardStep,
  CourseItem,
  CourseModule,
  LessonSession,
  PdfStyleProfile,
  StepType,
} from '../src/types/board.ts';

interface StoredSession {
  id: string;
  title: string;
  model_name: string;
  course_id: string | null;
  created_at: string;
  updated_at: string;
}

const coursesStore = new Map<string, CourseItem>();
const sessionsStore = new Map<string, StoredSession>();
const stepsBySessionStore = new Map<string, BoardStep[]>();
let nextStepId = 1;

const VALID_STEP_TYPES = new Set<StepType>(['etape', 'calcul', 'schema', 'code', 'exemple', 'synthese']);

export function normalizeStepType(input?: string): StepType {
  if (!input) return 'etape';
  const normalized = input.toLowerCase().trim() as StepType;
  return VALID_STEP_TYPES.has(normalized) ? normalized : 'etape';
}

function cloneCourse(course: CourseItem): CourseItem {
  return {
    ...course,
    modules: course.modules.map((m) => ({
      ...m,
      key_points: [...m.key_points],
    })),
    pdf_profile: course.pdf_profile
      ? {
          ...course.pdf_profile,
          exercises: course.pdf_profile.exercises.map((ex) => ({
            ...ex,
            method_steps: [...ex.method_steps],
          })),
          verbatim_excerpts: [...course.pdf_profile.verbatim_excerpts],
        }
      : null,
  };
}

function cloneStep(step: BoardStep): BoardStep {
  return { ...step };
}

const DEFAULT_UDBL_COURSES: Array<Omit<CourseItem, 'created_at' | 'updated_at'>> = [
  {
    id: 'udbl-algebre-l1',
    code: 'MATH-101',
    title: 'Algèbre L1',
    professor_name: 'Prof. Kalenga',
    level: 'L1 Informatique & Ingénierie',
    syllabus_title: 'Syllabus officiel · Algèbre linéaire & structures',
    summary:
      'Bases algébriques indispensables en informatique : ensembles, matrices, déterminants, systèmes linéaires et méthode de Gauss.',
    is_official: true,
    modules: [
      {
        id: 'alg-matrices',
        title: 'Matrices & opérations élémentaires',
        key_points: [
          'Addition et multiplication matricielle (compatibilité des dimensions)',
          'Matrice identité, transposée et matrice inverse',
          'Application aux transformations et graphes',
        ],
      },
      {
        id: 'alg-gauss',
        title: 'Résolution de systèmes par le pivot de Gauss',
        key_points: [
          'Mise sous forme échelonnée',
          'Opérations élémentaires sur les lignes',
          'Interprétation géométrique (solution unique, infinité ou impossible)',
        ],
      },
      {
        id: 'alg-det',
        title: 'Déterminant et inversibilité',
        key_points: [
          'Calcul du déterminant 2x2 et règle de Sarrus (3x3)',
          'Critère d’inversibilité : det(A) != 0',
          'Formule de Cramer sur petits systèmes',
        ],
      },
    ],
  },
  {
    id: 'udbl-prog-algo',
    code: 'INFO-102',
    title: 'Programmation et algorithmes',
    professor_name: 'Prof. Mwamba',
    level: 'L1 Informatique & Ingénierie',
    syllabus_title: 'Syllabus officiel · Algorithmique & Python / C',
    summary:
      'Conception d’algorithmes structurés : variables, conditions, boucles, tableaux, fonctions récursives et complexité asymptotique.',
    is_official: true,
    modules: [
      {
        id: 'algo-boucles',
        title: 'Structures itératives (for & while)',
        key_points: [
          'Condition d’arrêt et invariant de boucle',
          'Parcours de tableaux et accumulateurs',
          'Trace d’exécution pas à pas',
        ],
      },
      {
        id: 'algo-recursivite',
        title: 'Fonctions récursives & pile d’appels',
        key_points: [
          'Cas de base et cas récursif',
          'Arbre d’appels (factorielle, Fibonacci)',
          'Comparaison itératif vs récursif',
        ],
      },
      {
        id: 'algo-complexite',
        title: 'Complexité temporelle Big-O',
        key_points: [
          'O(1), O(log n), O(n), O(n²)',
          'Recherche linéaire vs recherche dichotomique',
          'Tri par insertion et tri fusion',
        ],
      },
    ],
  },
  {
    id: 'udbl-logique-formelle',
    code: 'LOG-103',
    title: 'Logique formelle',
    professor_name: 'Prof. Ilunga',
    level: 'L1 Informatique & Ingénierie',
    syllabus_title: 'Syllabus officiel · Calcul propositionnel & prédicats',
    summary:
      'Fondements du raisonnement logique et des circuits numériques : connecteurs, tables de vérité, lois de De Morgan et quantificateurs.',
    is_official: true,
    modules: [
      {
        id: 'log-connecteurs',
        title: 'Propositions et tables de vérité',
        key_points: [
          'Négation (NON), conjonction (ET), disjonction (OU)',
          'Implication (P => Q) et contraposée',
          'Tautologie, contradiction et équivalence logique',
        ],
      },
      {
        id: 'log-demorgan',
        title: 'Lois de De Morgan & simplification',
        key_points: [
          'NON(A ET B) = (NON A) OU (NON B)',
          'NON(A OU B) = (NON A) ET (NON B)',
          'Application aux conditions if/else en programmation',
        ],
      },
      {
        id: 'log-quantificateurs',
        title: 'Quantificateurs universel et existentiel',
        key_points: [
          'Pour tout x (∀) et il existe x (∃)',
          'Négation d’une proposition quantifiée',
          'Démonstration par l’absurde et par récurrence',
        ],
      },
    ],
  },
  {
    id: 'udbl-recherche-doc',
    code: 'DOC-104',
    title: 'Recherche documentaire',
    professor_name: 'Prof. Kabongo',
    level: 'L1 Informatique & Ingénierie',
    syllabus_title: 'Syllabus officiel · Méthodologie de recherche scientifique',
    summary:
      'Méthodes de recherche d’information fiable, formulation d’équations booléennes, évaluation critique des sources et normes de citation.',
    is_official: true,
    modules: [
      {
        id: 'doc-booleen',
        title: 'Équations de recherche & opérateurs booléens',
        key_points: [
          'Opérateurs AND, OR, NOT et guillemets exacts',
          'Ciblage par mots-clés et troncature',
          'Affinage progressif des requêtes académiques',
        ],
      },
      {
        id: 'doc-fiabilite',
        title: 'Évaluation critique & normes de citation',
        key_points: [
          'Vérification de l’auteur, date, éditeur et revue par les pairs',
          'Prévention du plagiat et citation APA / IEEE',
          'Constitution d’une bibliographie structurée',
        ],
      },
    ],
  },
  {
    id: 'udbl-citoyennete',
    code: 'CIV-105',
    title: 'Éducation à la citoyenneté',
    professor_name: 'Prof. Mutombo',
    level: 'L1 Informatique & Ingénierie',
    syllabus_title: 'Syllabus officiel · Éthique civique & responsabilité numérique',
    summary:
      'Droits et devoirs du citoyen, fonctionnement des institutions, éthique professionnelle de l’ingénieur et citoyenneté numérique.',
    is_official: true,
    modules: [
      {
        id: 'civ-valeurs',
        title: 'État de droit, droits et devoirs civiques',
        key_points: [
          'Principes démocratiques et séparation des pouvoirs',
          'Participation citoyenne et bien commun',
          'Responsabilité sociale de l’étudiant universitaire',
        ],
      },
      {
        id: 'civ-ethique-num',
        title: 'Éthique numérique & responsabilité de l’ingénieur',
        key_points: [
          'Protection des données personnelles et vie privée',
          'Lutte contre la désinformation et cyberéthique',
          'Propriété intellectuelle et logiciels libres',
        ],
      },
    ],
  },
];

export function ensureDefaultCourses(): void {
  const now = new Date().toISOString();
  for (const c of DEFAULT_UDBL_COURSES) {
    if (!coursesStore.has(c.id)) {
      coursesStore.set(c.id, {
        ...c,
        pdf_profile: null,
        created_at: now,
        updated_at: now,
      });
    }
  }
}

export function listCourses(): CourseItem[] {
  return Array.from(coursesStore.values())
    .sort((a, b) => {
      if (a.is_official !== b.is_official) {
        return a.is_official ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    })
    .map(cloneCourse);
}

export function getCourse(courseId: string): CourseItem | null {
  const course = coursesStore.get(courseId);
  return course ? cloneCourse(course) : null;
}

export interface UpsertCourseInput {
  id?: string;
  code?: string;
  title: string;
  professor_name?: string;
  level?: string;
  syllabus_title?: string;
  summary?: string;
  modules?: CourseModule[];
  pdf_profile?: PdfStyleProfile | null;
  is_official?: boolean;
}

export function upsertCourse(input: UpsertCourseInput): CourseItem {
  const now = new Date().toISOString();
  const cleanTitle = input.title.trim();
  const id =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
      : `custom-${crypto.randomUUID().slice(0, 8)}`;

  const existing = coursesStore.get(id);
  const code = (input.code?.trim() || 'COURS-RN').toUpperCase().slice(0, 24);
  const professorName = input.professor_name?.trim() || 'Professeur UDBL';
  const level = input.level?.trim() || 'L1 Informatique & Ingénierie';
  const syllabusTitle = input.syllabus_title?.trim() || `Support de cours · ${cleanTitle}`;
  const summary = input.summary?.trim() || `Cours personnalisé connecté depuis l’application : ${cleanTitle}.`;
  const modules = Array.isArray(input.modules) ? input.modules : [];
  const pdfProfile =
    input.pdf_profile !== undefined ? input.pdf_profile : existing?.pdf_profile ?? null;
  const isOfficial = existing ? existing.is_official : Boolean(input.is_official);

  const saved: CourseItem = {
    id,
    code,
    title: cleanTitle,
    professor_name: professorName,
    level,
    syllabus_title: syllabusTitle,
    summary,
    modules,
    pdf_profile: pdfProfile ?? null,
    is_official: isOfficial,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  coursesStore.set(id, saved);
  return cloneCourse(saved);
}

export function attachPdfProfileToCourse(
  courseId: string,
  profile: PdfStyleProfile,
  options?: {
    summary?: string;
    modules?: CourseModule[];
    syllabus_title?: string;
  },
): CourseItem | null {
  const existing = coursesStore.get(courseId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const nextModules =
    options?.modules && options.modules.length > 0 ? options.modules : existing.modules;
  const nextSummary =
    options?.summary && options.summary.trim() ? options.summary.trim() : existing.summary;
  const nextSyllabusTitle =
    options?.syllabus_title && options.syllabus_title.trim()
      ? options.syllabus_title.trim()
      : `PDF adapté · ${profile.filename}`;

  const updated: CourseItem = {
    ...existing,
    pdf_profile: profile,
    summary: nextSummary,
    modules: nextModules,
    syllabus_title: nextSyllabusTitle,
    updated_at: now,
  };

  coursesStore.set(courseId, updated);
  return cloneCourse(updated);
}

export function deleteCourse(courseId: string): boolean {
  const existing = coursesStore.get(courseId);
  if (!existing || existing.is_official) {
    return false;
  }
  coursesStore.delete(courseId);
  for (const session of sessionsStore.values()) {
    if (session.course_id === courseId) {
      session.course_id = null;
    }
  }
  return true;
}

export function listSessions(): LessonSession[] {
  return Array.from(sessionsStore.values())
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((session) => {
      const course = session.course_id ? coursesStore.get(session.course_id) : null;
      const steps = stepsBySessionStore.get(session.id) ?? [];
      const sortedForLast = [...steps].sort((a, b) => {
        if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
        return b.step_number - a.step_number;
      });
      return {
        id: session.id,
        title: session.title,
        model_name: session.model_name,
        course_id: course ? course.id : null,
        course_title: course ? course.title : null,
        course_code: course ? course.code : null,
        created_at: session.created_at,
        updated_at: session.updated_at,
        step_count: steps.length,
        last_step_title: sortedForLast[0]?.title ?? null,
      };
    });
}

export function createSession(
  title?: string,
  modelName = 'gemini-3.8-live',
  courseId?: string | null,
): LessonSession {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const validCourse = courseId ? coursesStore.get(courseId) ?? null : null;
  const cleanTitle =
    title?.trim() ||
    (validCourse
      ? `Cours · ${validCourse.title}`
      : `Séance ${sessionsStore.size + 1} · Tableau interactif`);

  const stored: StoredSession = {
    id,
    title: cleanTitle,
    model_name: modelName,
    course_id: validCourse?.id ?? null,
    created_at: now,
    updated_at: now,
  };
  sessionsStore.set(id, stored);
  stepsBySessionStore.set(id, []);

  return {
    id,
    title: cleanTitle,
    model_name: modelName,
    course_id: validCourse?.id ?? null,
    course_title: validCourse?.title ?? null,
    course_code: validCourse?.code ?? null,
    created_at: now,
    updated_at: now,
    step_count: 0,
    last_step_title: null,
    steps: [],
  };
}

export function getSession(sessionId: string): LessonSession | null {
  const session = sessionsStore.get(sessionId);
  if (!session) return null;

  const course = session.course_id ? coursesStore.get(session.course_id) ?? null : null;
  const steps = [...(stepsBySessionStore.get(sessionId) ?? [])].sort((a, b) => {
    if (a.step_number !== b.step_number) return a.step_number - b.step_number;
    return a.id - b.id;
  });

  return {
    id: session.id,
    title: session.title,
    model_name: session.model_name,
    course_id: course ? course.id : null,
    course_title: course ? course.title : null,
    course_code: course ? course.code : null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    step_count: steps.length,
    steps: steps.map(cloneStep),
  };
}

export function deleteSession(sessionId: string): boolean {
  const deleted = sessionsStore.delete(sessionId);
  stepsBySessionStore.delete(sessionId);
  return deleted;
}

export function updateSessionTitle(sessionId: string, title: string): LessonSession | null {
  const session = sessionsStore.get(sessionId);
  if (!session) return null;
  const cleanTitle = title.trim();
  if (!cleanTitle) return getSession(sessionId);

  session.title = cleanTitle;
  session.updated_at = new Date().toISOString();
  return getSession(sessionId);
}

export function connectCourseToSession(
  sessionId: string,
  courseId: string | null,
): LessonSession | null {
  const session = sessionsStore.get(sessionId);
  if (!session) return null;

  const validCourse = courseId ? coursesStore.get(courseId) ?? null : null;
  if (courseId && !validCourse) {
    throw new Error('COURSE_NOT_FOUND');
  }

  session.course_id = validCourse?.id ?? null;
  session.updated_at = new Date().toISOString();
  return getSession(sessionId);
}

export interface UpsertStepInput {
  step_number?: number;
  step_type?: string;
  type?: string;
  title: string;
  content: string;
  highlight?: boolean;
}

export function upsertStep(sessionId: string, input: UpsertStepInput): { step: BoardStep; steps: BoardStep[] } {
  const session = sessionsStore.get(sessionId);
  if (!session) {
    throw new Error('SESSION_NOT_FOUND');
  }

  const now = new Date().toISOString();
  const highlightFlag = input.highlight !== false;
  const steps = stepsBySessionStore.get(sessionId) ?? [];

  let stepNumber = Number(input.step_number);
  if (!Number.isInteger(stepNumber) || stepNumber <= 0) {
    const maxStep = steps.reduce((max, s) => Math.max(max, s.step_number), 0);
    stepNumber = maxStep + 1;
  }

  if (highlightFlag) {
    for (const s of steps) {
      s.highlight = false;
    }
  }

  const stepType = normalizeStepType(input.step_type ?? input.type);
  const title = (input.title || `Étape ${stepNumber}`).trim();
  const content = (input.content || '').trim();

  let savedStep = steps.find((s) => s.step_number === stepNumber);
  if (savedStep) {
    savedStep.step_type = stepType;
    savedStep.title = title;
    savedStep.content = content;
    savedStep.highlight = highlightFlag;
  } else {
    savedStep = {
      id: nextStepId++,
      session_id: sessionId,
      step_number: stepNumber,
      step_type: stepType,
      title,
      content,
      highlight: highlightFlag,
      created_at: now,
    };
    steps.push(savedStep);
  }

  stepsBySessionStore.set(sessionId, steps);
  session.updated_at = now;

  const sortedSteps = [...steps].sort((a, b) => {
    if (a.step_number !== b.step_number) return a.step_number - b.step_number;
    return a.id - b.id;
  });

  return {
    step: cloneStep(savedStep),
    steps: sortedSteps.map(cloneStep),
  };
}

export function clearSessionSteps(sessionId: string): boolean {
  const session = sessionsStore.get(sessionId);
  if (!session) return false;
  stepsBySessionStore.set(sessionId, []);
  session.updated_at = new Date().toISOString();
  return true;
}

export function ensureInitialSession(): LessonSession {
  ensureDefaultCourses();
  const sessions = listSessions();
  if (sessions.length > 0) {
    return getSession(sessions[0].id)!;
  }
  return createSession('Séance 1 · Introduction au cours', 'gemini-3.8-live', 'udbl-prog-algo');
}
