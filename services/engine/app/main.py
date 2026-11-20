"""ZONM NET stylometric analysis engine (FastAPI).

Stateless service: receives texts + settings, returns features, scores and
explanations. All persistence, auth and audit live in the web app / database.
"""
import hmac
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import ENGINE_VERSION
from .analysis import METHODS, AnalysisError, analyze
from .features import build_unit, split_unit, style_markers
from .langid import composition, lexicon_versions
from .preprocess import normalise, sentences, sha256_text
from .schemas import AnalyzeRequest, PreprocessRequest

app = FastAPI(title="ZONM NET Analysis Engine", version=ENGINE_VERSION)


@app.middleware("http")
async def require_token(request: Request, call_next):
    """When ENGINE_TOKEN is set (any engine reachable from outside, e.g. on
    Vercel), /v1/* requires "Authorization: Bearer <ENGINE_TOKEN>". /health
    stays open. Without ENGINE_TOKEN (local, private network) nothing changes."""
    token = os.environ.get("ENGINE_TOKEN", "")
    if token and request.url.path.startswith("/v1/"):
        given = request.headers.get("authorization", "")
        if not hmac.compare_digest(given.encode(), f"Bearer {token}".encode()):
            return JSONResponse({"detail": "unauthorised"}, status_code=401)
    return await call_next(request)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine_version": ENGINE_VERSION}


@app.get("/v1/info")
def info() -> dict:
    return {
        "engine_version": ENGINE_VERSION,
        "lexicon_versions": lexicon_versions(),
        "methods": list(METHODS),
    }


@app.post("/v1/preprocess")
def preprocess(req: PreprocessRequest) -> dict:
    """M5: normalise, tokenise and language-tag one text (extraction preview,
    language composition, CMI)."""
    s = req.settings
    unit = build_unit("text", [req.text], lowercase=s.lowercase)
    tokens, tags = unit.tokens, unit.tags
    out = {
        "engine_version": ENGINE_VERSION,
        "lexicon_versions": lexicon_versions(),
        "sha256": sha256_text(req.text),
        "normalised_text": normalise(req.text),
        "sentence_count": len(sentences(tokens, unit.raw)),
        "chunk_count": len(split_unit(unit, s.chunk_size)) if tokens else 0,
        "language": composition(tags).to_dict(),
        "style_markers": style_markers(unit),
    }
    if s.include_tokens:
        out["tokens"] = [
            {"text": t.text, "norm": t.norm, "kind": t.kind, "lang": g, "start": t.start, "end": t.end}
            for t, g in zip(tokens, tags)
        ]
    return out


@app.post("/v1/analyze")
def analyze_route(req: AnalyzeRequest) -> dict:
    """M6: closed-set attribution of the questioned text among the candidates."""
    try:
        return analyze(req)
    except AnalysisError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
