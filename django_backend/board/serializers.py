from rest_framework import serializers
from .models import BoardStep, LessonSession


class BoardStepSerializer(serializers.ModelSerializer):
    session_id = serializers.UUIDField(source="session.id", read_only=True)

    class Meta:
        model = BoardStep
        fields = [
            "id",
            "session_id",
            "step_number",
            "step_type",
            "title",
            "content",
            "highlight",
            "created_at",
        ]


class LessonSessionListSerializer(serializers.ModelSerializer):
    step_count = serializers.IntegerField(source="steps.count", read_only=True)

    class Meta:
        model = LessonSession
        fields = [
            "id",
            "title",
            "model_name",
            "created_at",
            "updated_at",
            "step_count",
        ]


class LessonSessionDetailSerializer(serializers.ModelSerializer):
    steps = BoardStepSerializer(many=True, read_only=True)

    class Meta:
        model = LessonSession
        fields = [
            "id",
            "title",
            "model_name",
            "created_at",
            "updated_at",
            "steps",
        ]
