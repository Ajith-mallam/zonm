"""M5 word-level language identification for Kreol Seselwa / English / French,
plus the Code-Mixing Index (CMI).

Approach (rule-based, deterministic, explainable):
1. Lexicon evidence: a word in exactly one language's lexicon scores strongly
   for that language; a word shared by several lexicons scores weakly for each.
2. Orthographic evidence: accents and "qu"/"eau" endings suggest French;
   "th", "w", "-ing" and English contractions suggest English; Kreol spelling is
   phonemic ("k" for French "c/qu", "z" initials, "y" glides, no silent endings).
3. Context: words with no or ambiguous evidence take the language that dominates
   the surrounding window, then the document.

The seed lexicons are limited, and Kreol accuracy depends on the corpus the client
supplies (F5.5). The lexicon version is reported with every result so runs remain
reproducible when lexicons change.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .preprocess import Token

LANGS = ("crs", "en", "fr")
UNIVERSAL = "univ"  # language-independent word (names, single letters, laughter)
OTHER = "other"     # non-word tokens: punctuation, numbers, emoji, URLs, mentions
UNDETERMINED = "und"

_LEX_DIR = Path(__file__).parent / "lexicons"


@dataclass(frozen=True)
class Lexicon:
    language: str
    version: str
    function_words: frozenset[str]
    common_words: frozenset[str]

    @property
    def all_words(self) -> frozenset[str]:
        return self.function_words | self.common_words


@lru_cache(maxsize=1)
def load_lexicons() -> dict[str, Lexicon]:
    out = {}
    for lang in LANGS:
        data = json.loads((_LEX_DIR / f"{lang}.json").read_text(encoding="utf-8"))
        out[lang] = Lexicon(
            language=lang,
            version=data["version"],
            function_words=frozenset(w.lower() for w in data["function_words"]),
            common_words=frozenset(w.lower() for w in data["common_words"]),
        )
    return out


def lexicon_versions() -> dict[str, str]:
    return {k: v.version for k, v in load_lexicons().items()}


# (pattern, language, weight)
_ORTHO_RULES: list[tuple[re.Pattern[str], str, float]] = [
    (re.compile(r"[éèêëàâîïôûùçœ]"), "fr", 3.0),
    (re.compile(r"^(?:l|d|j|n|s|c|qu|m|t)'\w"), "fr", 3.0),
    (re.compile(r"qu"), "fr", 1.5),
    (re.compile(r"(?:eau|eaux|aux|tion|tions|ment|ments|ais|ait|aient|eur|euse|oir|oire|ique|ée|ées)$"), "fr", 1.0),
    (re.compile(r"(?:ent|es)$"), "fr", 0.5),
    (re.compile(r"\w'(?:s|t|re|ll|ve|d|m)$"), "en", 3.0),
    (re.compile(r"th"), "en", 1.5),
    (re.compile(r"(?:ing|ed|ly|ness|ship|ful|less|ight|ough)$"), "en", 1.0),
    (re.compile(r"(?:ck|sh|wh|ee|oo)"), "en", 0.75),
    (re.compile(r"w"), "en", 0.5),
    (re.compile(r"^z[aeiouy]"), "crs", 1.5),
    (re.compile(r"(?:^|[aeiou])k[aeiou]"), "crs", 0.75),
    (re.compile(r"(?:by|dy|ky|ly|ny|py|vy)[aeiou]"), "crs", 1.0),
    (re.compile(r"(?:man|nman|zon|syon|aj)$"), "crs", 0.75),
    (re.compile(r"^(?:la|le|li|lo|lan|lez)[bcdfgjklmnprstvz]"), "crs", 0.5),
]

# Laughter and interjections carry no language signal.
_UNIVERSAL_RE = re.compile(r"^(?:(?:ha|he|hi|ah|eh|oh|lo)+h?|l+o+l+|x+d+|mdr+|o+k+|hm+|u+h+|a+r+g+h+)$")
_ELONGATION_RE = re.compile(r"(\w)\1{2,}")


def _word_scores(word: str, lex: dict[str, Lexicon]) -> dict[str, float]:
    w = word.lower()
    scores = dict.fromkeys(LANGS, 0.0)
    hits = [lang for lang in LANGS if w in lex[lang].all_words]
    if not hits:
        squashed = _ELONGATION_RE.sub(r"\1", w)  # "sooo" -> "so"
        if squashed != w:
            hits = [lang for lang in LANGS if squashed in lex[lang].all_words]
            w = squashed if hits else w
    for lang in hits:
        scores[lang] += 4.0 if len(hits) == 1 else 1.0
    for pattern, lang, weight in _ORTHO_RULES:
        if pattern.search(w):
            scores[lang] += weight
    return scores


def tag_tokens(tokens: list[Token], *, window: int = 3) -> list[str]:
    """Return one language tag per token: crs | en | fr | univ | other | und."""
    lex = load_lexicons()
    tags: list[str] = []
    confident: list[str | None] = []
    scores_all: list[dict[str, float] | None] = []

    for tok in tokens:
        if tok.kind != "word":
            tags.append(OTHER)
            confident.append(None)
            scores_all.append(None)
            continue
        w = tok.text.lower()
        if _UNIVERSAL_RE.match(w) or (len(w) == 1 and w not in {"i", "a", "y", "à"}):
            tags.append(UNIVERSAL)
            confident.append(None)
            scores_all.append(None)
            continue
        s = _word_scores(w, lex)
        ranked = sorted(s.items(), key=lambda kv: (-kv[1], kv[0]))
        (best, b), (_, second) = ranked[0], ranked[1]
        scores_all.append(s)
        if b >= 2.0 and b - second >= 1.5:
            tags.append(best)
            confident.append(best)
        else:
            tags.append(UNDETERMINED)
            confident.append(None)

    doc_counts = Counter(c for c in confident if c)
    doc_majority = doc_counts.most_common(1)[0][0] if doc_counts else None

    # Resolve ambiguous words from local context, then from the document.
    for i, tag in enumerate(tags):
        if tag != UNDETERMINED:
            continue
        lo, hi = max(0, i - window), min(len(tokens), i + window + 1)
        ctx = Counter(confident[j] for j in range(lo, hi) if confident[j])
        s = scores_all[i] or {}
        if ctx:
            # Context votes, broken by the word's own (weak) evidence.
            best = max(LANGS, key=lambda lang: (ctx.get(lang, 0) + 0.25 * s.get(lang, 0.0), lang == doc_majority))
            if ctx.get(best, 0) > 0 or s.get(best, 0) > 0:
                tags[i] = best
                continue
        if any(v > 0 for v in s.values()):
            tags[i] = max(LANGS, key=lambda lang: (s[lang], lang == doc_majority))
        elif doc_majority:
            tags[i] = doc_majority
    return tags


@dataclass(frozen=True)
class Composition:
    word_count: int
    counts: dict[str, int]
    proportions: dict[str, float]  # over language-tagged words (crs/en/fr)
    dominant: str | None
    cmi: float

    def to_dict(self) -> dict:
        return {
            "word_count": self.word_count,
            "counts": self.counts,
            "proportions": self.proportions,
            "dominant_language": self.dominant,
            "cmi": self.cmi,
        }


def composition(tags: list[str]) -> Composition:
    """Language composition over word tokens and the Code-Mixing Index of
    Das & Gambäck (2014): CMI = 100 * (1 - max_lang / (n - u)), where n is the
    number of words and u the number of language-independent words."""
    word_tags = [t for t in tags if t != OTHER]
    n = len(word_tags)
    counts = Counter(word_tags)
    lang_counts = {lang: counts.get(lang, 0) for lang in LANGS}
    u = n - sum(lang_counts.values())
    tagged = n - u
    if tagged > 0:
        max_lang = max(lang_counts.values())
        cmi = 100.0 * (1.0 - max_lang / tagged)
        props = {lang: c / tagged for lang, c in lang_counts.items()}
        dominant = max(LANGS, key=lambda lang: (lang_counts[lang], lang))
    else:
        cmi, props, dominant = 0.0, dict.fromkeys(LANGS, 0.0), None
    all_counts = {**lang_counts, UNIVERSAL: counts.get(UNIVERSAL, 0), UNDETERMINED: counts.get(UNDETERMINED, 0)}
    return Composition(n, all_counts, props, dominant, round(cmi, 4))
