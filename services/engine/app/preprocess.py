"""M5 preprocessing: normalisation, tokenisation, sentence segmentation, chunking.

Design notes
- Normalisation is character-for-character after Unicode NFC, so token offsets
  index into ``normalise(text)`` exactly. Curly quotes, dashes and NBSP map to
  ASCII equivalents of the same length. Style markers that care about the raw
  typography (for example curly vs straight apostrophes) read the NFC text, not
  the normalised text.
- URLs, e-mail addresses, @mentions, #hashtags, numbers and emoji become typed
  tokens rather than being deleted, because their frequency is a style signal.
  They are excluded from word-frequency features by default.
"""
from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass

# One-to-one character mappings only (offsets must stay aligned).
_CHAR_MAP = str.maketrans(
    {
        "\u2018": "'", "\u2019": "'", "\u02bc": "'", "`": "'", "\u00b4": "'",
        "\u201c": '"', "\u201d": '"', "\u00ab": '"', "\u00bb": '"', "\u201e": '"',
        "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2212": "-",
        "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u200b": " ",
    }
)

_EMOJI = (
    r"[\U0001F000-\U0001FAFF\u2600-\u27bf\u2b00-\u2bff\u2300-\u23ff]"
    r"[\U0001F3FB-\U0001F3FF\ufe0f\u200d\U0001F000-\U0001FAFF\u2600-\u27bf]*"
)

TOKEN_RE = re.compile(
    r"(?P<url>(?:https?://|www\.)\S*[^\s.,!?;:)\]'\"])"
    r"|(?P<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)"
    r"|(?P<mention>(?<!\w)@\w+)"
    r"|(?P<hashtag>(?<!\w)#\w+)"
    r"|(?P<num>\d+(?:[.,:/]\d+)*)"
    r"|(?P<word>[^\W\d_]+(?:['-][^\W\d_]+)*)"
    rf"|(?P<emoji>{_EMOJI})"
    r"|(?P<punct>[^\w\s])",
    re.UNICODE,
)

PLACEHOLDER_KINDS = frozenset({"url", "email", "mention", "hashtag", "num"})
SENTENCE_END = frozenset({".", "!", "?"})


@dataclass(frozen=True, slots=True)
class Token:
    text: str
    norm: str  # lower-cased form used for features; placeholders become <kind>
    kind: str  # word | url | email | mention | hashtag | num | emoji | punct
    start: int
    end: int

    @property
    def is_word(self) -> bool:
        return self.kind == "word"


def sha256_text(text: str) -> str:
    """SHA-256 of the text exactly as received (UTF-8), for F6.9 run records."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalise(text: str) -> str:
    return unicodedata.normalize("NFC", text).translate(_CHAR_MAP)


def tokenise(text: str, *, lowercase: bool = True) -> list[Token]:
    """Tokenise normalised text. Offsets refer to ``normalise(text)``."""
    norm_text = normalise(text)
    tokens: list[Token] = []
    for m in TOKEN_RE.finditer(norm_text):
        kind = m.lastgroup or "punct"
        surface = m.group()
        if kind in PLACEHOLDER_KINDS:
            norm = f"<{kind}>"
        elif kind == "word" and lowercase:
            norm = surface.lower()
        else:
            norm = surface
        tokens.append(Token(surface, norm, kind, m.start(), m.end()))
    return tokens


def sentences(tokens: list[Token], text: str | None = None) -> list[list[Token]]:
    """Split on terminal punctuation and on line breaks (social posts rarely
    use full stops). ``text`` is the normalised text, used to detect newlines."""
    out: list[list[Token]] = []
    cur: list[Token] = []
    prev_end = 0
    for tok in tokens:
        if text is not None and cur and "\n" in text[prev_end:tok.start]:
            out.append(cur)
            cur = []
        cur.append(tok)
        prev_end = tok.end
        if tok.kind == "punct" and tok.text in SENTENCE_END:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    # Segments with no words (a trailing "!!", an emoji after the full stop)
    # belong to the preceding sentence.
    merged: list[list[Token]] = []
    for seg in out:
        if merged and not any(t.is_word for t in seg):
            merged[-1].extend(seg)
        else:
            merged.append(seg)
    return [s for s in merged if any(t.is_word for t in s)]


def chunk_spans(tokens: list[Token], size: int) -> list[tuple[int, int]]:
    """Split the token list into consecutive spans holding ``size`` word tokens
    each. A trailing remainder smaller than half a chunk merges into the previous
    chunk. Returns (start_index, end_index) pairs over ``tokens``."""
    if size <= 0:
        raise ValueError("chunk size must be positive")
    word_idx = [i for i, t in enumerate(tokens) if t.is_word]
    if not word_idx:
        return [(0, len(tokens))] if tokens else []
    bounds = list(range(0, len(word_idx), size))
    if len(bounds) > 1 and len(word_idx) - bounds[-1] < size / 2:
        bounds.pop()
    spans = []
    for n, b in enumerate(bounds):
        start = 0 if n == 0 else word_idx[b]
        end = word_idx[bounds[n + 1]] if n + 1 < len(bounds) else len(tokens)
        spans.append((start, end))
    return spans
