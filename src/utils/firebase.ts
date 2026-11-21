import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../../firebase-applet-config.json';
import type { BoardStep, CourseItem, LessonSession, StepType } from '../types/board.ts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
  };
}

const VALID_MODELS = new Set(['gemini-3.8-live', 'gemini-3.8-live-extended-thinking']);
const VALID_VOICES = new Set(['Charon', 'Zephyr', 'Kore', 'Fenrir', 'Puck']);
const VALID_STEP_TYPES = new Set<StepType>([
  'etape',
  'calcul',
  'schema',
  'code',
  'exemple',
  'synthese',
]);

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;

export function getFirebaseServices(): {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
} {
  if (!firebaseConfig?.projectId || !firebaseConfig?.apiKey) {
    return { app: null, auth: null, db: null };
  }
  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(cachedApp);
  }
  if (!cachedDb) {
    cachedDb = firebaseConfig.firestoreDatabaseId
      ? getFirestore(cachedApp, firebaseConfig.firestoreDatabaseId)
      : getFirestore(cachedApp);
  }
  return { app: cachedApp, auth: cachedAuth, db: cachedDb };
}

export function toFirestoreSafeId(raw: string | number | null | undefined, prefix = 'id'): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned || `${prefix}-${Date.now()}`;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  const { auth } = getFirebaseServices();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export async function testFirestoreConnection(): Promise<{
  ok: boolean;
  offline: boolean;
  message?: string;
}> {
  const { db } = getFirebaseServices();
  if (!db) return { ok: false, offline: true };
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, offline: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isOffline =
      message.includes('the client is offline') || message.includes('unavailable');
    if (isOffline) {
      console.warn('Firestore connection check: client appears offline.');
    }
    return { ok: !isOffline, offline: isOffline, message };
  }
}

export function subscribeToCloudAuth(callback: (user: User | null) => void): Unsubscribe {
  const { auth } = getFirebaseServices();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (firebaseUser) => {
    callback(firebaseUser ?? null);
  });
}

export async function signInWithGoogle(): Promise<User> {
  const { auth } = getFirebaseServices();
  if (!auth) {
    throw new Error('Configuration Firebase indisponible.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFromCloud(): Promise<void> {
  const { auth } = getFirebaseServices();
  if (!auth) return;
  await signOut(auth);
}

export async function ensureCloudUserProfile(firebaseUser: User): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !firebaseUser?.uid) return;
  const uid = firebaseUser.uid;
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  const displayName = (firebaseUser.displayName || firebaseUser.email || 'Étudiant UDBL').slice(
    0,
    120,
  );

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        displayName,
        matricule: '',
        role: 'student',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        matricule: String(snap.data()?.matricule ?? '').slice(0, 40),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function buildSessionPayload(
  uid: string,
  session: LessonSession,
  voiceName = 'Charon',
): {
  id: string;
  ownerUid: string;
  title: string;
  modelName: string;
  voiceName: string;
  courseId: string;
  courseTitle: string;
  courseCode: string;
  status: 'active';
  stepCount: number;
  lastStepTitle: string;
} {
  const safeId = toFirestoreSafeId(session.id, 'session');
  const modelName = VALID_MODELS.has(session.model_name)
    ? session.model_name
    : 'gemini-3.8-live';
  const safeVoice = VALID_VOICES.has(voiceName) ? voiceName : 'Charon';

  return {
    id: safeId,
    ownerUid: uid,
    title: String(session.title || 'Séance Professeur').trim().slice(0, 160) || 'Séance Professeur',
    modelName,
    voiceName: safeVoice,
    courseId: String(session.course_id ?? '').slice(0, 128),
    courseTitle: String(session.course_title ?? '').slice(0, 200),
    courseCode: String(session.course_code ?? '').slice(0, 40),
    status: 'active',
    stepCount: Math.max(0, Math.min(500, Math.trunc(Number(session.step_count ?? 0) || 0))),
    lastStepTitle: String(session.last_step_title ?? '').slice(0, 200),
  };
}

export async function createOrEnsureCloudSession(
  uid: string,
  session: LessonSession,
  voiceName = 'Charon',
): Promise<string | null> {
  const { db } = getFirebaseServices();
  if (!db || !uid) return null;
  const payload = buildSessionPayload(uid, session, voiceName);
  const path = `users/${uid}/prof_sessions/${payload.id}`;
  const ref = doc(db, 'users', uid, 'prof_sessions', payload.id);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return payload.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
    return null;
  }
}

