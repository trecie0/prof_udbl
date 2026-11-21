import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { CourseModule, PdfExerciseItem, PdfStyleProfile } from '../src/types/board.ts';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
]);

const MAX_BINARY_BYTES = 10 * 1024 * 1024; // 10 MB max

export interface AnalyzedPdfCourse {
  suggested_title: string;
  suggested_code: string;
  suggested_professor: string;
  summary: string;
  modules: CourseModule[];
  pdf_profile: PdfStyleProfile;
}

export function sanitizeFilename(rawName: string | undefined): string {
  const base = (rawName || 'cours.pdf')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .trim();
  return (base || 'cours.pdf').slice(0, 120);
}

function cleanBase64Input(raw: string): string {
  const commaIdx = raw.indexOf(',');
  const stripped = raw.startsWith('data:') && commaIdx !== -1 ? raw.slice(commaIdx + 1) : raw;
  return stripped.replace(/\s+/g, '');
}

export async function analyzeCourseDocument(params: {
  filename?: string;
  mimeType?: string;
  dataBase64: string;
  existingCourseTitle?: string;
}): Promise<AnalyzedPdfCourse> {
  const mimeType = (params.mimeType || 'application/pdf').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('UNSUPPORTED_MIME_TYPE');
  }

  const cleanB64 = cleanBase64Input(params.dataBase64 || '');
  if (!cleanB64) {
    throw new Error('EMPTY_FILE');
  }

  const buffer = Buffer.from(cleanB64, 'base64');
  if (buffer.length === 0) {
    throw new Error('EMPTY_FILE');
  }
  if (buffer.length > MAX_BINARY_BYTES) {
    throw new Error('FILE_TOO_LARGE');
  }

  if (mimeType === 'application/pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new Error('INVALID_PDF_HEADER');
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  const safeFilename = sanitizeFilename(params.filename);
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const analysisPrompt = `Analyse fidèlement ce document pédagogique (${safeFilename})${
    params.existingCourseTitle ? ` pour le cours « ${params.existingCourseTitle} »` : ''
  }.

Ton objectif est de permettre à un professeur virtuel d'ADOPTER EXACTEMENT LA FAÇON DONT CE DOCUMENT EST ÉCRIT :
1. Observe attentivement le style d'écriture, le vocabulaire, la mise en forme des titres, définitions, théorèmes, travaux pratiques (TP/TD) et exercices.
2. Relève les notations exactes (symboles mathématiques, noms de variables, conventions de syntaxe, unités, puces ou numérotations comme "Exercice 1 :", "Question a)", "Données / Formule / Solution").
3. Extrais fidèlement les principaux chapitres/sections du document.
4. Extrais les exercices, travaux dirigés ou exemples résolus présents dans le PDF en RECOPIANT fidèlement leurs énoncés exacts, leur format d'écriture et les étapes exactes de résolution utilisées par l'auteur du document.
5. Sélectionne 2 à 4 courts extraits fidèles (verbatim) représentatifs du style du document.

Réponds exclusivement en JSON structuré en français.`;

  const contentParts =
    mimeType === 'application/pdf'
      ? [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanB64,
            },
          },
          { text: analysisPrompt },
        ]
      : [
          {
            text: `${analysisPrompt}\n\n--- CONTENU DU DOCUMENT ---\n${buffer.toString('utf8').slice(0, 120000)}`,
          },
        ];

  const isTransientCapacityError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('"code":503') ||
      msg.includes('"code":429') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      /high demand|overloaded|try again later|rate limit/i.test(msg)
    );
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      suggested_title: {
        type: Type.STRING,
        description: 'Titre du cours détecté dans le PDF.',
      },
      suggested_code: {
        type: Type.STRING,
        description: 'Code court du cours si présent (ex. MATH-101) ou code pertinent.',
      },
      suggested_professor: {
        type: Type.STRING,
        description: 'Nom du professeur ou auteur mentionné dans le document, sinon Professeur UDBL.',
      },
      summary: {
        type: Type.STRING,
        description: 'Résumé clair et concis du contenu du PDF (2 à 3 phrases).',
      },
      writing_style: {
        type: Type.STRING,
        description:
          'Description précise de la façon dont le PDF est rédigé (ton, structure des phrases, numérotation des questions/exercices, style des titres).',
      },
      notation_conventions: {
        type: Type.STRING,
        description:
          'Notations, symboles mathématiques, noms de variables ou conventions typographiques spécifiques observés dans le PDF.',
      },
      methodology_pattern: {
        type: Type.STRING,
        description:
          'Démarche type utilisée dans les travaux et exercices du PDF (ex: Énoncé -> Données -> Formule -> Application numérique -> Conclusion).',
      },
      modules: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            key_points: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['title', 'key_points'],
        },
      },
      exercises: {
        type: Type.ARRAY,
        description:
          'Exercices, TD, TP ou exemples résolus extraits fidèlement du PDF pour être recopiés et expliqués de la même façon au tableau.',
        items: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Titre ou numéro exact de l’exercice (ex. Exercice 1 : Pivot de Gauss).',
            },
            statement: {
              type: Type.STRING,
              description: 'Énoncé fidèlement recopié du PDF (3 à 6 lignes concises).',
            },
            method_steps: {
              type: Type.ARRAY,
              description: 'Étapes de résolution suivant exactement la méthode du PDF.',
              items: { type: Type.STRING },
            },
            exact_format_sample: {
              type: Type.STRING,
              description: 'Exemple court illustrant la mise en forme exacte attendue dans le PDF.',
            },
          },
          required: ['title', 'statement', 'method_steps', 'exact_format_sample'],
        },
      },
      verbatim_excerpts: {
        type: Type.ARRAY,
        description: '2 à 4 courts passages fidèles copiés du document montrant son style exact.',
        items: { type: Type.STRING },
      },
    },
    required: [
      'suggested_title',
      'suggested_code',
      'suggested_professor',
      'summary',
      'writing_style',
      'notation_conventions',
      'methodology_pattern',
      'modules',
      'exercises',
      'verbatim_excerpts',
    ],
  };

  const attempts: Array<{ model: string; thinkingLevel: ThinkingLevel; delayBeforeMs: number }> = [
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.MEDIUM, delayBeforeMs: 0 },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 1000 },
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 800 },
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.LOW, delayBeforeMs: 1800 },
  ];

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastError: unknown = null;

  for (const attempt of attempts) {
    if (attempt.delayBeforeMs > 0) {
      await sleep(attempt.delayBeforeMs);
    }
    try {
      response = await ai.models.generateContent({
        model: attempt.model,
        contents: { parts: contentParts },
        config: {
          systemInstruction:
            'Tu es un assistant d’analyse pédagogique expert qui extrait avec fidélité le style rédactionnel, les notations, la méthodologie et les exercices exacts d’un support de cours PDF.',
          thinkingConfig: { thinkingLevel: attempt.thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      if (!isTransientCapacityError(err)) {
        throw err;
      }
      console.warn(`PDF analyzer transient capacity error on ${attempt.model}, retrying/falling back...`);
    }
  }

  if (!response) {
    if (isTransientCapacityError(lastError)) {
      throw new Error('MODEL_TEMPORARILY_UNAVAILABLE');
    }
    throw lastError instanceof Error ? lastError : new Error('PDF_ANALYSIS_FAILED');
  }

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('EMPTY_MODEL_RESPONSE');
  }
  const cleanedJson = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(cleanedJson) as Record<string, unknown>;

  const rawModules = Array.isArray(parsed.modules) ? parsed.modules : [];
  const modules: CourseModule[] = rawModules
    .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
    .slice(0, 12)
    .map((m, idx) => ({
      id: `pdf-mod-${idx + 1}`,
      title:
        typeof m.title === 'string' && m.title.trim()
          ? m.title.trim()
          : `Section ${idx + 1}`,
      key_points: Array.isArray(m.key_points)
        ? m.key_points
            .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .slice(0, 8)
        : [],
    }));

  const rawExercises = Array.isArray(parsed.exercises) ? parsed.exercises : [];
  const exercises: PdfExerciseItem[] = rawExercises
    .filter((ex): ex is Record<string, unknown> => Boolean(ex && typeof ex === 'object'))
    .slice(0, 10)
    .map((ex, idx) => ({
      title:
        typeof ex.title === 'string' && ex.title.trim()
          ? ex.title.trim()
          : `Exercice ${idx + 1}`,
      statement: typeof ex.statement === 'string' ? ex.statement.trim() : '',
      method_steps: Array.isArray(ex.method_steps)
        ? ex.method_steps
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .slice(0, 8)
        : [],
      exact_format_sample:
        typeof ex.exact_format_sample === 'string' ? ex.exact_format_sample.trim() : '',
    }))
    .filter((ex) => ex.statement.length > 0);

  const verbatimExcerpts = Array.isArray(parsed.verbatim_excerpts)
    ? parsed.verbatim_excerpts
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .slice(0, 4)
    : [];

  const pdf_profile: PdfStyleProfile = {
    filename: safeFilename,
    analyzed_at: new Date().toISOString(),
    writing_style:
      typeof parsed.writing_style === 'string' && parsed.writing_style.trim()
        ? parsed.writing_style.trim()
        : 'Style académique structuré fidèle au document.',
    notation_conventions:
      typeof parsed.notation_conventions === 'string' && parsed.notation_conventions.trim()
        ? parsed.notation_conventions.trim()
        : 'Notations exactes du support PDF.',
    methodology_pattern:
      typeof parsed.methodology_pattern === 'string' && parsed.methodology_pattern.trim()
        ? parsed.methodology_pattern.trim()
        : 'Énoncé -> Méthode -> Application -> Résultat.',
    exercises,
    verbatim_excerpts: verbatimExcerpts,
  };

  return {
    suggested_title:
      typeof parsed.suggested_title === 'string' && parsed.suggested_title.trim()
        ? parsed.suggested_title.trim()
        : safeFilename.replace(/\.[^.]+$/, ''),
    suggested_code:
      typeof parsed.suggested_code === 'string' && parsed.suggested_code.trim()
        ? parsed.suggested_code.trim().toUpperCase().slice(0, 20)
        : 'PDF-UDBL',
    suggested_professor:
      typeof parsed.suggested_professor === 'string' && parsed.suggested_professor.trim()
        ? parsed.suggested_professor.trim()
        : 'Professeur UDBL',
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : `Support PDF importé : ${safeFilename}`,
    modules,
    pdf_profile,
  };
}
