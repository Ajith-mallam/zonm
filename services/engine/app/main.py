"""ZONM NET stylometric analysis engine (FastAPI).

Stateless service: receives texts + settings, returns features, scores and
explanations. All persistence, auth and audit live in the web app / database.
"""
from fastapi import FastAPI

ENGINE_VERSION = "0.1.0"

app = FastAPI(title="ZONM NET Analysis Engine", version=ENGINE_VERSION)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine_version": ENGINE_VERSION}