export async function updateCloudSessionMeta(
  uid: string,
  sessionId: string,
  patch: {
    title?: string;
    modelName?: string;
    voiceName?: string;
    courseId?: string | null;
    courseTitle?: string | null;
    courseCode?: string | null;
  },
): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !sessionId) return;
  const safeId = toFirestoreSafeId(sessionId, 'session');
  const path = `users/${uid}/prof_sessions/${safeId}`;
  const ref = doc(db, 'users', uid, 'prof_sessions', safeId);

  const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (patch.title !== undefined) {
    updates.title = String(patch.title || 'Séance').trim().slice(0, 160) || 'Séance';
  }
  if (patch.modelName !== undefined && VALID_MODELS.has(patch.modelName)) {
    updates.modelName = patch.modelName;
  }
  if (patch.voiceName !== undefined && VALID_VOICES.has(patch.voiceName)) {
    updates.voiceName = patch.voiceName;
  }
  if (patch.courseId !== undefined) {
    updates.courseId = String(patch.courseId ?? '').slice(0, 128);
  }
  if (patch.courseTitle !== undefined) {
    updates.courseTitle = String(patch.courseTitle ?? '').slice(0, 200);
  }
  if (patch.courseCode !== undefined) {
    updates.courseCode = String(patch.courseCode ?? '').slice(0, 40);
  }

  try {
    await updateDoc(ref, updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateCloudSessionSummary(
  uid: string,
  sessionId: string,
  stepCount: number,
  lastStepTitle: string,
): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !sessionId) return;
  const safeId = toFirestoreSafeId(sessionId, 'session');
  const path = `users/${uid}/prof_sessions/${safeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'prof_sessions', safeId), {
      stepCount: Math.max(0, Math.min(500, Math.trunc(Number(stepCount) || 0))),
      lastStepTitle: String(lastStepTitle || '').slice(0, 200),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertCloudBoardStep(
  uid: string,
  session: LessonSession,
  step: BoardStep,
  voiceName = 'Charon',
): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !session?.id) return;
  const safeSessionId = await createOrEnsureCloudSession(uid, session, voiceName);
  if (!safeSessionId) return;

  const stepNum = Math.max(1, Math.min(500, Math.trunc(Number(step.step_number) || 1)));
  const stepId = `step-${stepNum}`;
  const stepType: StepType = VALID_STEP_TYPES.has(step.step_type) ? step.step_type : 'etape';
  const title = String(step.title || `Étape ${stepNum}`).trim().slice(0, 200) || `Étape ${stepNum}`;
  const content = String(step.content || '').slice(0, 8000);
  const highlight = Boolean(step.highlight);

  const path = `users/${uid}/prof_sessions/${safeSessionId}/steps/${stepId}`;
  const ref = doc(db, 'users', uid, 'prof_sessions', safeSessionId, 'steps', stepId);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        id: stepId,
        ownerUid: uid,
        sessionId: safeSessionId,
        stepNumber: stepNum,
        stepType,
        title,
        content,
        highlight,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        stepType,
        title,
        content,
        highlight,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function syncCloudSessionSnapshot(
  uid: string,
  session: LessonSession,
  steps: BoardStep[],
  voiceName = 'Charon',
): Promise<void> {
  const safeSessionId = await createOrEnsureCloudSession(uid, session, voiceName);
  if (!safeSessionId) return;
  for (const step of steps) {
    await upsertCloudBoardStep(uid, session, step, voiceName);
  }
  const highlighted = steps.find((s) => s.highlight) ?? steps[steps.length - 1];
  await updateCloudSessionSummary(uid, safeSessionId, steps.length, highlighted?.title ?? '');
}

export async function clearCloudBoardSteps(uid: string, sessionId: string): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !sessionId) return;
  const safeId = toFirestoreSafeId(sessionId, 'session');
  const stepsColPath = `users/${uid}/prof_sessions/${safeId}/steps`;

  try {
    const q = query(
      collection(db, 'users', uid, 'prof_sessions', safeId, 'steps'),
      where('ownerUid', '==', uid),
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
    }
    await updateCloudSessionSummary(uid, safeId, 0, '');
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, stepsColPath);
  }
}

export async function deleteCloudSession(uid: string, sessionId: string): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !sessionId) return;
  const safeId = toFirestoreSafeId(sessionId, 'session');
  await clearCloudBoardSteps(uid, safeId);
  const path = `users/${uid}/prof_sessions/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'prof_sessions', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveCloudCourse(uid: string, course: CourseItem): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !course?.id) return;
  const safeId = toFirestoreSafeId(course.id, 'course');
  const path = `users/${uid}/prof_courses/${safeId}`;
  const ref = doc(db, 'users', uid, 'prof_courses', safeId);

  const modules = Array.isArray(course.modules)
    ? course.modules.slice(0, 20).map((m, idx) => ({
        id: String(m?.id || `mod-${idx + 1}`).slice(0, 80),
        title: String(m?.title || `Module ${idx + 1}`).slice(0, 160),
        key_points: Array.isArray(m?.key_points)
          ? m.key_points.slice(0, 10).map((pt) => String(pt).slice(0, 200))
          : [],
      }))
    : [];

  const profile = course.pdf_profile ?? null;
  const payload = {
    id: safeId,
    ownerUid: uid,
    code: String(course.code || 'UDBL').trim().slice(0, 40) || 'UDBL',
    title: String(course.title || 'Cours UDBL').trim().slice(0, 200) || 'Cours UDBL',
    professorName: String(course.professor_name || '').slice(0, 160),
    level: String(course.level || 'L1 UDBL').slice(0, 120),
    syllabusTitle: String(course.syllabus_title || '').slice(0, 200),
    summary: String(course.summary || '').slice(0, 2000),
    modules,
    hasPdfProfile: Boolean(profile),
    pdfFilename: String(profile?.filename || '').slice(0, 160),
    pdfWritingStyle: String(profile?.writing_style || '').slice(0, 1000),
    pdfNotationConventions: String(profile?.notation_conventions || '').slice(0, 1000),
    pdfMethodologyPattern: String(profile?.methodology_pattern || '').slice(0, 1000),
  };

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        title: payload.title,
        professorName: payload.professorName,
        level: payload.level,
        syllabusTitle: payload.syllabusTitle,
        summary: payload.summary,
        modules: payload.modules,
        hasPdfProfile: payload.hasPdfProfile,
        pdfFilename: payload.pdfFilename,
        pdfWritingStyle: payload.pdfWritingStyle,
        pdfNotationConventions: payload.pdfNotationConventions,
        pdfMethodologyPattern: payload.pdfMethodologyPattern,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteCloudCourse(uid: string, courseId: string): Promise<void> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !courseId) return;
  const safeId = toFirestoreSafeId(courseId, 'course');
  const path = `users/${uid}/prof_courses/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'prof_courses', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchCloudCourses(uid: string): Promise<CourseItem[]> {
  const { db } = getFirebaseServices();
  if (!db || !uid) return [];
  const path = `users/${uid}/prof_courses`;
  try {
    const q = query(collection(db, 'users', uid, 'prof_courses'), where('ownerUid', '==', uid));
    const snap = await getDocs(q);
    const items: CourseItem[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const updatedIso = d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString();
      const createdIso = d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : updatedIso;
      items.push({
        id: String(d.id),
        code: String(d.code || 'UDBL'),
        title: String(d.title || 'Cours UDBL'),
        professor_name: String(d.professorName || 'Professeur UDBL'),
        level: String(d.level || 'L1 UDBL'),
        syllabus_title: String(d.syllabusTitle || 'Programme synchronisé'),
        summary: String(d.summary || ''),
        modules: Array.isArray(d.modules) ? d.modules : [],
        pdf_profile: d.hasPdfProfile
          ? {
              filename: String(d.pdfFilename || 'document.pdf'),
              analyzed_at: updatedIso,
              writing_style: String(d.pdfWritingStyle || ''),
              notation_conventions: String(d.pdfNotationConventions || ''),
              methodology_pattern: String(d.pdfMethodologyPattern || ''),
              exercises: [],
              verbatim_excerpts: [],
            }
          : null,
        is_official: false,
        created_at: createdIso,
        updated_at: updatedIso,
      });
    });
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function fetchCloudSessionSteps(uid: string, sessionId: string): Promise<BoardStep[]> {
  const { db } = getFirebaseServices();
  if (!db || !uid || !sessionId) return [];
  const safeId = toFirestoreSafeId(sessionId, 'session');
  const path = `users/${uid}/prof_sessions/${safeId}/steps`;
  try {
    const q = query(
      collection(db, 'users', uid, 'prof_sessions', safeId, 'steps'),
      where('ownerUid', '==', uid),
      orderBy('stepNumber', 'asc'),
    );
    const snap = await getDocs(q);
    const list: BoardStep[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const stepNum = Number(d.stepNumber) || 1;
      list.push({
        id: stepNum,
        session_id: String(d.sessionId || safeId),
        step_number: stepNum,
        step_type: (d.stepType as StepType) || 'etape',
        title: String(d.title || `Étape ${stepNum}`),
        content: String(d.content || ''),
        highlight: Boolean(d.highlight),
        created_at: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
      });
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export function subscribeToCloudSessions(
  uid: string,
  onSessions: (sessions: LessonSession[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const { db } = getFirebaseServices();
  if (!db || !uid) return () => {};
  const path = `users/${uid}/prof_sessions`;
  const q = query(
    collection(db, 'users', uid, 'prof_sessions'),
    where('ownerUid', '==', uid),
    orderBy('updatedAt', 'desc'),
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: LessonSession[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const updatedIso = d.updatedAt?.toDate
          ? d.updatedAt.toDate().toISOString()
          : new Date().toISOString();
        const createdIso = d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : updatedIso;
        items.push({
          id: String(d.id),
          title: String(d.title || 'Séance Professeur'),
          model_name: String(d.modelName || 'gemini-3.8-live'),
          course_id: d.courseId ? String(d.courseId) : null,
          course_title: d.courseTitle ? String(d.courseTitle) : null,
          course_code: d.courseCode ? String(d.courseCode) : null,
          created_at: createdIso,
          updated_at: updatedIso,
          step_count: Number(d.stepCount) || 0,
          last_step_title: d.lastStepTitle ? String(d.lastStepTitle) : null,
        });
      });
      onSessions(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      onError?.(error);
    },
  );
}
