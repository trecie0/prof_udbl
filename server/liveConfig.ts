import { Behavior, Type, type FunctionDeclaration } from '@google/genai';
import type { CourseItem, LiveModelOption } from '../src/types/board.ts';

export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';

export const AVAILABLE_LIVE_MODELS: LiveModelOption[] = [
  {
    id: 'gemini-3.8-live',
    label: 'Gemini 3.8 Live',
    description: 'Dialogue vocal fluide à latence minimale avec appel d’outils en direct.',
  },
  {
    id: 'gemini-3.8-live-extended-thinking',
    label: 'Gemini 3.8 Live · Raisonnement avancé',
    description: 'Raisonnement approfondi pour démonstrations mathématiques et algorithmiques complexes.',
  },
];

export const AVAILABLE_VOICES = ['Charon', 'Zephyr', 'Kore', 'Fenrir', 'Puck'];
export const DEFAULT_VOICE = 'Charon';

export const PROFESSOR_SYSTEM_INSTRUCTION = `Tu es « Professeur au Tableau » (assistant pédagogique vocal compatible Harmoni / UDBL), un enseignant francophone bienveillant, clair et très visuel.
Tu donnes un cours en direct à un étudiant qui regarde un tableau blanc scolaire structuré en vue focus (une étape à la fois).

RÈGLES PÉDAGOGIQUES STRICTES :
1. GARDE LE TABLEAU ÉPURÉ ET LISIBLE (PAS DE LONGS PARAGRAPHES) :
   - Ne recopie jamais tes phrases orales au tableau : explique à l'oral avec pédagogie, et n'écris au tableau que l'essentiel (3 à 4 lignes maximum par bloc, mots-clés courts, formules, flèches ou code bref).
   - Chaque ligne du tableau doit être courte (idéalement moins de 12 mots) pour éviter toute surcharge visuelle.
2. ILLUSTRE TOUJOURS AVEC DES EXEMPLES CONCRETS :
   - Dès que tu expliques une règle ou un concept abstrait, crée un bloc \`exemple\` avec 2 ou 3 cas concrets chiffrés ou applicatifs (ex. \`Entrée -> Résultat\` ou \`Cas 1 : ...\`).
3. UTILISE LE POINTEUR \`point_to\` EN PARLANT :
   - C'est TOI (le professeur) qui pilotes le curseur sur le tableau. Dès que tu passes d'une ligne, formule, nœud de schéma ou exemple au suivant pendant ton explication orale, appelle \`point_to(step_number, line_number, label)\` pour guider les yeux de l'étudiant !
   - Numérote mentalement les lignes affichées de haut en bas (1, 2, 3...) et déplace ton curseur à chaque élément commenté.
4. TYPES DE BLOCS DISPONIBLES POUR \`update_board\` :
   - \`etape\` : idée clé en 2 à 3 puces très courtes.
   - \`calcul\` : 1 équation ou étape de calcul par ligne (avec LaTeX $$...$$ si besoin).
   - \`schema\` : relations courtes \`Concept A -> Concept B : lien\`.
   - \`code\` : court extrait commenté (5 à 10 lignes max).
   - \`exemple\` : cas concrets ou valeurs d'essai (\`Cas -> Résultat\` ou puces courtes).
   - \`synthese\` : 2 à 3 points clés à retenir.
5. Réponds toujours en français naturel et chaleureux. Ne lis pas les noms d'outils à voix haute.`;

export function buildCourseInstructionContext(course: CourseItem | null, moduleId?: string | null): string {
  if (!course) return '';
  const focusedModule = moduleId
    ? course.modules.find((m) => m.id === moduleId)
    : undefined;

  const modulesText = course.modules
    .map(
      (mod, index) =>
        `${index + 1}. ${mod.title}${
          mod.key_points.length > 0 ? ` — Points clés : ${mod.key_points.join(' ; ')}` : ''
        }`,
    )
    .join('\n');

  const focusSection = focusedModule
    ? `\nCHAPITRE CIBLÉ EN PRIORITÉ : ${focusedModule.title}\nPoints à couvrir : ${focusedModule.key_points.join(' ; ')}`
    : '';

  return `\n\nCOURS CONNECTÉ À EXPLIQUER (CONTEXTE PÉDAGOGIQUE RÉEL) :
- Code & Matière : ${course.code} — ${course.title}
- Niveau : ${course.level}
- Titulaire / Référence : ${course.professor_name}
- Support : ${course.syllabus_title}
- Résumé : ${course.summary}
${modulesText ? `- Programme / Chapitres :\n${modulesText}` : ''}${focusSection}

CONSIGNE POUR CE COURS :
- Appuie-toi strictement sur ce programme et ces notions pour expliquer le cours comme un vrai professeur en salle.
- Commence par poser l'idée clé au tableau (\`update_board\`), puis enchaîne avec une formule/schéma/code et un bloc \`exemple\` concret, tout en guidant l'étudiant avec \`point_to\`.`;
}

export function buildUpdateBoardDeclaration(nonBlocking = false): FunctionDeclaration {
  return {
    name: 'update_board',
    description:
      'Affiche ou met à jour une étape épurée au tableau (mots-clés courts, calcul, schéma, code, exemple concret ou synthèse).',
    ...(nonBlocking ? { behavior: Behavior.NON_BLOCKING } : {}),
    parameters: {
      type: Type.OBJECT,
      properties: {
        step_number: {
          type: Type.INTEGER,
          description: 'Numéro chronologique de l’étape au tableau (1, 2, 3...).',
        },
        type: {
          type: Type.STRING,
          enum: ['etape', 'calcul', 'schema', 'code', 'exemple', 'synthese'],
          description: 'Catégorie visuelle du bloc pédagogique.',
        },
        title: {
          type: Type.STRING,
          description: 'Titre très court de l’étape (4 à 7 mots).',
        },
        content: {
          type: Type.STRING,
          description:
            'Contenu bref et structuré (3 à 4 lignes max, une idée/équation/exemple par ligne). Pas de long paragraphe.',
        },
        highlight: {
          type: Type.BOOLEAN,
          description: 'Met cette étape au premier plan ("En cours").',
        },
        focus_line: {
          type: Type.INTEGER,
          description: 'Numéro de ligne (1-indexé) sur lequel placer immédiatement le pointeur.',
        },
      },
      required: ['step_number', 'type', 'title', 'content', 'highlight'],
    },
  };
}

export function buildPointToDeclaration(nonBlocking = false): FunctionDeclaration {
  return {
    name: 'point_to',
    description:
      'Déplace le pointeur du professeur sur une ligne, une équation, un nœud de schéma ou un exemple précis du tableau pendant l’explication orale.',
    ...(nonBlocking ? { behavior: Behavior.NON_BLOCKING } : {}),
    parameters: {
      type: Type.OBJECT,
      properties: {
        step_number: {
          type: Type.INTEGER,
          description: 'Numéro de l’étape ciblée sur le tableau.',
        },
        line_number: {
          type: Type.INTEGER,
          description: 'Numéro de la ligne ou de l’élément (1 = première ligne, 2 = deuxième, etc.).',
        },
        label: {
          type: Type.STRING,
          description: 'Indication courte interne du focus (ex. "Formule clé", "Cas concret").',
        },
      },
      required: ['step_number', 'line_number'],
    },
  };
}
