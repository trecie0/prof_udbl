import { useRef, useState, type ChangeEvent } from 'react';
import {
  BookMarked,
  FileText,
  Mic,
  MicOff,
  PlugZap,
  PowerOff,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Plus,
  AlertCircle,
  CheckCircle2,
  Cloud,
  Loader2,
  LogOut,
} from 'lucide-react';
import type {
  CourseItem,
  LessonSession,
  LiveConfigResponse,
  LiveConnectionState,
  TranscriptEntry,
} from '../types/board.ts';

interface ControlDeckProps {
  config: LiveConfigResponse | null;
  courses: CourseItem[];
  activeCourse: CourseItem | null;
  activeModuleId: string | null;
  sessions: LessonSession[];
  activeSessionId: string | null;
  selectedModel: string;
  selectedVoice: string;
  connectionState: LiveConnectionState;
  isMicActive: boolean;
  isTeacherSpeaking: boolean;
  micLevel: number;
  errorMessage: string | null;
  transcripts: TranscriptEntry[];
  isConnectingCourse: boolean;
  isUploadingPdf: boolean;
  pdfError: string | null;
  onOpenCourseMenu: () => void;
  onQuickExplainCourse: (course: CourseItem, moduleId: string | null) => void;
  onUploadPdfForCourse: (file: File, targetCourseId?: string) => Promise<CourseItem | null>;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onChangeModel: (model: string) => void;
  onChangeVoice: (voice: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleMic: () => void;
  onClearTranscripts: () => void;
  cloudUserEmail?: string | null;
  cloudUserName?: string | null;
  isCloudSyncing?: boolean;
  cloudError?: string | null;
  onSignInCloud?: () => void;
  onSignOutCloud?: () => void;
}

export function ControlDeck({
  config,
  courses,
  activeCourse,
  activeModuleId,
  sessions,
  activeSessionId,
  selectedModel,
  selectedVoice,
  connectionState,
  isMicActive,
  isTeacherSpeaking,
  micLevel,
  errorMessage,
  transcripts,
  isConnectingCourse,
  isUploadingPdf,
  pdfError,
  onOpenCourseMenu,
  onQuickExplainCourse,
  onUploadPdfForCourse,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onChangeModel,
  onChangeVoice,
  onConnect,
  onDisconnect,
  onToggleMic,
  onClearTranscripts,
  cloudUserEmail = null,
  cloudUserName = null,
  isCloudSyncing = false,
  cloudError = null,
  onSignInCloud,
  onSignOutCloud,
}: ControlDeckProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  const activeModuleTitle = activeCourse?.modules.find((m) => m.id === activeModuleId)?.title;

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await onUploadPdfForCourse(file, activeCourse?.id);
  };

