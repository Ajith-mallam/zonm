"""Request models for the engine API. All settings are echoed back in results so
a run can be reproduced exactly (F6.9)."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DEFAULT_WEIGHTS = {
    "burrows_delta": 1.0,
    "eder_delta": 1.0,
    "cosine_delta": 1.0,
    "char_ngram_cosine": 1.0,
    "style_marker": 1.0,
}

MAX_TEXT_CHARS = 2_000_000


class Document(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=MAX_TEXT_CHARS)


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    documents: list[Document] = Field(min_length=1)


class AnalysisSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mfw: int = Field(200, ge=10, le=5000, description="Number of most frequent words for the Delta methods.")
    culling: float = Field(0.0, ge=0.0, le=1.0, description="Keep MFW present in at least this fraction of chunks.")
    chunk_size: int = Field(500, ge=50, le=20000, description="Words per chunk for variance estimates and stability.")
    char_ngram_min: int = Field(3, ge=1, le=8)
    char_ngram_max: int = Field(3, ge=1, le=8)
    char_ngram_top: int = Field(1000, ge=50, le=20000)
    lowercase: bool = True
    include_placeholders: bool = Field(
        False, description="Count <url>, <mention>, <hashtag>, <email>, <num> tokens as MFW candidates."
    )
    weights: dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    min_questioned_words: int = Field(200, ge=0)
    min_candidate_words: int = Field(1000, ge=0)

    @field_validator("weights")
    @classmethod
    def _known_methods(cls, v: dict[str, float]) -> dict[str, float]:
        unknown = set(v) - set(DEFAULT_WEIGHTS)
        if unknown:
            raise ValueError(f"unknown methods: {sorted(unknown)}")
        if any(w < 0 for w in v.values()):
            raise ValueError("weights must be non-negative")
        return {**DEFAULT_WEIGHTS, **v}

    @model_validator(mode="after")
    def _ngram_range(self) -> "AnalysisSettings":
        if self.char_ngram_min > self.char_ngram_max:
            raise ValueError("char_ngram_min must be <= char_ngram_max")
        return self

    def resolved_weights(self) -> dict[str, float]:
        return {**DEFAULT_WEIGHTS, **self.weights}


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    questioned: list[Document] = Field(min_length=1)
    candidates: list[Candidate] = Field(min_length=1, max_length=200)
    settings: AnalysisSettings = Field(default_factory=AnalysisSettings)

    @model_validator(mode="after")
    def _unique_ids(self) -> "AnalyzeRequest":
        ids = [c.id for c in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate ids must be unique")
        return self


class PreprocessSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lowercase: bool = True
    chunk_size: int = Field(500, ge=50, le=20000)
    include_tokens: bool = True


class PreprocessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=MAX_TEXT_CHARS)
    settings: PreprocessSettings = Field(default_factory=PreprocessSettings)
