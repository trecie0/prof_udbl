import type { BoardPointer, BoardStep, CourseItem, LiveConnectionState } from '../types/board.ts';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

export type ReactNativeOutboundEvent =
  | { type: 'READY'; embed: boolean; sessionId: string | null; courseId: string | null }
  | { type: 'COURSE_CONNECTED'; sessionId: string; course: CourseItem | null; moduleId: string | null }
  | { type: 'BOARD_UPDATED'; sessionId: string; steps: BoardStep[] }
  | { type: 'POINTER_MOVED'; pointer: BoardPointer }
  | { type: 'LIVE_STATE_CHANGED'; state: LiveConnectionState; isTeacherSpeaking: boolean }
  | { type: 'TRANSCRIPT'; role: 'student' | 'teacher' | 'system'; text: string };

export type ReactNativeInboundCommand =
  | { type: 'CONNECT_COURSE'; courseId: string; moduleId?: string; autoExplain?: boolean }
  | { type: 'SYNC_COURSES'; courses: Array<Partial<CourseItem> & { title: string }> }
  | { type: 'ASK_PROFESSOR'; text: string }
  | { type: 'START_LIVE' }
  | { type: 'STOP_LIVE' }
  | { type: 'CLEAR_BOARD' };

export interface LaunchBridgeParams {
  isEmbed: boolean;
  courseId: string | null;
  moduleId: string | null;
  autoExplain: boolean;
}

export function isEmbeddedInReactNative(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ReactNativeWebView?.postMessage);
}

export function parseInitialLaunchParams(): LaunchBridgeParams {
  if (typeof window === 'undefined') {
    return { isEmbed: false, courseId: null, moduleId: null, autoExplain: false };
  }
  const params = new URLSearchParams(window.location.search);
  const embedRaw = params.get('embed');
  const isEmbed = embedRaw === '1' || embedRaw === 'true' || isEmbeddedInReactNative();
  const courseId = params.get('courseId')?.trim() || null;
  const moduleId = params.get('moduleId')?.trim() || null;
  const autoExplain = params.get('autoExplain') === '1' || params.get('autoExplain') === 'true';

  return { isEmbed, courseId, moduleId, autoExplain };
}

export function postToReactNative(event: ReactNativeOutboundEvent): void {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({
    source: 'professeur-au-tableau',
    timestamp: new Date().toISOString(),
    ...event,
  });

  try {
    window.ReactNativeWebView?.postMessage(payload);
  } catch {
    // Ignore native bridge posting errors
  }

  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage(payload, '*');
    } catch {
      // Ignore parent frame posting errors
    }
  }
}

export function subscribeToReactNativeCommands(
  onCommand: (cmd: ReactNativeInboundCommand) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleRawMessage = (raw: unknown) => {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
    }
    if (!parsed || typeof parsed !== 'object') return;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.type !== 'string') return;

    switch (obj.type) {
      case 'CONNECT_COURSE':
        if (typeof obj.courseId === 'string' && obj.courseId.trim()) {
          onCommand({
            type: 'CONNECT_COURSE',
            courseId: obj.courseId.trim(),
            moduleId: typeof obj.moduleId === 'string' ? obj.moduleId.trim() : undefined,
            autoExplain: Boolean(obj.autoExplain),
          });
        }
        break;
      case 'SYNC_COURSES':
        if (Array.isArray(obj.courses)) {
          const validCourses = obj.courses.filter(
            (c): c is Partial<CourseItem> & { title: string } =>
              Boolean(c && typeof c === 'object' && typeof (c as Record<string, unknown>).title === 'string'),
          );
          if (validCourses.length > 0) {
            onCommand({ type: 'SYNC_COURSES', courses: validCourses });
          }
        }
        break;
      case 'ASK_PROFESSOR':
        if (typeof obj.text === 'string' && obj.text.trim()) {
          onCommand({ type: 'ASK_PROFESSOR', text: obj.text.trim() });
        }
        break;
      case 'START_LIVE':
        onCommand({ type: 'START_LIVE' });
        break;
      case 'STOP_LIVE':
        onCommand({ type: 'STOP_LIVE' });
        break;
      case 'CLEAR_BOARD':
        onCommand({ type: 'CLEAR_BOARD' });
        break;
    }
  };

  const onWindowMessage = (event: MessageEvent) => {
    handleRawMessage(event.data);
  };

  // react-native-webview dispatches 'message' on document on Android and window on iOS
  const onDocumentMessage = (event: Event) => {
    const msgEvent = event as MessageEvent;
    handleRawMessage(msgEvent.data);
  };

  window.addEventListener('message', onWindowMessage);
  document.addEventListener('message', onDocumentMessage);

  return () => {
    window.removeEventListener('message', onWindowMessage);
    document.removeEventListener('message', onDocumentMessage);
  };
}
