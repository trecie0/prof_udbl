import uuid
from django.db import models


class LessonSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255, default="Séance interactive")
    model_name = models.CharField(max_length=120, default="gemini-3.8-live")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.title} ({self.id})"


class BoardStep(models.Model):
    STEP_TYPES = [
        ("etape", "Étape"),
        ("calcul", "Calcul"),
        ("schema", "Schéma"),
        ("code", "Code"),
        ("exemple", "Exemple"),
        ("synthese", "Synthèse"),
    ]

    session = models.ForeignKey(
        LessonSession,
        on_delete=models.CASCADE,
        related_name="steps",
    )
    step_number = models.PositiveIntegerField()
    step_type = models.CharField(max_length=20, choices=STEP_TYPES, default="etape")
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)
    highlight = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["step_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "step_number"],
                name="unique_step_per_session",
            )
        ]

    def __str__(self) -> str:
        return f"Étape {self.step_number} · {self.title}"
