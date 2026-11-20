import { useState, type FormEvent } from 'react';
import {
  BookMarked,
  Check,
  Copy,
  Link2,
  Loader2,
  Play,
  Plus,
  Smartphone,
  Sparkles,
  Trash2,
  Unlink,
  X,
} from 'lucide-react';
import type { CourseItem } from '../types/board.ts';

interface CourseMenuModalProps {
  isOpen: boolean;
  courses: CourseItem[];
  activeCourseId: string | null;
  activeModuleId: string | null;
  isConnectingCourse: boolean;
  onClose: () => void;
  onConnectAndExplain: (course: CourseItem, moduleId: string | null) => Promise<void>;
  onSimulateCourse: (course: CourseItem, moduleId: string | null) => Promise<void>;
  onDisconnectCourse: () => Promise<void>;
  onCreateCourse: (payload: {
    code: string;
    title: string;
    professor_name: string;
    summary: string;
    chaptersText: string;
  }) => Promise<CourseItem | null>;
  onDeleteCourse: (courseId: string) => Promise<void>;
}

export function CourseMenuModal({
  isOpen,
  courses,
  activeCourseId,
  activeModuleId,
  isConnectingCourse,
  onClose,
  onConnectAndExplain,
  onSimulateCourse,
  onDisconnectCourse,
  onCreateCourse,
  onDeleteCourse,
}: CourseMenuModalProps) {
  const [activeTab, setActiveTab] = useState<'catalog' | 'create' | 'react-native'>('catalog');
  const [selectedId, setSelectedId] = useState<string | null>(
    activeCourseId ?? courses[0]?.id ?? null,
  );
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(activeModuleId);
  const [search, setSearch] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Create custom course form state
  const [newCode, setNewCode] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newProfessor, setNewProfessor] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newChapters, setNewChapters] = useState('');
  const [isSavingCourse, setIsSavingCourse] = useState(false);

  if (!isOpen) return null;

  const filteredCourses = courses.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.professor_name.toLowerCase().includes(q)
    );
  });

  const inspectedCourse =
    courses.find((c) => c.id === selectedId) ??
    courses.find((c) => c.id === activeCourseId) ??
    filteredCourses[0] ??
    null;

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://votre-serveur.run.app';
  const embedUrl = inspectedCourse
    ? `${origin}/?embed=1&courseId=${encodeURIComponent(inspectedCourse.id)}${
        selectedModuleId ? `&moduleId=${encodeURIComponent(selectedModuleId)}` : ''
      }&autoExplain=1`
    : `${origin}/?embed=1`;

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || isSavingCourse) return;
    setIsSavingCourse(true);
    try {
      const created = await onCreateCourse({
        code: newCode.trim() || 'COURS-UDBL',
        title: newTitle.trim(),
        professor_name: newProfessor.trim() || 'Professeur UDBL',
        summary: newSummary.trim(),
        chaptersText: newChapters,
      });
      if (created) {
        setSelectedId(created.id);
        setSelectedModuleId(null);
        setNewCode('');
        setNewTitle('');
        setNewProfessor('');
        setNewSummary('');
        setNewChapters('');
        setActiveTab('catalog');
      }
    } finally {
      setIsSavingCourse(false);
    }
  };

  const rnWebViewSnippet = `import { WebView } from 'react-native-webview';

export function ProfesseurTableauScreen({ courseId, moduleId }) {
  const boardUrl = \`${origin}/?embed=1&courseId=\${encodeURIComponent(courseId)}\${
    moduleId ? \`&moduleId=\${encodeURIComponent(moduleId)}\` : ''
  }&autoExplain=1\`;

  return (
    <WebView
      source={{ uri: boardUrl }}
      mediaPlaybackRequiresUserAction={false}
      allowsInlineMediaPlayback
      onMessage={(event) => {
        const msg = JSON.parse(event.nativeEvent.data);
        // BOARD_UPDATED, POINTER_MOVED, TRANSCRIPT, LIVE_STATE_CHANGED
        console.log('Tableau:', msg.type, msg);
      }}
    />
  );
}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu de connexion aux cours et intégration React Native"
      className="fixed inset-0 z-50 bg-stone-950/50 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] bg-[#FAF8F3] border border-[#DDD6C7] rounded-2xl shadow-xl flex flex-col overflow-hidden text-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E5E0D5] flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <h2 className="font-display text-lg font-bold text-stone-950 truncate">
              Connecter le professeur à un cours
            </h2>
            <p className="text-xs text-stone-500">
              Choisissez une matière du programme ou synchronisez un cours depuis votre application React Native.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="p-2 rounded-lg text-stone-500 hover:text-stone-950 hover:bg-stone-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 bg-white border-b border-[#E5E0D5] flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'catalog'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent text-stone-500 hover:text-stone-900'
            }`}
          >
            <BookMarked className="w-3.5 h-3.5" />
            <span>Cours de l’application ({courses.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'create'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent text-stone-500 hover:text-stone-900'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter / Importer un cours</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('react-native')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'react-native'
                ? 'border-stone-900 text-stone-950'
                : 'border-transparent text-stone-500 hover:text-stone-900'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Pont React Native / Expo</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'catalog' && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Left: Course List */}
              <div className="md:col-span-5 space-y-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer (Algèbre, Python, Logique…)"
                  className="w-full rounded-lg border border-[#D6D0C4] bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                />

                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                  {filteredCourses.map((course) => {
                    const isSelected = inspectedCourse?.id === course.id;
                    const isConnected = activeCourseId === course.id;
                    return (
                      <div
                        key={course.id}
                        className={`rounded-xl border p-3 transition-colors ${
                          isSelected
                            ? 'bg-stone-900 text-white border-stone-900'
                            : 'bg-white text-stone-900 border-[#E5E0D5] hover:border-stone-400'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(course.id);
                              setSelectedModuleId(null);
                            }}
                            className="flex-1 text-left cursor-pointer min-w-0"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-mono-code text-[11px] font-semibold ${
                                  isSelected ? 'text-sky-300' : 'text-sky-700'
                                }`}
                              >
                                {course.code}
                              </span>
                              {isConnected && (
                                <span
                                  className={`text-[11px] font-semibold ${
                                    isSelected ? 'text-emerald-300' : 'text-emerald-700'
                                  }`}
                                >
                                  · Connecté
                                </span>
                              )}
                            </div>
                            <p className="font-semibold text-sm truncate mt-0.5">{course.title}</p>
                            <p
                              className={`text-xs mt-0.5 truncate ${
                                isSelected ? 'text-stone-300' : 'text-stone-500'
                              }`}
                            >
                              {course.professor_name}
                            </p>
                          </button>

                          {!course.is_official && (
                            <button
                              type="button"
                              onClick={() => {
                                void onDeleteCourse(course.id);
                              }}
                              aria-label={`Supprimer ${course.title}`}
                              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                                isSelected
                                  ? 'text-stone-300 hover:text-white hover:bg-stone-800'
                                  : 'text-stone-400 hover:text-red-600 hover:bg-stone-100'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Course Syllabus & Explain Actions */}
              <div className="md:col-span-7">
                {inspectedCourse ? (
                  <div className="rounded-xl bg-white border border-[#E5E0D5] p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-stone-500">
                          <span className="font-mono-code font-semibold text-sky-800">
                            {inspectedCourse.code}
                          </span>
                          <span>·</span>
                          <span>{inspectedCourse.level}</span>
                        </div>
                        <h3 className="font-handwriting text-2xl font-bold text-stone-950">
                          {inspectedCourse.title}
                        </h3>
                        <p className="text-xs text-stone-500">
                          {inspectedCourse.professor_name} · {inspectedCourse.syllabus_title}
                        </p>
                      </div>

                      {activeCourseId === inspectedCourse.id && (
                        <button
                          type="button"
                          onClick={() => {
                            void onDisconnectCourse();
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-stone-300 text-stone-700 hover:bg-stone-100 cursor-pointer"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                          <span>Délier</span>
                        </button>
                      )}
                    </div>

                    <p className="text-sm text-stone-700 leading-relaxed">
                      {inspectedCourse.summary}
                    </p>

                    {/* Chapter / Module Selector */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-stone-700">
                        Cibler un chapitre à expliquer au tableau :
                      </p>
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedModuleId(null)}
                          className={`w-full text-left px-3 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            selectedModuleId === null
                              ? 'bg-sky-50 border-sky-600 text-sky-950'
                              : 'bg-[#FAF9F6] border-[#E5E0D5] text-stone-700 hover:border-stone-400'
                          }`}
                        >
                          Vue d’ensemble : tout le cours ({inspectedCourse.modules.length} chapitres)
                        </button>

                        {inspectedCourse.modules.map((mod) => {
                          const isModSelected = selectedModuleId === mod.id;
                          return (
                            <button
                              key={mod.id}
                              type="button"
                              onClick={() => setSelectedModuleId(mod.id)}
                              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
                                isModSelected
                                  ? 'bg-sky-50 border-sky-600 text-sky-950'
                                  : 'bg-[#FAF9F6] border-[#E5E0D5] text-stone-800 hover:border-stone-400'
                              }`}
                            >
                              <p className="text-xs font-semibold">{mod.title}</p>
                              {mod.key_points.length > 0 && (
                                <p className="text-[11px] text-stone-500 mt-1 line-clamp-2">
                                  {mod.key_points.join(' · ')}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                      <button
                        type="button"
                        disabled={isConnectingCourse}
                        onClick={() => {
                          void onConnectAndExplain(inspectedCourse, selectedModuleId);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        {isConnectingCourse ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 text-amber-300" />
                        )}
                        <span>Connecter & Expliquer ce cours</span>
                      </button>

                      <button
                        type="button"
                        disabled={isConnectingCourse}
                        onClick={() => {
                          void onSimulateCourse(inspectedCourse, selectedModuleId);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border border-[#D6D0C4] bg-white text-stone-800 hover:bg-stone-100 disabled:opacity-60 transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 text-amber-600" />
                        <span>Aperçu au tableau</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-white border border-[#E5E0D5] p-6 text-sm text-stone-500">
                    Aucun cours ne correspond à cette recherche.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <form
              onSubmit={handleCreateSubmit}
              className="max-w-2xl mx-auto rounded-xl bg-white border border-[#E5E0D5] p-5 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 mb-1">Code</label>
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    placeholder="ex. INFO-108"
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-stone-600 mb-1">
                    Intitulé du cours *
                  </label>
                  <input
                    type="text"
                    required
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="ex. Bases de données relationnelles"
                    className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">
                  Enseignant / Titulaire
                </label>
                <input
                  type="text"
                  value={newProfessor}
                  onChange={(e) => setNewProfessor(e.target.value)}
                  placeholder="ex. Prof. Kasongo"
                  className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">
                  Résumé du syllabus ou extrait de cours
                </label>
                <textarea
                  rows={3}
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="Décrivez brièvement les objectifs du cours ou collez un passage du syllabus…"
                  className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1">
                  Chapitres / Notions clés (une ligne par chapitre)
                </label>
                <textarea
                  rows={4}
                  value={newChapters}
                  onChange={(e) => setNewChapters(e.target.value)}
                  placeholder={
                    'Modèle entité-association\nNormalisation 1FN, 2FN, 3FN\nRequêtes SQL SELECT et JOIN'
                  }
                  className="w-full rounded-lg border border-[#D6D0C4] bg-[#FAF9F6] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-stone-300 text-stone-700 hover:bg-stone-100 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!newTitle.trim() || isSavingCourse}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingCourse ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>Enregistrer le cours</span>
                </button>
              </div>
            </form>
          )}

          {activeTab === 'react-native' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-white border border-[#E5E0D5] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-sky-700" />
                    <h3 className="text-sm font-semibold text-stone-950">
                      URL d’intégration directe (Expo / React Native WebView)
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText('embed-url', embedUrl);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-stone-300 hover:bg-stone-100 cursor-pointer"
                  >
                    {copiedKey === 'embed-url' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Copié</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier l’URL</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-stone-600">
                  Ouvre directement le tableau blanc en plein écran sur le cours choisi, sans menu latéral, avec pont{' '}
                  <code className="font-mono-code bg-stone-100 px-1 py-0.5 rounded">postMessage</code> bidirectionnel.
                </p>
                <div className="rounded-lg bg-[#F5F2EB] border border-[#DDD6C7] p-3 font-mono-code text-xs text-stone-800 break-all">
                  {embedUrl}
                </div>
              </div>

              <div className="rounded-xl bg-white border border-[#E5E0D5] p-5 space-y-3">
                <h3 className="text-sm font-semibold text-stone-950">
                  Endpoints REST & WebSocket pour Harmoni / Moni 1.0 Live
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                  <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] p-3 space-y-1">
                    <p className="font-mono-code font-semibold text-sky-800">GET / POST /api/courses/</p>
                    <p className="text-stone-600">
                      Synchronise les matières, syllabus et chapitres depuis Django / React Native.
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] p-3 space-y-1">
                    <p className="font-mono-code font-semibold text-sky-800">
                      POST /api/sessions/:id/connect-course/
                    </p>
                    <p className="text-stone-600">
                      Relie une séance tableau à un cours précis avant de lancer l’explication.
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] p-3 space-y-1">
                    <p className="font-mono-code font-semibold text-sky-800">
                      WS /api/live-ws?sessionId=...&courseId=...
                    </p>
                    <p className="text-stone-600">
                      Flux PCM 16 kHz / 24 kHz compatible <code className="font-mono-code">react-native-audio-api</code>.
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#FAF9F6] border border-[#E5E0D5] p-3 space-y-1">
                    <p className="font-mono-code font-semibold text-sky-800">
                      postMessage (CONNECT_COURSE / SYNC_COURSES)
                    </p>
                    <p className="text-stone-600">
                      Permet à l’app mobile de piloter le tableau ou pousser un cours à chaud.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-white border border-[#E5E0D5] p-5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-stone-950">
                    Exemple d’écran Expo / React Native
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      void copyText('rn-code', rnWebViewSnippet);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-stone-300 hover:bg-stone-100 cursor-pointer"
                  >
                    {copiedKey === 'rn-code' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Copié</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier le composant</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="rounded-lg bg-[#F5F2EB] border border-[#DDD6C7] p-3.5 font-mono-code text-xs text-stone-800 overflow-x-auto leading-relaxed">
                  {rnWebViewSnippet}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
