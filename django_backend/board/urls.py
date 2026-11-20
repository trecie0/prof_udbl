from django.urls import path
from . import views

urlpatterns = [
    path("live-config/", views.live_config, name="live-config"),
    path("sessions/", views.session_list_create, name="session-list-create"),
    path("sessions/<uuid:session_id>/", views.session_detail_delete, name="session-detail-delete"),
    path("sessions/<uuid:session_id>/steps/", views.session_add_step, name="session-add-step"),
    path("sessions/<uuid:session_id>/clear/", views.session_clear_steps, name="session-clear-steps"),
]
