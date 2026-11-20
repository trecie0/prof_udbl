# Backend de référence Django + Django REST Framework

Ce dossier contient l'implémentation autonome en Django + DRF correspondant aux modèles et endpoints REST de **Professeur au Tableau Live**.

## Installation et lancement (environnement Python séparé)

```bash
cd django_backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py makemigrations board
python manage.py migrate
export GEMINI_API_KEY="votre_cle_api"
python manage.py runserver 8000
```

## Endpoints exposés

- `GET /api/live-config/` : modèle Live, instruction système et déclaration d'outil `update_board`.
- `GET / POST /api/sessions/` : lister ou créer une séance `LessonSession`.
- `GET / DELETE /api/sessions/<uuid:session_id>/` : détail ou suppression d'une séance.
- `POST /api/sessions/<uuid:session_id>/steps/` : créer/mettre à jour un `BoardStep` et désactiver `highlight` sur les étapes précédentes si actif.
- `POST /api/sessions/<uuid:session_id>/clear/` : vider toutes les étapes d'une séance.
