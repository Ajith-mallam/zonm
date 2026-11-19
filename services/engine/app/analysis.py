"""M6 attribution: Burrows/Eder/Cosine Delta, character n-gram cosine,
style-marker distance, the weighted ensemble and the confidence grade.

All methods produce a *distance* from the questioned profile to each
candidate's profile (lower = more similar). The ensemble standardises each
method's distances across candidates and averages them with the configured
weights, so methods on different scales contribute comparably.

This is closed-set attribution: it ranks the given candidates and cannot
conclude that none of them wrote the text. Open-set verification needs an
impostor corpus (M7, F7.5).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import numpy as np

from . import ENGINE_VERSION
from .features import (
    STYLE_MARKERS,
    TextUnit,
    build_unit,
    char_ngrams,
    feature_words,
    ngram_vector,
    relative_frequencies,
    select_mfw,
    select_ngrams,
    split_unit,
    style_vector,
)
from .langid import composition, lexicon_versions
from .preprocess import sha256_text
from .schemas import AnalysisSettings, AnalyzeRequest

METHODS = ("burrows_delta", "eder_delta", "cosine_delta", "char_ngram_cosine", "style_marker")

CLOSED_SET_CAVEAT = (
    "Closed-set ranking: the result assumes the author is one of the candidates. "
    "It cannot show that none of the candidates wrote the text (requires the impostor corpus, F7.5)."
)


class AnalysisError(ValueError):
    """The request is valid JSON but cannot be analysed (e.g. no usable text)."""


# ------------------------------------------------------------------ helpers

def _zscore_stats(rows: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Mean and sample SD per column, plus a mask of columns with non-zero
    variance (zero-variance features cannot be z-scored and are dropped)."""
    mean = rows.mean(axis=0)
    std = rows.std(axis=0, ddof=1) if rows.shape[0] > 1 else np.zeros(rows.shape[1])
    keep = std > 1e-12
    return mean, std, keep


def _cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 1.0
    return float(1.0 - np.dot(a, b) / (na * nb))


def burrows_delta(zq: np.ndarray, zc: np.ndarray) -> float:
    return float(np.mean(np.abs(zq - zc)))


def eder_delta(zq: np.ndarray, zc: np.ndarray) -> float:
    """Eder's Delta: Burrows' Delta with weights (n - i + 1) / n that decrease
    with feature rank, so the most frequent words count most."""
    n = len(zq)
    w = (n - np.arange(n)) / n
    return float(np.sum(w * np.abs(zq - zc)) / np.sum(w))


def cosine_delta(zq: np.ndarray, zc: np.ndarray) -> float:
    """Cosine Delta (Smith & Aldridge 2011; Evert et al. 2017)."""
    return _cosine_distance(zq, zc)


@dataclass
class _Corpus:
    candidates: dict[str, TextUnit]
    questioned: TextUnit
    candidate_chunks: dict[str, list[TextUnit]]
    questioned_chunks: list[TextUnit]

    @property
    def all_chunks(self) -> list[TextUnit]:
        return [c for cs in self.candidate_chunks.values() for c in cs] + self.questioned_chunks


