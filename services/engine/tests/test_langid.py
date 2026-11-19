from app.langid import composition, tag_tokens
from app.preprocess import tokenise


def tags_for(text):
    toks = tokenise(text)
    return [(t.text, g) for t, g in zip(toks, tag_tokens(toks)) if t.kind == "word"]


def comp(text):
    return composition(tag_tokens(tokenise(text)))


def test_monolingual_dominant_language():
    assert comp("Mon pe al lakaz avek zot aprezan, me i pa konnen kote nou ete.").dominant == "crs"
    assert comp("I think the government is wrong about this, they never listen.").dominant == "en"
    assert comp("Je pense que le gouvernement a tort, ils n'écoutent jamais.").dominant == "fr"


def test_monolingual_cmi_is_zero():
    assert comp("I think the government is wrong about this, they never listen.").cmi == 0.0


def test_code_mixed_text_has_positive_cmi():
    c = comp("Zot pa konnen what they are doing, c'est vraiment pa bon")
    assert c.cmi > 30
    assert c.counts["crs"] > 0 and c.counts["en"] > 0 and c.counts["fr"] > 0


def test_cmi_formula():
    # 3 crs + 1 en, no universal words: CMI = 100 * (1 - 3/4) = 25
    c = comp("zot bann avek the")
    assert c.counts["crs"] == 3 and c.counts["en"] == 1
    assert c.cmi == 25.0


def test_shared_words_resolved_by_context():
    # "i" is in both the English and Kreol lexicons.
    tags = dict(tags_for("zot pa konnen akoz i pe vini"))
    assert tags["i"] == "crs"
    tags = dict(tags_for("yesterday i went to the house"))
    assert tags["i"] == "en"


def test_laughter_is_universal_and_excluded_from_cmi():
    c = comp("hahaha lol the people")
    assert c.counts["univ"] == 2
    assert c.cmi == 0.0


def test_elongated_words_recognised():
    assert dict(tags_for("sooooo good"))["sooooo"] == "en"


def test_non_words_tagged_other():
    toks = tokenise("@bob 123 !")
    assert tag_tokens(toks) == ["other", "other", "other"]
    assert composition(tag_tokens(toks)).word_count == 0