  return (
    <aside className="w-full lg:w-[400px] xl:w-[420px] shrink-0 bg-[#F8F6F1] border-b lg:border-b-0 lg:border-r border-[#E5E0D5] flex flex-col">
      <div className="p-5 space-y-5 overflow-y-auto flex-1">
        {/* Section 0: Connected Course Menu */}
        <section id="section-cours" className="bg-white border border-[#E5E0D5] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-stone-900 flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-sky-700" />
              <span>Cours connecté</span>
            </h2>
            <button
              type="button"
              onClick={onOpenCourseMenu}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[#D6D0C4] bg-[#FAF9F6] text-stone-800 hover:bg-stone-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Changer / Menu ({courses.length})
            </button>
          </div>

          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            onChange={(e) => {
              void handleFileChange(e);
            }}
            className="hidden"
          />

          {activeCourse ? (
            <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] p-3 space-y-2.5">
              <div>
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  <span className="font-mono-code font-semibold text-sky-800">
                    {activeCourse.code}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{activeCourse.professor_name}</span>
                </div>
                <p className="text-sm font-semibold text-stone-950 mt-0.5">{activeCourse.title}</p>
                {activeModuleTitle && (
                  <p className="text-xs text-sky-800 mt-0.5">Chapitre : {activeModuleTitle}</p>
                )}
                {activeCourse.pdf_profile && (
                  <p className="text-[11px] text-emerald-800 mt-1 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      PDF adapté : {activeCourse.pdf_profile.filename}
                      {activeCourse.pdf_profile.exercises.length > 0
                        ? ` · ${activeCourse.pdf_profile.exercises.length} ex.`
                        : ''}
                    </span>
                  </p>
                )}
              </div>

              {pdfError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-800 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{pdfError}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isConnectingCourse || !activeSessionId}
                  onClick={() => onQuickExplainCourse(activeCourse, activeModuleId)}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isConnectingCourse ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  )}
                  <span>Expliquer</span>
                </button>

                <button
                  type="button"
                  disabled={isUploadingPdf}
                  onClick={() => pdfInputRef.current?.click()}
                  title="Lire un PDF pour adapter le style et les exercices du professeur"
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[#D6D0C4] bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isUploadingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-sky-700" />
                  )}
                  <span>{isUploadingPdf ? 'Lecture…' : 'Lire un PDF'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-[#FAF9F6] border border-dashed border-[#D6D0C4] p-3 space-y-2">
              <p className="text-xs text-stone-600 leading-relaxed">
                Aucun cours connecté. Reliez le professeur à un cours ou importez directement un PDF de TD/cours.
              </p>
              {pdfError && (
                <div className="rounded-md bg-red-50 border border-red-200 px-2.5 py-1.5 text-xs text-red-800 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{pdfError}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenCourseMenu}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-sky-700 text-white hover:bg-sky-800 transition-colors cursor-pointer"
                >
                  <BookMarked className="w-3.5 h-3.5" />
                  <span>Choisir un cours</span>
                </button>
                <button
                  type="button"
                  disabled={isUploadingPdf}
                  onClick={() => pdfInputRef.current?.click()}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[#D6D0C4] bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isUploadingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-sky-700" />
                  )}
                  <span>{isUploadingPdf ? 'Lecture…' : 'PDF'}</span>
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Section 1: Session History & Active Lesson */}
        <section id="section-seances" className="bg-white border border-[#E5E0D5] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-stone-900">
              Séances enregistrées
            </h2>
            <button
              type="button"
              onClick={onCreateSession}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-stone-900 text-white hover:bg-stone-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nouvelle</span>
            </button>
          </div>

          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
            {sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isConfirming = confirmDeleteId === session.id;
              return (
                <div
                  key={session.id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 border transition-colors ${
                    isActive
                      ? 'bg-stone-900 text-white border-stone-900'
                      : 'bg-[#FAF9F6] text-stone-800 border-[#E5E0D5] hover:border-stone-400'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className="flex-1 text-left min-w-0 min-h-[40px] cursor-pointer"
                  >
                    <p className="text-sm font-medium truncate">{session.title}</p>
                    <p
                      className={`text-xs mt-0.5 font-mono-code tabular-nums ${
                        isActive ? 'text-stone-300' : 'text-stone-500'
                      }`}
                    >
                      {session.step_count ?? 0} étape{(session.step_count ?? 0) > 1 ? 's' : ''}
                    </p>
                  </button>

                  {sessions.length > 1 && (
                    <div className="shrink-0">
                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSession(session.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 whitespace-nowrap cursor-pointer"
                          >
                            Supprimer
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap cursor-pointer ${
                              isActive
                                ? 'text-stone-300 hover:text-white'
                                : 'text-stone-600 hover:text-stone-900'
                            }`}
                          >
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(session.id)}
                          aria-label={`Supprimer ${session.title}`}
                          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                            isActive
                              ? 'text-stone-300 hover:text-white hover:bg-stone-800'
                              : 'text-stone-400 hover:text-red-600 hover:bg-stone-100'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(onSignInCloud || onSignOutCloud) && (
            <div className="pt-2 border-t border-[#ECE7DD] space-y-2">
              {cloudUserEmail ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex items-center gap-1.5 text-emerald-800">
                    <Cloud className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate font-medium">
                      {cloudUserName || cloudUserEmail}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onSignOutCloud}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-600 hover:text-stone-900 hover:bg-stone-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Déconnecter</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isCloudSyncing}
                  onClick={onSignInCloud}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-[#D6D0C4] bg-[#FAF9F6] text-stone-800 hover:bg-stone-100 disabled:opacity-60 transition-colors cursor-pointer"
                >
                  {isCloudSyncing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-sky-700" />
                  )}
                  <span>Sauvegarde Cloud Google (Firestore)</span>
                </button>
              )}
              {cloudError && (
                <p className="text-[11px] text-red-700 leading-snug">{cloudError}</p>
              )}
            </div>
          )}
        </section>

        {/* Section 2: Gemini Live Connection & Microphone */}
        <section className="bg-white border border-[#E5E0D5] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-stone-900">
              Connexion Gemini Live
            </h2>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium">
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Connecté</span>
                </span>
              ) : isConnecting ? (
                <span className="inline-flex items-center gap-1.5 text-sky-700">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Connexion…</span>
                </span>
              ) : connectionState === 'error' ? (
                <span className="inline-flex items-center gap-1.5 text-red-700">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Erreur</span>
                </span>
              ) : (
                <span className="text-stone-500">Hors ligne</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label
                htmlFor="live-model-select"
                className="block text-xs font-medium text-stone-600 mb-1"
              >
                Modèle Live
              </label>
              <select
                id="live-model-select"
                value={selectedModel}
                disabled={isConnected || isConnecting}
                onChange={(e) => onChangeModel(e.target.value)}
                className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-60"
              >
                {(config?.available_models ?? [
                  {
                    id: 'gemini-3.8-live',
                    label: 'Gemini 3.8 Live',
                    description: '',
                  },
                ]).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <label
                  htmlFor="live-voice-select"
                  className="block text-xs font-medium text-stone-600 mb-1"
                >
                  Voix du professeur
                </label>
                <select
                  id="live-voice-select"
                  value={selectedVoice}
                  disabled={isConnected || isConnecting}
                  onChange={(e) => onChangeVoice(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-60"
                >
                  {(config?.voices ?? ['Charon', 'Zephyr', 'Kore', 'Fenrir', 'Puck']).map(
                    (voiceOption) => (
                      <option key={voiceOption} value={voiceOption}>
                        {voiceOption}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="pt-5 text-xs text-stone-500 shrink-0">
                {config?.has_server_key ? 'Clé serveur active' : 'Clé serveur requise'}
              </div>
            </div>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            {isConnected ? (
              <button
                type="button"
                onClick={onDisconnect}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 transition-colors whitespace-nowrap cursor-pointer"
              >
                <PowerOff className="w-4 h-4" />
                <span>Déconnecter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                disabled={isConnecting || !activeSessionId}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-60 transition-colors whitespace-nowrap cursor-pointer"
              >
                {isConnecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <PlugZap className="w-4 h-4" />
                )}
                <span>Connecter Live</span>
              </button>
            )}

            <button
              type="button"
              onClick={onToggleMic}
              disabled={!activeSessionId || isConnecting}
              className={`min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 ${
                isMicActive
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-stone-900 text-white hover:bg-stone-800'
              }`}
            >
              {isMicActive ? (
                <>
                  <MicOff className="w-4 h-4" />
                  <span>Couper le micro</span>
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4" />
                  <span>Parler au micro</span>
                </>
              )}
            </button>
          </div>

          {(isMicActive || isTeacherSpeaking) && (
            <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] px-3 py-2.5 space-y-2">
              {isMicActive && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-stone-600">
                    <span>Capture micro PCM 16 kHz mono</span>
                    <span className="font-mono-code tabular-nums">{Math.round(micLevel * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
                    <div
                      className="h-full bg-emerald-600 transition-transform duration-75 origin-left"
                      style={{ transform: `scaleX(${Math.max(0.04, micLevel)})` }}
                    />
                  </div>
                </div>
              )}

              {isTeacherSpeaking && (
                <div className="flex items-center gap-2 text-xs font-medium text-sky-800">
                  <Volume2 className="w-4 h-4 text-sky-700 shrink-0" />
                  <span>Le professeur parle (24 kHz) · Parlez pour l’interrompre</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Section 4: Live Transcript Log */}
        <section className="bg-white border border-[#E5E0D5] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base font-semibold text-stone-900">
              Dialogue en direct
            </h2>
            {transcripts.length > 0 && (
              <button
                type="button"
                onClick={onClearTranscripts}
                className="text-xs text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
              >
                Vider le fil
              </button>
            )}
          </div>

          {transcripts.length === 0 ? (
            <p className="text-xs text-stone-500 leading-relaxed">
              Les échanges vocaux et consignes texte avec le professeur apparaîtront ici dès le début du cours.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
              {transcripts.map((entry) => (
                <div key={entry.id} className="text-xs space-y-0.5">
                  <div className="flex items-center gap-1.5 text-stone-500">
                    <span
                      className={`font-semibold ${
                        entry.role === 'teacher'
                          ? 'text-sky-700'
                          : entry.role === 'student'
                            ? 'text-stone-900'
                            : 'text-amber-700'
                      }`}
                    >
                      {entry.role === 'teacher'
                        ? 'Professeur'
                        : entry.role === 'student'
                          ? 'Élève'
                          : 'Système'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-code">{entry.timestamp}</span>
                  </div>
                  <p className="text-stone-800 leading-relaxed">{entry.text}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
