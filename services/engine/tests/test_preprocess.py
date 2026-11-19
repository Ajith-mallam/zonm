import unicodedata

import pytest

from app.preprocess import chunk_spans, normalise, sentences, sha256_text, tokenise


def test_token_kinds():
    toks = tokenise("Bonzour @Marie! Get https://ex.com/a?b=1. #SEZ 2026 \U0001F602 l'eau don't")
    kinds = [(t.text, t.kind) for t in toks]
    assert ("@Marie", "mention") in kinds
    assert ("https://ex.com/a?b=1", "url") in kinds  # trailing full stop excluded
    assert ("#SEZ", "hashtag") in kinds
    assert ("2026", "num") in kinds
    assert ("\U0001F602", "emoji") in kinds
    assert ("l'eau", "word") in kinds
    assert ("don't", "word") in kinds


def test_placeholders_normalised_and_words_lowercased():
    toks = tokenise("HELLO @bob")
    assert [t.norm for t in toks] == ["hello", "<mention>"]
    assert tokenise("HELLO", lowercase=False)[0].norm == "HELLO"


def test_offsets_index_normalised_text():
    text = "Ki manyer? I’m “fine” \U0001F44D\U0001F3FD"
    norm = normalise(text)
    assert len(norm) == len(unicodedata.normalize("NFC", text))  # one-to-one map
    for t in tokenise(text):
        assert norm[t.start:t.end] == t.text
    assert "I'm" in [t.text for t in tokenise(text)]


def test_nfc_composes_accents():
    decomposed = "été"
    assert normalise(decomposed) == "été"
    assert [t.text for t in tokenise(decomposed)] == ["été"]


def test_sentences_split_on_punctuation_and_newlines():
    text = "First one. Second one!!! third line\nfourth line"
    toks = tokenise(text)
    sents = sentences(toks, normalise(text))
    assert len(sents) == 4


@pytest.mark.parametrize(
    "n_words,size,expected",
    [(10, 5, 2), (12, 5, 2), (13, 5, 3), (4, 5, 1), (0, 5, 0)],
)
def test_chunk_spans_merge_small_remainder(n_words, size, expected):
    toks = tokenise(" ".join(["w"] * n_words) + ("" if n_words else ""))
    spans = chunk_spans(toks, size)
    assert len(spans) == expected
    if spans:
        assert spans[0][0] == 0 and spans[-1][1] == len(toks)
        # spans are contiguous
        for (a, b), (c, d) in zip(spans, spans[1:]):
            assert b == c


def test_sha256_is_of_raw_input():
    assert sha256_text("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
