# Entrypoint for serverless hosting (Vercel detects a FastAPI `app` here).
from app.main import app  # noqa: F401
