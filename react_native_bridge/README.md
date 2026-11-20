# Intégration React Native / Expo (Plateforme UDBL · Harmoni & Moni 1.0 Live)

Ce dossier contient le pont prêt à l'emploi pour connecter votre application mobile **React Native / Expo** (`frontend/src/screens/assistant.js`, `geminiLiveSession.js`, `api.js`) à **Professeur au Tableau Live**.

## Deux modes de connexion disponibles

### Option A — Intégration directe par WebView (`ProfesseurBoardWebView.tsx`)
Ouvrez directement l'interface tableau blanc en plein écran sans panneau latéral :

```text
https://VOTRE_URL/?embed=1&courseId=udbl-algebre-l1&autoExplain=1
```

Paramètres URL pris en charge :
- `embed=1` : masque la barre latérale de bureau et optimise l'affichage pour mobile.
- `courseId=<id>` : connecte automatiquement la séance au cours ciblé.
- `moduleId=<id>` : cible un chapitre précis du syllabus.
- `autoExplain=1` : demande immédiatement au professeur d'expliquer le cours au tableau.

Commandes envoyables depuis React Native vers le tableau via `postMessage` :
- `{ "type": "SYNC_COURSES", "courses": [...] }`
- `{ "type": "CONNECT_COURSE", "courseId": "...", "moduleId": "...", "autoExplain": true }`
- `{ "type": "ASK_PROFESSOR", "text": "Explique la méthode de Gauss" }`
- `{ "type": "START_LIVE" }` / `{ "type": "STOP_LIVE" }` / `{ "type": "CLEAR_BOARD" }`

Événements reçus dans `onMessage` côté React Native :
- `READY`, `COURSE_CONNECTED`, `BOARD_UPDATED`, `POINTER_MOVED`, `LIVE_STATE_CHANGED`, `TRANSCRIPT`.

### Option B — Connexion native `react-native-audio-api` + WebSocket (`HarmoniBoardClient.ts`)
Compatible avec le pipeline audio de **Moni 1.0 Live** :
- **Entrée micro** : PCM 16 bits mono, **16 kHz**, base64 (`{ type: "audio", data }`).
- **Sortie voix** : PCM 16 bits mono, **24 kHz**, base64 (`{ type: "audio", data }`).
- **Cours** : `GET / POST /api/courses/` pour synchroniser vos cours UDBL (`Cours` / `CoursPdf` / extraits RAG) puis `POST /api/sessions/:id/connect-course/` avant d'ouvrir `/api/live-ws?sessionId=...&courseId=...`.
