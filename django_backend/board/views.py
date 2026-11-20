from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import BoardStep, LessonSession
from .serializers import (
    BoardStepSerializer,
    LessonSessionDetailSerializer,
    LessonSessionListSerializer,
)

PROFESSOR_SYSTEM_INSTRUCTION = (
    "Tu es « Professeur au Tableau », un enseignant francophone pédagogue et très visuel. "
    "Écris des mots-clés courts, formules ou schémas (3 à 4 lignes max par bloc), ajoute des blocs `exemple` concrets, "
    "appelle `update_board` pour écrire au tableau et `point_to` pour pointer les lignes pendant ton explication."
)

UPDATE_BOARD_DECLARATION = {
    "name": "update_board",
    "description": "Ajoute ou met à jour une étape structurée et concise sur le tableau pédagogique.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "step_number": {"type": "INTEGER"},
            "type": {
                "type": "STRING",
                "enum": ["etape", "calcul", "schema", "code", "exemple", "synthese"],
            },
            "title": {"type": "STRING"},
            "content": {"type": "STRING"},
            "highlight": {"type": "BOOLEAN"},
            "focus_line": {"type": "INTEGER"},
        },
        "required": ["step_number", "type", "title", "content", "highlight"],
    },
}

POINT_TO_DECLARATION = {
    "name": "point_to",
    "description": "Déplace le pointeur laser du professeur sur une ligne ou un élément précis du tableau.",
    "parameters": {
        "type": "OBJECT",
        "properties": {
            "step_number": {"type": "INTEGER"},
            "line_number": {"type": "INTEGER"},
            "label": {"type": "STRING"},
        },
        "required": ["step_number", "line_number"],
    },
}


@api_view(["GET"])
def live_config(request):
    return Response(
        {
            "model": settings.GEMINI_LIVE_MODEL,
            "system_instruction": PROFESSOR_SYSTEM_INSTRUCTION,
            "tools": [{"functionDeclarations": [UPDATE_BOARD_DECLARATION, POINT_TO_DECLARATION]}],
            "has_server_key": bool(settings.GEMINI_API_KEY),
        }
    )


@api_view(["GET", "POST"])
def session_list_create(request):
    if request.method == "GET":
        sessions = LessonSession.objects.all()
        serializer = LessonSessionListSerializer(sessions, many=True)
        return Response(serializer.data)

    title = (request.data.get("title") or "").strip() or "Nouvelle séance de cours"
    model_name = request.data.get("model_name") or settings.GEMINI_LIVE_MODEL
    session = LessonSession.objects.create(title=title, model_name=model_name)
    serializer = LessonSessionDetailSerializer(session)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "DELETE"])
def session_detail_delete(request, session_id):
    session = get_object_or_404(LessonSession, id=session_id)
    if request.method == "GET":
        return Response(LessonSessionDetailSerializer(session).data)

    session.delete()
    return Response({"deleted": True}, status=status.HTTP_200_OK)


@api_view(["POST"])
def session_add_step(request, session_id):
    session = get_object_or_404(LessonSession, id=session_id)
    step_number = request.data.get("step_number")
    step_type = request.data.get("step_type") or request.data.get("type") or "etape"
    title = (request.data.get("title") or "").strip()
    content = request.data.get("content", "")
    highlight = request.data.get("highlight", True)

    if not title:
        return Response({"detail": "Le champ title est requis."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        if not step_number:
            last_step = session.steps.order_by("-step_number").first()
            step_number = (last_step.step_number + 1) if last_step else 1

        if highlight:
            session.steps.update(highlight=False)

        step, _ = BoardStep.objects.update_or_create(
            session=session,
            step_number=int(step_number),
            defaults={
                "step_type": step_type,
                "title": title,
                "content": content,
                "highlight": bool(highlight),
            },
        )
        session.save(update_fields=["updated_at"])

    steps = session.steps.all()
    return Response(
        {
            "step": BoardStepSerializer(step).data,
            "steps": BoardStepSerializer(steps, many=True).data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def session_clear_steps(request, session_id):
    session = get_object_or_404(LessonSession, id=session_id)
    session.steps.all().delete()
    session.save(update_fields=["updated_at"])
    return Response({"cleared": True, "steps": []})
