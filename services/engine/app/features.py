"""M6 feature extraction: most-frequent-word (MFW) frequencies, character n-gram
profiles and style markers.

A "text unit" is either a whole pooled profile (all of one candidate's documents,
or all questioned documents) or a chunk of one. Chunks supply the variance
estimates for z-scoring, and pooled profiles are what get compared.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .langid import LANGS, composition, load_lexicons, tag_tokens
from .preprocess import Token, chunk_spans, normalise, sentences, tokenise


@dataclass
class TextUnit:
    """A preprocessed span of text with everything the methods need."""
    label: str
    raw: str  # NFC-normalised text of the span (raw typography preserved)
    tokens: list[Token]
    tags: list[str]
    words: list[str] = field(init=False)

    def __post_init__(self) -> None:
        self.words = [t.norm for t in self.tokens if t.is_word]


def build_unit(label: str, texts: list[str], *, lowercase: bool = True) -> TextUnit:
    """Pool several documents into one unit. Documents are joined with a blank
    line so sentences never span two documents. ``raw`` is NFC only: the
    character map in ``normalise`` is one-to-one, so token offsets still index
    into it while curly quotes and NBSPs stay visible to the style markers."""
    raw = "\n\n".join(unicodedata.normalize("NFC", t) for t in texts)
    tokens = tokenise(raw, lowercase=lowercase)
    return TextUnit(label, raw, tokens, tag_tokens(tokens))


def split_unit(unit: TextUnit, size: int) -> list[TextUnit]:
    """Chunk a unit into ~``size``-word sub-units. Language tags are taken from
    the parent so context smoothing is not lost at chunk edges."""
    out = []
    for n, (a, b) in enumerate(chunk_spans(unit.tokens, size)):
        toks = unit.tokens[a:b]
        if not toks:
            continue
        # Re-base offsets so the chunk's raw text and tokens stay consistent.
        base = toks[0].start
        rebased = [Token(t.text, t.norm, t.kind, t.start - base, t.end - base) for t in toks]
        out.append(TextUnit(f"{unit.label}#{n + 1}", unit.raw[base:toks[-1].end], rebased, unit.tags[a:b]))
    return out


# ---------------------------------------------------------------- MFW features

def feature_words(unit: TextUnit, *, include_placeholders: bool = False) -> list[str]:
    if include_placeholders:
        return [t.norm for t in unit.tokens if t.is_word or t.norm.startswith("<")]
    return unit.words


def select_mfw(units: list[list[str]], n: int, culling: float = 0.0) -> list[str]:
    """The ``n`` most frequent words across ``units``. With ``culling`` > 0, keep
    only words that occur in at least that fraction of units (Stylo-style
    culling). Ties break alphabetically so the selection is deterministic."""
    total = Counter()
    doc_freq = Counter()
    for words in units:
        c = Counter(words)
        total.update(c)
        doc_freq.update(c.keys())
    min_units = culling * len(units)
    ranked = sorted(
        (w for w in total if doc_freq[w] >= min_units),
        key=lambda w: (-total[w], w),
    )
    return ranked[:n]


def relative_frequencies(words: list[str], vocab: list[str]) -> np.ndarray:
    if not words:
        return np.zeros(len(vocab))
    c = Counter(words)
    return np.array([c[w] for w in vocab], dtype=float) / len(words)


# ----------------------------------------------------------- char n-grams

_WS_RE = re.compile(r"\s+")


def char_ngrams(text: str, n_min: int, n_max: int, *, lowercase: bool = True) -> Counter:
    t = _WS_RE.sub(" ", normalise(text)).strip()
    if lowercase:
        t = t.lower()
    c: Counter = Counter()
    for n in range(n_min, n_max + 1):
        c.update(t[i:i + n] for i in range(len(t) - n + 1))
    return c


def select_ngrams(profiles: list[Counter], top: int) -> list[str]:
    total: Counter = Counter()
    for p in profiles:
        total.update(p)
    return sorted(total, key=lambda g: (-total[g], g))[:top]


def ngram_vector(profile: Counter, vocab: list[str]) -> np.ndarray:
    s = sum(profile.values())
    if s == 0:
        return np.zeros(len(vocab))
    return np.array([profile[g] for g in vocab], dtype=float) / s


# ---------------------------------------------------------- style markers

_PUNCT_MARKERS = {
    "comma": ",", "period": ".", "exclamation": "!", "question": "?", "semicolon": ";",
    "colon": ":", "quote": '"', "apostrophe": "'", "hyphen": "-", "paren": "(",
}
_REPEAT_PUNCT_RE = re.compile(r"([!?.])\1+")
_ELONGATED_RE = re.compile(r"([^\W\d_])\1{2,}", re.UNICODE)
_SPACE_BEFORE_PUNCT_RE = re.compile(r"\w[ \xa0\u202f][!?;:]")
_DOUBLE_SPACE_RE = re.compile(r"[^\s] {2,}[^\s]")
_CURLY_RE = re.compile(r"[\u2018\u2019\u201c\u201d]")
_STRAIGHT_RE = re.compile(r"['\"]")
_MATTR_WINDOW = 50

STYLE_MARKERS: tuple[str, ...] = (
    "mean_word_length",
    "mean_sentence_length",
    "mattr",
    *(f"punct_{k}_per_100w" for k in _PUNCT_MARKERS),
    "repeated_punct_per_100w",
    "ellipsis_per_100w",
    "space_before_punct_per_100w",
    "double_space_per_100w",
    "curly_quote_ratio",
    "allcaps_word_ratio",
    "capitalised_sentence_ratio",
    "elongated_word_ratio",
    "digit_per_100w",
    "emoji_per_100w",
    "url_per_100w",
    "mention_per_100w",
    "hashtag_per_100w",
    "function_word_ratio",
    *(f"lang_{lang}_proportion" for lang in LANGS),
    "cmi",
)


def _mattr(words: list[str], window: int = _MATTR_WINDOW) -> float:
    """Moving-average type-token ratio (Covington & McFall 2010), which is far
    less length-sensitive than plain TTR."""
    if not words:
        return 0.0
    if len(words) <= window:
        return len(set(words)) / len(words)
    counts = Counter(words[:window])
    total = len(counts)
    for i in range(window, len(words)):
        out, inc = words[i - window], words[i]
        counts[out] -= 1
        if counts[out] == 0:
            del counts[out]
        counts[inc] += 1
        total += len(counts)
    return total / (len(words) - window + 1)


def style_markers(unit: TextUnit) -> dict[str, float]:
    toks = unit.tokens
    words = [t for t in toks if t.is_word]
    nw = max(len(words), 1)
    per100 = 100.0 / nw
    kinds = Counter(t.kind for t in toks)
    punct = Counter(t.text for t in toks if t.kind == "punct")
    sents = sentences(toks, unit.raw)
    sent_word_counts = [sum(1 for t in s if t.is_word) for s in sents]
    sent_word_counts = [c for c in sent_word_counts if c > 0]
    first_words = [next((t for t in s if t.is_word), None) for s in sents]
    first_words = [t for t in first_words if t is not None]
    lex = load_lexicons()
    fw = frozenset().union(*(lex[lang].function_words for lang in LANGS))
    curly = len(_CURLY_RE.findall(unit.raw))
    straight = len(_STRAIGHT_RE.findall(unit.raw))
    comp = composition(unit.tags)

    m: dict[str, float] = {
        "mean_word_length": float(np.mean([len(t.text) for t in words])) if words else 0.0,
        "mean_sentence_length": float(np.mean(sent_word_counts)) if sent_word_counts else 0.0,
        "mattr": _mattr(unit.words),
    }
    for k, ch in _PUNCT_MARKERS.items():
        m[f"punct_{k}_per_100w"] = punct.get(ch, 0) * per100
    m["repeated_punct_per_100w"] = len(_REPEAT_PUNCT_RE.findall(unit.raw)) * per100
    m["ellipsis_per_100w"] = (unit.raw.count("...") + unit.raw.count("\u2026")) * per100
    m["space_before_punct_per_100w"] = len(_SPACE_BEFORE_PUNCT_RE.findall(unit.raw)) * per100
    m["double_space_per_100w"] = len(_DOUBLE_SPACE_RE.findall(unit.raw)) * per100
    m["curly_quote_ratio"] = curly / (curly + straight) if curly + straight else 0.0
    m["allcaps_word_ratio"] = sum(1 for t in words if len(t.text) > 1 and t.text.isupper()) / nw
    m["capitalised_sentence_ratio"] = (
        sum(1 for t in first_words if t.text[0].isupper()) / len(first_words) if first_words else 0.0
    )
    m["elongated_word_ratio"] = sum(1 for t in words if _ELONGATED_RE.search(t.text)) / nw
    m["digit_per_100w"] = kinds.get("num", 0) * per100
    m["emoji_per_100w"] = kinds.get("emoji", 0) * per100
    m["url_per_100w"] = kinds.get("url", 0) * per100
    m["mention_per_100w"] = kinds.get("mention", 0) * per100
    m["hashtag_per_100w"] = kinds.get("hashtag", 0) * per100
    m["function_word_ratio"] = sum(1 for w in unit.words if w in fw) / nw
    for lang in LANGS:
        m[f"lang_{lang}_proportion"] = comp.proportions[lang]
    m["cmi"] = comp.cmi
    return m


def style_vector(unit: TextUnit) -> np.ndarray:
    m = style_markers(unit)
    return np.array([m[k] for k in STYLE_MARKERS], dtype=float)
