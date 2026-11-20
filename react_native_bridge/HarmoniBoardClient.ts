export interface CourseModuleInput {
  id: string;
  title: string;
  key_points: string[];
}

export interface SyncCoursePayload {
  id?: string;
  code: string;
  title: string;
  professor_name?: string;
  level?: string;
  syllabus_title?: string;
  summary?: string;
  modules?: CourseModuleInput[];
}

export class HarmoniBoardClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async listCourses() {
    const res = await fetch(`${this.baseUrl}/api/courses`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async syncCourseFromUdbl(course: SyncCoursePayload) {
    const res = await fetch(`${this.baseUrl}/api/courses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Platform': 'react-native-expo',
      },
      body: JSON.stringify(course),
    });
    if (!res.ok) throw new Error(`Sync course failed (${res.status})`);
    return res.json();
  }

  async createLessonSession(courseId?: string, title?: string) {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId, title }),
    });
    if (!res.ok) throw new Error(`Create session failed (${res.status})`);
    return res.json();
  }

  async connectCourseToSession(sessionId: string, courseId: string | null) {
    const res = await fetch(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/connect-course`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: courseId }),
    });
    if (!res.ok) throw new Error(`Connect course failed (${res.status})`);
    return res.json();
  }

  /**
   * Builds the WebSocket URL compatible with react-native-audio-api (16 kHz PCM in / 24 kHz PCM out)
   * matching Harmoni / Moni 1.0 Live audio chunks:
   * - Send: { type: 'audio', data: base64Pcm16k } or { type: 'text', text: '...' }
   * - Receive: { type: 'audio', data: base64Pcm24k }, { type: 'board_updated', steps }, { type: 'pointer_moved', pointer }
   */
  buildLiveWebSocketUrl(params: {
    sessionId: string;
    courseId?: string;
    moduleId?: string;
    model?: string;
    voice?: string;
  }): string {
    const wsOrigin = this.baseUrl.replace(/^http/i, 'ws');
    const query = new URLSearchParams({
      sessionId: params.sessionId,
      model: params.model || 'gemini-3.8-live',
      voice: params.voice || 'Charon',
    });
    if (params.courseId) query.set('courseId', params.courseId);
    if (params.moduleId) query.set('moduleId', params.moduleId);
    return `${wsOrigin}/api/live-ws?${query.toString()}`;
  }
}
