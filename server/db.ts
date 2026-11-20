import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  BoardStep,
  CourseItem,
  CourseModule,
  LessonSession,
  StepType,
} from '../src/types/board.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'professeur.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    professor_name TEXT NOT NULL DEFAULT 'Professeur UDBL',
    level TEXT NOT NULL DEFAULT 'L1 Informatique & Ingénierie',
    syllabus_title TEXT NOT NULL DEFAULT 'Syllabus officiel',
    summary TEXT NOT NULL DEFAULT '',
    modules_json TEXT NOT NULL DEFAULT '[]',
    is_official INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT 'gemini-3.8-live',
    course_id TEXT REFERENCES courses(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS board_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_number INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    highlight INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES lesson_sessions(id) ON DELETE CASCADE,
    UNIQUE (session_id, step_number)
  );
`);

// Safe migration if lesson_sessions existed prior to course_id column
const sessionColumns = db.prepare('PRAGMA table_info(lesson_sessions)').all() as Array<{ name: string }>;
if (!sessionColumns.some((col) => col.name === 'course_id')) {
  db.exec('ALTER TABLE lesson_sessions ADD COLUMN course_id TEXT REFERENCES courses(id) ON DELETE SET NULL');
}

interface RawCourseRow {
  id: string;
  code: string;
  title: string;
  professor_name: string;
  level: string;
  syllabus_title: string;
  summary: string;
  modules_json: string;
  is_official: number;
  created_at: string;
  updated_at: string;
}

interface RawSessionRow {
  id: string;
  title: string;
  model_name: string;
  course_id: string | null;
  course_title?: string | null;
  course_code?: string | null;
  created_at: string;
  updated_at: string;
  step_count?: number;
  last_step_title?: string | null;
}

interface RawStepRow {
  id: number;
  session_id: string;
  step_number: number;
  step_type: string;
  title: string;
  content: string;
  highlight: number;
  created_at: string;
}

const VALID_STEP_TYPES = new Set<StepType>(['etape', 'calcul', 'schema', 'code', 'exemple', 'synthese']);

export function normalizeStepType(input?: string): StepType {
  if (!input) return 'etape';
  const normalized = input.toLowerCase().trim() as StepType;
  return VALID_STEP_TYPES.has(normalized) ? normalized : 'etape';
}

function parseModules(raw: string): CourseModule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx) => ({
        id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `mod-${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : `Chapitre ${idx + 1}`,
        key_points: Array.isArray(item.key_points)
          ? item.key_points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
          : [],
        ...(typeof item.sample_prompt === 'string' && item.sample_prompt.trim()
          ? { sample_prompt: item.sample_prompt.trim() }
          : {}),
      }));
  } catch {
    return [];
  }
}

function mapCourse(row: RawCourseRow): CourseItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    professor_name: row.professor_name,
    level: row.level,
    syllabus_title: row.syllabus_title,
    summary: row.summary,
    modules: parseModules(row.modules_json),
    is_official: Boolean(row.is_official),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStep(row: RawStepRow): BoardStep {
  return {
    id: row.id,
    session_id: row.session_id,
    step_number: row.step_number,
    step_type: normalizeStepType(row.step_type),
    title: row.title,
    content: row.content,
    highlight: Boolean(row.highlight),
    created_at: row.created_at,
  };
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
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO courses (
      id, code, title, professor_name, level, syllabus_title, summary, modules_json, is_official, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const c of DEFAULT_UDBL_COURSES) {
      stmt.run(
        c.id,
        c.code,
        c.title,
        c.professor_name,
        c.level,
        c.syllabus_title,
        c.summary,
        JSON.stringify(c.modules),
        c.is_official ? 1 : 0,
        now,
        now,
      );
    }
  });
  tx();
}

export function listCourses(): CourseItem[] {
  const rows = db
    .prepare(
      `SELECT id, code, title, professor_name, level, syllabus_title, summary, modules_json, is_official, created_at, updated_at
       FROM courses
       ORDER BY is_official DESC, title ASC`,
    )
    .all() as RawCourseRow[];
  return rows.map(mapCourse);
}

