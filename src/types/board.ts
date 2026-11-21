export type StepType = 'etape' | 'calcul' | 'schema' | 'code' | 'exemple' | 'synthese';

export interface BoardPointer {
  step_number: number;
  line_number: number;
  label?: string;
}

export interface BoardStep {
  id: number;
  session_id: string;
  step_number: number;
  step_type: StepType;
  title: string;
  content: string;
  highlight: boolean;
  created_at: string;
}

export interface PdfExerciseItem {
  title: string;
  statement: string;
  method_steps: string[];
  exact_format_sample: string;
}

export interface PdfStyleProfile {
  filename: string;
  analyzed_at: string;
  writing_style: string;
  notation_conventions: string;
  methodology_pattern: string;
  exercises: PdfExerciseItem[];
  verbatim_excerpts: string[];
}

export interface CourseModule {
  id: string;
  title: string;
  key_points: string[];
  sample_prompt?: string;
}

export interface CourseItem {
  id: string;
  code: string;
  title: string;
  professor_name: string;
  level: string;
  syllabus_title: string;
  summary: string;
  modules: CourseModule[];
  pdf_profile?: PdfStyleProfile | null;
  is_official: boolean;
  created_at: string;
  updated_at: string;
}

export interface LessonSession {
  id: string;
  title: string;
  model_name: string;
  course_id?: string | null;
  course_title?: string | null;
  course_code?: string | null;
  created_at: string;
  updated_at: string;
  step_count?: number;
  last_step_title?: string | null;
  steps?: BoardStep[];
}

export interface LiveModelOption {
  id: string;
  label: string;
  description: string;
}

export interface LiveConfigResponse {
  model: string;
  available_models: LiveModelOption[];
  voices: string[];
  default_voice: string;
  system_instruction: string;
  tools: unknown[];
  has_server_key: boolean;
  ws_path: string;
  react_native?: {
    rest_courses_path: string;
    rest_sessions_path: string;
    ws_live_path: string;
    embed_url_params: string[];
    audio_input_format: string;
    audio_output_format: string;
  };
}

export interface TranscriptEntry {
  id: string;
  role: 'student' | 'teacher' | 'system';
  text: string;
  timestamp: string;
}

export type LiveConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
