import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  type LiveServerMessage,
} from '@google/genai';
import {
  attachPdfProfileToCourse,
  clearSessionSteps,
  connectCourseToSession,
  createSession,
  deleteCourse,
  deleteSession,
  ensureInitialSession,
  getCourse,
  getSession,
  listCourses,
  listSessions,
  updateSessionTitle,
  upsertCourse,
  upsertStep,
} from './server/db.ts';
import {
  AVAILABLE_LIVE_MODELS,
  AVAILABLE_VOICES,
  DEFAULT_LIVE_MODEL,
  DEFAULT_VOICE,
  PROFESSOR_SYSTEM_INSTRUCTION,
  buildCourseInstructionContext,
  buildPointToDeclaration,
  buildUpdateBoardDeclaration,
} from './server/liveConfig.ts';
import { analyzeCourseDocument } from './server/pdfAnalyzer.ts';

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_MODELS = new Set(AVAILABLE_LIVE_MODELS.map((m) => m.id));
const ALLOWED_VOICES = new Set(AVAILABLE_VOICES);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '10.0.2.2' ||
      parsed.hostname.endsWith('.exp.direct') ||
      parsed.hostname.endsWith('.run.app')
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function sendWsJson(ws: WebSocket, payload: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function startServer() {
  const app = express();

  // Mobile-friendly CORS for React Native / Expo Web & REST bridge
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Client-Platform');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Ensure UDBL courses & at least one initial session exist on startup
  ensureInitialSession();

  const pdfJsonParser = express.json({ limit: '16mb' });

  const handlePdfAnalysisError = (err: unknown, res: express.Response) => {
    if (err instanceof Error) {
      switch (err.message) {
        case 'UNSUPPORTED_MIME_TYPE':
          res.status(400).json({ detail: 'Format non pris en charge. Envoyez un fichier PDF, TXT ou MD.' });
          return;
        case 'EMPTY_FILE':
          res.status(400).json({ detail: 'Le fichier envoyé est vide.' });
          return;
        case 'FILE_TOO_LARGE':
          res.status(413).json({ detail: 'Le document dépasse la limite de 10 Mo.' });
          return;
        case 'INVALID_PDF_HEADER':
          res.status(400).json({ detail: 'Le fichier ne semble pas être un PDF valide (%PDF- manquant).' });
          return;
        case 'MISSING_API_KEY':
          res.status(503).json({
            detail: 'Clé GEMINI_API_KEY requise côté serveur pour analyser les PDF.',
          });
          return;
        case 'MODEL_TEMPORARILY_UNAVAILABLE':
          res.status(503).json({
            detail: 'Les serveurs d’analyse PDF connaissent un pic de demande momentané. Réessayez dans quelques secondes.',
          });
          return;
      }
    }
    console.error('PDF analysis error:', err);
    const rawMessage = err instanceof Error ? err.message : String(err);
    const safeMessage = rawMessage.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[KEY]').slice(0, 220);
    res.status(500).json({
      detail: `Impossible d’analyser ce document PDF pour le moment (${safeMessage || 'erreur interne'}).`,
    });
  };

  // Dedicated 16MB routes for reading course PDFs and adapting style/exercises
  app.post('/api/courses/import-pdf', pdfJsonParser, async (req, res) => {
    const body = req.body ?? {};
    if (typeof body.dataBase64 !== 'string' || !body.dataBase64.trim()) {
      res.status(400).json({ detail: 'Le champ dataBase64 est requis.' });
      return;
    }
    try {
      const analyzed = await analyzeCourseDocument({
        filename: typeof body.filename === 'string' ? body.filename : undefined,
        mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'application/pdf',
        dataBase64: body.dataBase64,
      });

      const created = upsertCourse({
        code: typeof body.code === 'string' && body.code.trim() ? body.code : analyzed.suggested_code,
        title: typeof body.title === 'string' && body.title.trim() ? body.title : analyzed.suggested_title,
        professor_name:
          typeof body.professor_name === 'string' && body.professor_name.trim()
            ? body.professor_name
            : analyzed.suggested_professor,
        syllabus_title: `PDF adapté · ${analyzed.pdf_profile.filename}`,
        summary: analyzed.summary,
        modules: analyzed.modules,
        pdf_profile: analyzed.pdf_profile,
        is_official: false,
      });

      res.status(201).json(created);
    } catch (err) {
      handlePdfAnalysisError(err, res);
    }
  });

  app.post('/api/courses/:course_id/pdf', pdfJsonParser, async (req, res) => {
    const course = getCourse(req.params.course_id);
    if (!course) {
      res.status(404).json({ detail: 'Cours introuvable.' });
      return;
    }
    const body = req.body ?? {};
    if (typeof body.dataBase64 !== 'string' || !body.dataBase64.trim()) {
      res.status(400).json({ detail: 'Le champ dataBase64 est requis.' });
      return;
    }
    try {
      const analyzed = await analyzeCourseDocument({
        filename: typeof body.filename === 'string' ? body.filename : undefined,
        mimeType: typeof body.mimeType === 'string' ? body.mimeType : 'application/pdf',
        dataBase64: body.dataBase64,
        existingCourseTitle: course.title,
      });

      const updated = attachPdfProfileToCourse(course.id, analyzed.pdf_profile, {
        summary: body.replaceMetadata ? analyzed.summary : undefined,
        modules: body.replaceModules !== false ? analyzed.modules : undefined,
        syllabus_title: `PDF adapté · ${analyzed.pdf_profile.filename}`,
      });

      res.status(200).json(updated);
    } catch (err) {
      handlePdfAnalysisError(err, res);
    }
  });

  app.use(express.json({ limit: '2mb' }));

  // 1. GET /api/live-config/
  app.get('/api/live-config', (_req, res) => {
    res.json({
      model: DEFAULT_LIVE_MODEL,
      available_models: AVAILABLE_LIVE_MODELS,
      voices: AVAILABLE_VOICES,
      default_voice: DEFAULT_VOICE,
      system_instruction: PROFESSOR_SYSTEM_INSTRUCTION,
      tools: [
        {
          functionDeclarations: [
            buildUpdateBoardDeclaration(false),
            buildPointToDeclaration(false),
          ],
        },
      ],
      has_server_key: Boolean(process.env.GEMINI_API_KEY),
      ws_path: '/api/live-ws',
      react_native: {
        rest_courses_path: '/api/courses/',
        rest_sessions_path: '/api/sessions/',
        ws_live_path: '/api/live-ws',
        embed_url_params: ['embed=1', 'courseId=<id>', 'moduleId=<id>', 'autoExplain=1'],
        audio_input_format: 'audio/pcm;rate=16000 (int16 mono base64)',
        audio_output_format: 'audio/pcm;rate=24000 (int16 mono base64)',
      },
    });
  });

  // 1b. GET, POST & DELETE /api/courses/ (UDBL syllabus + React Native course sync)
  app.get('/api/courses', (_req, res) => {
    res.json(listCourses());
  });

  app.get('/api/courses/:course_id', (req, res) => {
    const course = getCourse(req.params.course_id);
    if (!course) {
      res.status(404).json({ detail: 'Cours introuvable.' });
      return;
    }
    res.json(course);
  });

  app.post('/api/courses', (req, res) => {
    const body = req.body ?? {};
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      res.status(400).json({ detail: 'Le champ title est requis pour créer ou synchroniser un cours.' });
      return;
    }

    const rawModules = Array.isArray(body.modules) ? body.modules : [];
    const normalizedModules = rawModules
      .filter((m: unknown): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
      .slice(0, 20)
      .map((m: Record<string, unknown>, idx: number) => ({
        id: typeof m.id === 'string' && m.id.trim() ? m.id.trim() : `mod-${idx + 1}`,
        title: typeof m.title === 'string' && m.title.trim() ? m.title.trim() : `Chapitre ${idx + 1}`,
        key_points: Array.isArray(m.key_points)
          ? m.key_points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 10)
          : [],
      }));

    const saved = upsertCourse({
      id: typeof body.id === 'string' ? body.id : undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
      title: body.title,
      professor_name: typeof body.professor_name === 'string' ? body.professor_name : undefined,
      level: typeof body.level === 'string' ? body.level : undefined,
      syllabus_title: typeof body.syllabus_title === 'string' ? body.syllabus_title : undefined,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
      modules: normalizedModules,
      pdf_profile: body.pdf_profile && typeof body.pdf_profile === 'object' ? body.pdf_profile : undefined,
      is_official: false,
    });
    res.status(201).json(saved);
  });

  app.delete('/api/courses/:course_id', (req, res) => {
    const deleted = deleteCourse(req.params.course_id);
    if (!deleted) {
      res.status(404).json({ detail: 'Cours introuvable ou cours officiel non supprimable.' });
      return;
    }
    res.json({ deleted: true });
  });

  // 2. GET & POST /api/sessions/
  app.get('/api/sessions', (_req, res) => {
    const sessions = listSessions();
    res.json(sessions);
  });

  app.post('/api/sessions', (req, res) => {
    const { title, model_name, course_id } = req.body ?? {};
    const validModel =
      typeof model_name === 'string' && ALLOWED_MODELS.has(model_name)
        ? model_name
        : DEFAULT_LIVE_MODEL;
    const validCourseId = typeof course_id === 'string' && course_id.trim() ? course_id.trim() : null;
    const session = createSession(
      typeof title === 'string' ? title : undefined,
      validModel,
      validCourseId,
    );
    res.status(201).json(session);
  });

  // 3. GET, PATCH & DELETE /api/sessions/:session_id/
  app.get('/api/sessions/:session_id', (req, res) => {
    const session = getSession(req.params.session_id);
    if (!session) {
      res.status(404).json({ detail: 'Séance introuvable.' });
      return;
    }
    res.json(session);
  });

  app.patch('/api/sessions/:session_id', (req, res) => {
    const { title, course_id } = req.body ?? {};
    const hasTitle = typeof title === 'string' && title.trim().length > 0;
    const hasCourseField = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'course_id');

    if (!hasTitle && !hasCourseField) {
      res.status(400).json({ detail: 'Le champ title ou course_id est requis.' });
      return;
    }

    let updated = getSession(req.params.session_id);
    if (!updated) {
      res.status(404).json({ detail: 'Séance introuvable.' });
      return;
    }

    if (hasTitle) {
      updated = updateSessionTitle(req.params.session_id, title);
    }
    if (hasCourseField) {
      try {
        const nextCourseId =
          typeof course_id === 'string' && course_id.trim() ? course_id.trim() : null;
        updated = connectCourseToSession(req.params.session_id, nextCourseId);
      } catch (err) {
        if (err instanceof Error && err.message === 'COURSE_NOT_FOUND') {
          res.status(404).json({ detail: 'Cours ciblé introuvable.' });
          return;
        }
        throw err;
      }
    }

    res.json(updated);
  });

  app.post('/api/sessions/:session_id/connect-course', (req, res) => {
    const { course_id } = req.body ?? {};
    const nextCourseId =
      typeof course_id === 'string' && course_id.trim() ? course_id.trim() : null;
    try {
      const updated = connectCourseToSession(req.params.session_id, nextCourseId);
      if (!updated) {
        res.status(404).json({ detail: 'Séance introuvable.' });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof Error && err.message === 'COURSE_NOT_FOUND') {
        res.status(404).json({ detail: 'Cours introuvable.' });
        return;
      }
      console.error('Error connecting course to session:', err);
      res.status(500).json({ detail: 'Impossible de connecter ce cours à la séance.' });
    }
  });

  app.delete('/api/sessions/:session_id', (req, res) => {
    const deleted = deleteSession(req.params.session_id);
    if (!deleted) {
      res.status(404).json({ detail: 'Séance introuvable.' });
      return;
    }
    res.json({ deleted: true });
  });

  // 4. POST /api/sessions/:session_id/steps/
  app.post('/api/sessions/:session_id/steps', (req, res) => {
    const body = req.body ?? {};
    if (!body.title || typeof body.title !== 'string') {
      res.status(400).json({ detail: 'Le champ title est requis.' });
      return;
    }
    try {
      const result = upsertStep(req.params.session_id, {
        step_number: body.step_number !== undefined ? Number(body.step_number) : undefined,
        step_type: body.step_type ?? body.type,
        title: body.title,
        content: typeof body.content === 'string' ? body.content : '',
        highlight: body.highlight !== false,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof Error && error.message === 'SESSION_NOT_FOUND') {
        res.status(404).json({ detail: 'Séance introuvable.' });
        return;
      }
      console.error('Error saving board step:', error);
      res.status(500).json({ detail: 'Erreur lors de la sauvegarde de l’étape.' });
    }
  });

  // 5. POST /api/sessions/:session_id/clear/
  app.post('/api/sessions/:session_id/clear', (req, res) => {
    const cleared = clearSessionSteps(req.params.session_id);
    if (!cleared) {
      res.status(404).json({ detail: 'Séance introuvable.' });
      return;
    }
    res.json({ cleared: true, steps: [] });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const reqUrl = new URL(request.url || '/', 'http://localhost');
    if (reqUrl.pathname === '/api/live-ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs, request) => {
    const reqUrl = new URL(request.url || '/', 'http://localhost');
    const requestedSessionId = reqUrl.searchParams.get('sessionId') || '';
    const requestedModel = reqUrl.searchParams.get('model') || DEFAULT_LIVE_MODEL;
    const requestedVoice = reqUrl.searchParams.get('voice') || DEFAULT_VOICE;
    const requestedCourseId = reqUrl.searchParams.get('courseId') || '';
    const requestedModuleId = reqUrl.searchParams.get('moduleId') || '';

    const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_LIVE_MODEL;
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;

    const sessionRecord = requestedSessionId ? getSession(requestedSessionId) : null;
    if (!sessionRecord) {
      sendWsJson(clientWs, {
        type: 'error',
        message: 'Séance introuvable pour cette connexion Live.',
      });
      clientWs.close();
      return;
    }

    const effectiveCourseId = requestedCourseId || sessionRecord.course_id || null;
    const connectedCourse = effectiveCourseId ? getCourse(effectiveCourseId) : null;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      sendWsJson(clientWs, {
        type: 'error',
        code: 'MISSING_API_KEY',
        message:
          'Clé GEMINI_API_KEY non configurée côté serveur. Ajoutez-la dans Settings > Secrets.',
      });
      clientWs.close();
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const isExtendedThinking = model === 'gemini-3.8-live-extended-thinking';
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    let isClosing = false;

    const courseContextPrompt = buildCourseInstructionContext(
      connectedCourse,
      requestedModuleId || null,
    );

    const existingStepsSummary =
      sessionRecord.steps && sessionRecord.steps.length > 0
        ? `\n\nContexte actuel du tableau (étapes déjà affichées) :\n${sessionRecord.steps
            .map((s) => `- Étape ${s.step_number} [${s.step_type}] : ${s.title}`)
            .join('\n')}\nContinue la numérotation à partir de l'étape ${
            Math.max(...sessionRecord.steps.map((s) => s.step_number)) + 1
          } si tu ajoutes de nouveaux blocs.`
        : '';

    try {
      liveSession = await ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          ...(isExtendedThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } }
            : {}),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `${PROFESSOR_SYSTEM_INSTRUCTION}${courseContextPrompt}${existingStepsSummary}`,
          tools: [
            {
              functionDeclarations: [
                buildUpdateBoardDeclaration(isExtendedThinking),
                buildPointToDeclaration(isExtendedThinking),
              ],
            },
          ],
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (isClosing) return;

            const content = message.serverContent;
            if (content?.interrupted) {
              sendWsJson(clientWs, { type: 'interrupted' });
            }

            if (content?.inputTranscription?.text) {
              sendWsJson(clientWs, {
                type: 'input_transcript',
                text: content.inputTranscription.text,
              });
            }

            if (content?.outputTranscription?.text) {
              sendWsJson(clientWs, {
                type: 'output_transcript',
                text: content.outputTranscription.text,
              });
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                sendWsJson(clientWs, {
                  type: 'audio',
                  data: part.inlineData.data,
                });
              }
              if (part.text) {
                sendWsJson(clientWs, {
                  type: 'model_text',
                  text: part.text,
                });
              }
            }

            if (content?.turnComplete) {
              sendWsJson(clientWs, { type: 'turn_complete' });
            }

            if (content?.interactionStatus) {
              sendWsJson(clientWs, {
                type: 'interaction_status',
                status: content.interactionStatus,
              });
            }

            const functionCalls = message.toolCall?.functionCalls ?? [];
            for (const call of functionCalls) {
              if (call.name === 'update_board') {
                const args = (call.args ?? {}) as Record<string, unknown>;
                try {
                  const saved = upsertStep(sessionRecord.id, {
                    step_number:
                      args.step_number !== undefined ? Number(args.step_number) : undefined,
                    type: typeof args.type === 'string' ? args.type : 'etape',
                    title: typeof args.title === 'string' ? args.title : 'Étape du cours',
                    content: typeof args.content === 'string' ? args.content : '',
                    highlight: args.highlight !== false,
                  });

                  sendWsJson(clientWs, {
                    type: 'board_updated',
                    step: saved.step,
                    steps: saved.steps,
                  });

                  const focusLine = Number(args.focus_line);
                  if (Number.isInteger(focusLine) && focusLine >= 1) {
                    sendWsJson(clientWs, {
                      type: 'pointer_moved',
                      pointer: {
                        step_number: saved.step.step_number,
                        line_number: focusLine,
                      },
                    });
                  } else if (saved.step.highlight) {
                    sendWsJson(clientWs, {
                      type: 'pointer_moved',
                      pointer: {
                        step_number: saved.step.step_number,
                        line_number: 1,
                      },
                    });
                  }

                  liveSession?.sendToolResponse({
                    functionResponses: [
                      {
                        id: call.id,
                        name: call.name,
                        response: {
                          ok: true,
                          step_number: saved.step.step_number,
                          title: saved.step.title,
                        },
                        ...(isExtendedThinking
                          ? { scheduling: FunctionResponseScheduling.WHEN_IDLE }
                          : {}),
                      },
                    ],
                  });
                } catch (err) {
                  console.error('Failed to persist update_board tool call:', err);
                  liveSession?.sendToolResponse({
                    functionResponses: [
                      {
                        id: call.id,
                        name: call.name,
                        response: { ok: false, error: 'Persistence failed' },
                        ...(isExtendedThinking
                          ? { scheduling: FunctionResponseScheduling.WHEN_IDLE }
                          : {}),
                      },
                    ],
                  });
                }
              } else if (call.name === 'point_to') {
                const args = (call.args ?? {}) as Record<string, unknown>;
                const stepNumber = Math.max(1, Number(args.step_number) || 1);
                const lineNumber = Math.max(1, Number(args.line_number) || 1);
                const label = typeof args.label === 'string' ? args.label.trim() : undefined;

                sendWsJson(clientWs, {
                  type: 'pointer_moved',
                  pointer: {
                    step_number: stepNumber,
                    line_number: lineNumber,
                    ...(label ? { label } : {}),
                  },
                });

                liveSession?.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: {
                        ok: true,
                        step_number: stepNumber,
                        line_number: lineNumber,
                      },
                      ...(isExtendedThinking
                        ? { scheduling: FunctionResponseScheduling.WHEN_IDLE }
                        : {}),
                    },
                  ],
                });
              }
            }
          },
          onerror: (err: ErrorEvent) => {
            const detail =
              err?.message ||
              (err as unknown as { error?: { message?: string } })?.error?.message ||
              'Erreur lors de la session Gemini Live.';
            console.error('Gemini Live error:', detail);
            sendWsJson(clientWs, {
              type: 'error',
              message: detail,
            });
          },
          onclose: (event: CloseEvent) => {
            if (!isClosing) {
              if (event?.code && event.code !== 1000 && event.reason) {
                sendWsJson(clientWs, {
                  type: 'error',
                  message: `Session Live fermée (${event.code}) : ${event.reason}`,
                });
              }
              sendWsJson(clientWs, { type: 'closed' });
            }
          },
        },
      });

      if (clientWs.readyState !== WebSocket.OPEN) {
        isClosing = true;
        liveSession.close();
        return;
      }

      sendWsJson(clientWs, {
        type: 'connected',
        model,
        voice,
        sessionId: sessionRecord.id,
        courseId: connectedCourse?.id ?? null,
      });
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : 'Impossible d’ouvrir la session Gemini Live.';
      console.error('Failed to connect Gemini Live:', error);
      sendWsJson(clientWs, { type: 'error', message: msg });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession || isClosing) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
        };

        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.data,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: msg.text.trim() }],
              },
            ],
            turnComplete: true,
          });
        } else if (msg.type === 'close') {
          isClosing = true;
          liveSession.close();
          clientWs.close();
        }
      } catch (err) {
        console.error('Invalid client WebSocket message:', err);
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors if already closed
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Professeur au Tableau Live running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