export function getCourse(courseId: string): CourseItem | null {
  const row = db
    .prepare(
      `SELECT id, code, title, professor_name, level, syllabus_title, summary, modules_json, is_official, created_at, updated_at
       FROM courses WHERE id = ?`,
    )
    .get(courseId) as RawCourseRow | undefined;
  return row ? mapCourse(row) : null;
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
  is_official?: boolean;
}

export function upsertCourse(input: UpsertCourseInput): CourseItem {
  const now = new Date().toISOString();
  const cleanTitle = input.title.trim();
  const id =
    typeof input.id === 'string' && input.id.trim()
      ? input.id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
      : `custom-${crypto.randomUUID().slice(0, 8)}`;

  const code = (input.code?.trim() || 'COURS-RN').toUpperCase().slice(0, 24);
  const professorName = input.professor_name?.trim() || 'Professeur UDBL';
  const level = input.level?.trim() || 'L1 Informatique & Ingénierie';
  const syllabusTitle = input.syllabus_title?.trim() || `Support de cours · ${cleanTitle}`;
  const summary = input.summary?.trim() || `Cours personnalisé connecté depuis l’application : ${cleanTitle}.`;
  const modules = Array.isArray(input.modules) ? input.modules : [];
  const isOfficial = input.is_official ? 1 : 0;

  db.prepare(`
    INSERT INTO courses (
      id, code, title, professor_name, level, syllabus_title, summary, modules_json, is_official, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      title = excluded.title,
      professor_name = excluded.professor_name,
      level = excluded.level,
      syllabus_title = excluded.syllabus_title,
      summary = excluded.summary,
      modules_json = excluded.modules_json,
      updated_at = excluded.updated_at
  `).run(
    id,
    code,
    cleanTitle,
    professorName,
    level,
    syllabusTitle,
    summary,
    JSON.stringify(modules),
    isOfficial,
    now,
    now,
  );

  return getCourse(id)!;
}

export function deleteCourse(courseId: string): boolean {
  const result = db.prepare('DELETE FROM courses WHERE id = ? AND is_official = 0').run(courseId);
  return result.changes > 0;
}

export function listSessions(): LessonSession[] {
  const rows = db
    .prepare(
      `
      SELECT
        s.id,
        s.title,
        s.model_name,
        s.course_id,
        c.title AS course_title,
        c.code AS course_code,
        s.created_at,
        s.updated_at,
        COUNT(b.id) AS step_count,
        (
          SELECT b2.title
          FROM board_steps b2
          WHERE b2.session_id = s.id
          ORDER BY b2.highlight DESC, b2.step_number DESC
          LIMIT 1
        ) AS last_step_title
      FROM lesson_sessions s
      LEFT JOIN courses c ON c.id = s.course_id
      LEFT JOIN board_steps b ON b.session_id = s.id
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `,
    )
    .all() as RawSessionRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    model_name: row.model_name,
    course_id: row.course_id ?? null,
    course_title: row.course_title ?? null,
    course_code: row.course_code ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    step_count: Number(row.step_count ?? 0),
    last_step_title: row.last_step_title ?? null,
  }));
}

