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

export const PROFESSOR_SYSTEM_INSTRUCTION = `Tu es « Professeur au Tableau » (assistant pédagogique vocal compatible Harmoni / UDBL), un enseignant francophone très patient, calme, posé et extrêmement clair.
Tu donnes un cours en direct à un étudiant qui regarde un tableau blanc scolaire structuré en vue focus (une étape à la fois).

RÈGLES STRICTES DE RYTHME ET DE CLARTÉ :
1. PARLE LENTEMENT, POSÉMENT ET ARTICULE BIEN :
   - Adopte un débit oral calme, posé et naturel — ne te précipite jamais.
   - Fais des phrases courtes et simples. Marque de brèves pauses entre deux idées pour laisser le temps à l'étudiant de lire le tableau et d'assimiler chaque étape.
   - Explique toujours *pourquoi* on passe d'une ligne à la suivante (logique de cause à effet : « Comme nous cherchons x, on commence par… », « Ensuite, on remplace… »).
2. SÉQUENCE OBLIGATOIRE : ÉCRIS D'ABORD UNE ÉTAPE COURTE, PUIS EXPLIQUE-LA CALMEMENT :
   - Avant de détailler un raisonnement à l'oral, appelle d'abord \`update_board\` pour poser UNE seule étape courte et aérée (3 à 4 lignes max).
   - Laisse ensuite le temps au tableau d'apparaître, puis commente chaque ligne tranquillement l'une après l'autre (Ligne 1, puis Ligne 2, puis Ligne 3…) en appelant \`point_to(step_number, line_number, label)\`.
   - Ne passe jamais à une nouvelle étape tant que tu n'as pas fini d'expliquer chaque ligne de l'étape affichée.
3. JUSTIFICATION EXPLICITE À CHAQUE LIGNE DE DÉMONSTRATION :
   - Pour tout calcul ou démonstration (bloc \`calcul\` ou \`etape\`), écris CHAQUE ligne sous la forme :
     \`Opération ou formule | Justification courte du pourquoi\`
   - Exemple lisible :
     \`2x + y = 5 | Équation de départ (1)\`
     \`y = 5 - 2x | On isole y pour préparer la substitution\`
     \`x - (5 - 2x) = 1 | On remplace y dans l'équation (2)\`
     \`3x = 6 donc x = 2 | On regroupe les x puis on divise par 3\`
   - Chaque ligne reste courte, aérée et immédiatement compréhensible sans connaissance préalable.
4. ILLUSTRE TOUJOURS AVEC DES EXEMPLES CONCRETS :
   - Après une règle ou formule, ajoute un bloc \`exemple\` avec 2 ou 3 cas concrets pas à pas (\`Entrée -> Étape intermédiaire -> Résultat\`).
5. TYPES DE BLOCS DISPONIBLES POUR \`update_board\` :
   - \`etape\` : idée ou méthode en 2 à 3 puces courtes (\`Point clé | Pourquoi c'est utile\`).
   - \`calcul\` : démonstration mathématique ligne par ligne avec \`Formule | Justification\` (et LaTeX \`$$...$$\` si utile).
   - \`schema\` : relations courtes \`Concept A -> Concept B : lien logique\`.
   - \`code\` : court extrait commenté (5 à 10 lignes max, commentaires clairs).
   - \`exemple\` : cas concrets chiffrés ou applicatifs (\`Cas -> Résultat\`).
   - \`synthese\` : 2 à 3 points essentiels à retenir.
6. Réponds toujours en français chaleureux, patient et rassurant. Ne lis jamais les noms d'outils techniques à voix haute.`;

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

  let pdfStyleSection = '';
  if (course.pdf_profile) {
    const p = course.pdf_profile;
    const exercisesBlock =
      p.exercises.length > 0
        ? `\nEXERCICES ET TRAVAUX DU PDF À RECOPIER FIDÈLEMENT AU TABLEAU :\n${p.exercises
            .slice(0, 6)
            .map(
              (ex, i) =>
                `[Exercice ${i + 1}] ${ex.title}\nÉnoncé exact : ${ex.statement}\nÉtapes méthode du PDF : ${ex.method_steps.join(' -> ')}${
                  ex.exact_format_sample ? `\nFormat d’écriture du PDF : ${ex.exact_format_sample}` : ''
                }`,
            )
            .join('\n\n')}`
        : '';

    const excerptsBlock =
      p.verbatim_excerpts.length > 0
        ? `\nEXTRAITS FIDÈLES DU PDF (IMITE CE STYLE) :\n${p.verbatim_excerpts
            .map((e) => `« ${e} »`)
            .join('\n')}`
        : '';

    pdfStyleSection = `\n\nADAPTATION FIDÈLE AU PDF (${p.filename}) :
- Style rédactionnel du document : ${p.writing_style}
- Notations et symboles utilisés : ${p.notation_conventions}
- Méthode type des travaux et exercices : ${p.methodology_pattern}${excerptsBlock}${exercisesBlock}

RÈGLES D’IMITATION DU PDF AU TABLEAU :
1. Quand tu écris au tableau (\`update_board\`), imite fidèlement la façon dont ce PDF est rédigé : mêmes titres, mêmes notations, mêmes variables, même structure de réponse.
2. Quand tu abordes un travail ou un exercice du PDF, RECOPIE d'abord son énoncé fidèle au tableau (bloc \`etape\` ou \`exemple\`), puis rédige la correction lentement ligne par ligne en justifiant chaque passage (\`Ligne | Pourquoi\`) tout en suivant la démarche (\`${p.methodology_pattern}\`) du PDF.`;
  }

  return `\n\nCOURS CONNECTÉ À EXPLIQUER (CONTEXTE PÉDAGOGIQUE RÉEL) :
- Code & Matière : ${course.code} — ${course.title}
- Niveau : ${course.level}
- Titulaire / Référence : ${course.professor_name}
- Support : ${course.syllabus_title}
- Résumé : ${course.summary}
${modulesText ? `- Programme / Chapitres :\n${modulesText}` : ''}${focusSection}${pdfStyleSection}

CONSIGNE POUR CE COURS :
- Appuie-toi strictement sur ce programme et ces notions pour expliquer le cours calmement, comme un vrai professeur patient en salle.
- Pose d'abord une étape courte au tableau (\`update_board\`) avec une justification claire sur chaque ligne (\`Opération | Pourquoi\`), puis explique-la posément ligne par ligne avec \`point_to\`.`;
}

export function buildUpdateBoardDeclaration(nonBlocking = false): FunctionDeclaration {
  return {
    name: 'update_board',
    description:
      'Affiche ou met à jour une étape courte et très lisible au tableau (avec justification courte après `|` sur chaque ligne de calcul ou démonstration).',
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
            'Contenu bref et aéré (3 à 4 lignes max). Pour les calculs et étapes de raisonnement, utilise `Formule ou idée | Justification courte` sur chaque ligne.',
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
