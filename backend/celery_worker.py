"""
Celery worker entrypoint.
Start worker with: celery -A celery_worker worker --loglevel=info
"""
from app.celery_app import celery_app
import app.tasks.email_tasks
import app.tasks.report_tasks