export function createSession(
  title?: string,
  modelName = 'gemini-3.8-live',
  courseId?: string | null,
): LessonSession {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const validCourse = courseId ? getCourse(courseId) : null;
  const countRow = db.prepare('SELECT COUNT(*) as total FROM lesson_sessions').get() as { total: number };
  const cleanTitle =
    title?.trim() ||
    (validCourse
      ? `Cours · ${validCourse.title}`
      : `Séance ${countRow.total + 1} · Tableau interactif`);

  db.prepare(
    `INSERT INTO lesson_sessions (id, title, model_name, course_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, cleanTitle, modelName, validCourse?.id ?? null, now, now);

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
  const session = db
    .prepare(
      `SELECT s.id, s.title, s.model_name, s.course_id, c.title AS course_title, c.code AS course_code, s.created_at, s.updated_at
       FROM lesson_sessions s
       LEFT JOIN courses c ON c.id = s.course_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as RawSessionRow | undefined;

  if (!session) return null;

  const steps = db
    .prepare(
      `SELECT id, session_id, step_number, step_type, title, content, highlight, created_at
       FROM board_steps
       WHERE session_id = ?
       ORDER BY step_number ASC, id ASC`,
    )
    .all(sessionId) as RawStepRow[];

  return {
    id: session.id,
    title: session.title,
    model_name: session.model_name,
    course_id: session.course_id ?? null,
    course_title: session.course_title ?? null,
    course_code: session.course_code ?? null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    step_count: steps.length,
    steps: steps.map(mapStep),
  };
}

export function deleteSession(sessionId: string): boolean {
  const result = db.prepare('DELETE FROM lesson_sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
}

export function updateSessionTitle(sessionId: string, title: string): LessonSession | null {
  const cleanTitle = title.trim();
  if (!cleanTitle) return getSession(sessionId);
  const now = new Date().toISOString();
  db.prepare('UPDATE lesson_sessions SET title = ?, updated_at = ? WHERE id = ?').run(
    cleanTitle,
    now,
    sessionId,
  );
  return getSession(sessionId);
}

export function connectCourseToSession(
  sessionId: string,
  courseId: string | null,
): LessonSession | null {
  const existing = db.prepare('SELECT id FROM lesson_sessions WHERE id = ?').get(sessionId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const validCourse = courseId ? getCourse(courseId) : null;
  if (courseId && !validCourse) {
    throw new Error('COURSE_NOT_FOUND');
  }
  db.prepare('UPDATE lesson_sessions SET course_id = ?, updated_at = ? WHERE id = ?').run(
    validCourse?.id ?? null,
    now,
    sessionId,
  );
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

const upsertStepTx = db.transaction((sessionId: string, input: UpsertStepInput) => {
  const existingSession = db.prepare('SELECT id, title FROM lesson_sessions WHERE id = ?').get(sessionId) as
    | { id: string; title: string }
    | undefined;
  if (!existingSession) {
    throw new Error('SESSION_NOT_FOUND');
  }

  const now = new Date().toISOString();
  const highlightFlag = input.highlight !== false ? 1 : 0;

  let stepNumber = Number(input.step_number);
  if (!Number.isInteger(stepNumber) || stepNumber <= 0) {
    const maxRow = db
      .prepare('SELECT COALESCE(MAX(step_number), 0) AS max_step FROM board_steps WHERE session_id = ?')
      .get(sessionId) as { max_step: number };
    stepNumber = maxRow.max_step + 1;
  }

  if (highlightFlag === 1) {
    db.prepare('UPDATE board_steps SET highlight = 0 WHERE session_id = ?').run(sessionId);
  }

  const stepType = normalizeStepType(input.step_type ?? input.type);
  const title = (input.title || `Étape ${stepNumber}`).trim();
  const content = (input.content || '').trim();

  db.prepare(
    `
    INSERT INTO board_steps (session_id, step_number, step_type, title, content, highlight, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, step_number) DO UPDATE SET
      step_type = excluded.step_type,
      title = excluded.title,
      content = excluded.content,
      highlight = excluded.highlight
  `,
  ).run(sessionId, stepNumber, stepType, title, content, highlightFlag, now);

  db.prepare('UPDATE lesson_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

  const savedRow = db
    .prepare(
      `SELECT id, session_id, step_number, step_type, title, content, highlight, created_at
       FROM board_steps
       WHERE session_id = ? AND step_number = ?`,
    )
    .get(sessionId, stepNumber) as RawStepRow;

  const allRows = db
    .prepare(
      `SELECT id, session_id, step_number, step_type, title, content, highlight, created_at
       FROM board_steps
       WHERE session_id = ?
       ORDER BY step_number ASC, id ASC`,
    )
    .all(sessionId) as RawStepRow[];

  return {
    step: mapStep(savedRow),
    steps: allRows.map(mapStep),
  };
});

export function upsertStep(sessionId: string, input: UpsertStepInput): { step: BoardStep; steps: BoardStep[] } {
  return upsertStepTx(sessionId, input);
}

export function clearSessionSteps(sessionId: string): boolean {
  const existing = db.prepare('SELECT id FROM lesson_sessions WHERE id = ?').get(sessionId);
  if (!existing) return false;
  const now = new Date().toISOString();
  db.prepare('DELETE FROM board_steps WHERE session_id = ?').run(sessionId);
  db.prepare('UPDATE lesson_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
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