def _settings_hash(settings: AnalysisSettings) -> str:
    blob = json.dumps(settings.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ----------------------------------------------------------------- pipeline

def analyze(req: AnalyzeRequest) -> dict:
    s = req.settings
    weights = s.resolved_weights()
    active = [m for m in METHODS if weights[m] > 0]
    if not active:
        raise AnalysisError("All method weights are zero.")

    corpus = _Corpus(
        candidates={c.id: build_unit(c.id, [d.text for d in c.documents], lowercase=s.lowercase) for c in req.candidates},
        questioned=build_unit("questioned", [d.text for d in req.questioned], lowercase=s.lowercase),
        candidate_chunks={},
        questioned_chunks=[],
    )
    if not corpus.questioned.words:
        raise AnalysisError("The questioned text contains no words.")
    empty = [cid for cid, u in corpus.candidates.items() if not u.words]
    if empty:
        raise AnalysisError(f"Candidates with no words: {', '.join(empty)}")
    corpus.candidate_chunks = {cid: split_unit(u, s.chunk_size) for cid, u in corpus.candidates.items()}
    corpus.questioned_chunks = split_unit(corpus.questioned, s.chunk_size)
    chunks = corpus.all_chunks
    cand_ids = list(corpus.candidates)
    warnings: list[str] = []

    def fw(u: TextUnit) -> list[str]:
        return feature_words(u, include_placeholders=s.include_placeholders)

    # ---- MFW-based Delta family
    mfw = select_mfw([fw(c) for c in chunks], s.mfw, s.culling)
    X = np.vstack([relative_frequencies(fw(c), mfw) for c in chunks]) if mfw else np.zeros((len(chunks), 0))
    mean, std, keep = _zscore_stats(X)
    mfw_used = [w for w, k in zip(mfw, keep) if k]
    if len(chunks) < 3:
        warnings.append(
            f"Only {len(chunks)} text chunks are available, so feature variance is poorly estimated. "
            "Reduce chunk_size or add text."
        )
    if len(mfw_used) < 10:
        warnings.append(f"Only {len(mfw_used)} usable MFW features after removing zero-variance words.")

    def z(u: TextUnit) -> np.ndarray:
        v = relative_frequencies(fw(u), mfw)
        return ((v - mean) / np.where(keep, std, 1.0))[keep]

    zq = z(corpus.questioned)
    zc = {cid: z(u) for cid, u in corpus.candidates.items()}

    distances: dict[str, dict[str, float]] = {m: {} for m in active}
    for cid in cand_ids:
        if mfw_used:
            if "burrows_delta" in active:
                distances["burrows_delta"][cid] = burrows_delta(zq, zc[cid])
            if "eder_delta" in active:
                distances["eder_delta"][cid] = eder_delta(zq, zc[cid])
            if "cosine_delta" in active:
                distances["cosine_delta"][cid] = cosine_delta(zq, zc[cid])

    # ---- character n-grams (relative frequencies, cosine distance)
    ngram_vocab: list[str] = []
    if "char_ngram_cosine" in active:
        profiles = {cid: char_ngrams(u.raw, s.char_ngram_min, s.char_ngram_max, lowercase=s.lowercase)
                    for cid, u in corpus.candidates.items()}
        q_profile = char_ngrams(corpus.questioned.raw, s.char_ngram_min, s.char_ngram_max, lowercase=s.lowercase)
        ngram_vocab = select_ngrams([*profiles.values(), q_profile], s.char_ngram_top)
        qv = ngram_vector(q_profile, ngram_vocab)
        for cid in cand_ids:
            distances["char_ngram_cosine"][cid] = _cosine_distance(qv, ngram_vector(profiles[cid], ngram_vocab))

    # ---- style markers (z-scored over chunks, mean absolute difference)
    markers_used: list[str] = []
    if "style_marker" in active:
        S = np.vstack([style_vector(c) for c in chunks])
        smean, sstd, skeep = _zscore_stats(S)
        markers_used = [m for m, k in zip(STYLE_MARKERS, skeep) if k]

        def sz(u: TextUnit) -> np.ndarray:
            return ((style_vector(u) - smean) / np.where(skeep, sstd, 1.0))[skeep]

        sq = sz(corpus.questioned)
        for cid, u in corpus.candidates.items():
            if markers_used:
                distances["style_marker"][cid] = float(np.mean(np.abs(sq - sz(u))))

    # Drop methods that could not run (e.g. no usable features).
    for m in list(distances):
        if len(distances[m]) != len(cand_ids):
            warnings.append(f"Method {m} was skipped: no usable features.")
            del distances[m]
    if not distances:
        raise AnalysisError("No method produced a result. Add more text.")

    ranking, ensemble, support = _ensemble(distances, weights, cand_ids)
    method_top = {m: min(d, key=lambda c: (d[c], c)) for m, d in distances.items()}

    # ---- stability across questioned chunks (Burrows Delta per chunk)
    chunk_tops: list[str] = []
    if len(corpus.questioned_chunks) >= 2 and mfw_used:
        for qc in corpus.questioned_chunks:
            zqc = z(qc)
            chunk_tops.append(min(cand_ids, key=lambda c: (burrows_delta(zqc, zc[c]), c)))

    sufficiency = {
        "questioned_words": len(corpus.questioned.words),
        "questioned_sufficient": len(corpus.questioned.words) >= s.min_questioned_words,
        "candidates": {
            cid: {"words": len(u.words), "sufficient": len(u.words) >= s.min_candidate_words}
            for cid, u in corpus.candidates.items()
        },
    }
    confidence = _confidence(ranking, ensemble, method_top, chunk_tops, sufficiency)

    q_comp = composition(corpus.questioned.tags)
    return {
        "engine_version": ENGINE_VERSION,
        "lexicon_versions": lexicon_versions(),
        "settings": s.model_dump(mode="json"),
        "settings_sha256": _settings_hash(s),
        "input_hashes": {
            "questioned": {d.id: sha256_text(d.text) for d in req.questioned},
            "candidates": {c.id: {d.id: sha256_text(d.text) for d in c.documents} for c in req.candidates},
        },
        "questioned": {
            "word_count": len(corpus.questioned.words),
            "chunks": len(corpus.questioned_chunks),
            "language": q_comp.to_dict(),
        },
        "candidates": [
            {
                "id": cid,
                "rank": rank,
                "ensemble_score": round(ensemble[cid], 6),
                "relative_support": round(support[cid], 6),
                "distances": {m: round(distances[m][cid], 6) for m in distances},
                "word_count": len(corpus.candidates[cid].words),
                "chunks": len(corpus.candidate_chunks[cid]),
                "language": composition(corpus.candidates[cid].tags).to_dict(),
            }
            for rank, cid in enumerate(ranking, start=1)
        ],
        "methods": {
            m: {"weight": weights[m], "top_candidate": method_top[m]} for m in distances
        },
        "features": {
            "mfw": mfw_used,
            "char_ngram_count": len(ngram_vocab),
            "style_markers": markers_used,
        },
        "confidence": confidence,
        "caveats": [CLOSED_SET_CAVEAT],
        "warnings": warnings,
    }


def _ensemble(
    distances: dict[str, dict[str, float]], weights: dict[str, float], cand_ids: list[str]
) -> tuple[list[str], dict[str, float], dict[str, float]]:
    """Ensemble score per candidate: the weighted mean over methods of the
    negated z-score of that method's distance across candidates (higher =
    closer). ``relative_support`` is a softmax of the ensemble scores. It shows
    how the evidence divides among candidates and is not a probability of
    authorship."""
    total_w = sum(weights[m] for m in distances)
    score = dict.fromkeys(cand_ids, 0.0)
    for m, d in distances.items():
        v = np.array([d[c] for c in cand_ids])
        sd = v.std()
        zs = (v - v.mean()) / sd if sd > 1e-12 else np.zeros_like(v)
        for c, zval in zip(cand_ids, zs):
            score[c] -= weights[m] * zval / total_w
    ranking = sorted(cand_ids, key=lambda c: (-score[c], c))
    e = np.exp(np.array([score[c] for c in cand_ids]) - max(score.values()))
    support = {c: float(x) for c, x in zip(cand_ids, e / e.sum())}
    return ranking, score, support


# Thresholds are provisional until calibrated against validation data (M9).
GRADES = ("strong", "moderate", "limited", "inconclusive")


def _confidence(
    ranking: list[str],
    ensemble: dict[str, float],
    method_top: dict[str, str],
    chunk_tops: list[str],
    sufficiency: dict,
) -> dict:
    reasons: list[str] = []
    top = ranking[0]
    if len(ranking) < 2:
        return {
            "grade": "inconclusive",
            "top_candidate": top,
            "factors": {},
            "reasons": ["Only one candidate: a comparison needs two or more (single-author verification is M7)."],
            "calibrated": False,
        }

    agreement = sum(1 for t in method_top.values() if t == top) / len(method_top)
    margin = ensemble[top] - ensemble[ranking[1]]
    stability = (sum(1 for t in chunk_tops if t == top) / len(chunk_tops)) if chunk_tops else None

    points = 0
    points += 2 if agreement == 1.0 else 1 if agreement >= 0.6 else 0
    points += 2 if margin >= 1.0 else 1 if margin >= 0.5 else 0
    if stability is None:
        reasons.append("Questioned text is a single chunk, so stability across chunks could not be measured.")
    else:
        points += 2 if stability >= 0.8 else 1 if stability >= 0.6 else 0

    reasons.append(f"{agreement:.0%} of methods rank {top} first.")
    reasons.append(f"Ensemble margin over the runner-up is {margin:.2f} standard units.")
    if stability is not None:
        reasons.append(f"{stability:.0%} of questioned chunks independently rank {top} first.")

    grade = "strong" if points >= 5 else "moderate" if points >= 4 else "limited" if points >= 2 else "inconclusive"

    insufficient = [cid for cid, v in sufficiency["candidates"].items() if not v["sufficient"]]
    if not sufficiency["questioned_sufficient"] or insufficient:
        if GRADES.index(grade) < GRADES.index("limited"):
            grade = "limited"
        if not sufficiency["questioned_sufficient"]:
            reasons.append(f"Questioned text is short ({sufficiency['questioned_words']} words); grade capped at limited.")
        if insufficient:
            reasons.append(f"Too little known writing for: {', '.join(insufficient)}; grade capped at limited.")

    return {
        "grade": grade,
        "top_candidate": top,
        "factors": {
            "method_agreement": round(agreement, 4),
            "ensemble_margin": round(margin, 4),
            "chunk_stability": None if stability is None else round(stability, 4),
            "points": points,
        },
        "reasons": reasons,
        "calibrated": False,
    }
