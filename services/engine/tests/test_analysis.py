import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analysis import burrows_delta, cosine_delta, eder_delta
from app.main import app

client = TestClient(app)


def request_for(authors, questioned_author, *, q_words=800, k_words=3000, settings=None):
    body = {
        "questioned": [{"id": "q1", "text": authors[questioned_author](q_words, 999)}],
        "candidates": [
            {"id": name, "documents": [{"id": f"{name}-d{i}", "text": write(k_words // 2, i)} for i in range(2)]}
            for name, write in authors.items()
        ],
    }
    if settings:
        body["settings"] = settings
    return body


@pytest.mark.parametrize("truth", ["alpha", "bravo", "charlie"])
def test_attributes_to_true_author(authors, truth):
    r = client.post("/v1/analyze", json=request_for(authors, truth, settings={"chunk_size": 200, "mfw": 80}))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["candidates"][0]["id"] == truth
    assert out["confidence"]["top_candidate"] == truth
    for m in ("burrows_delta", "eder_delta", "cosine_delta", "char_ngram_cosine"):
        assert out["methods"][m]["top_candidate"] == truth, m
    assert out["confidence"]["grade"] in ("strong", "moderate")
    assert abs(sum(c["relative_support"] for c in out["candidates"]) - 1.0) < 1e-6


def test_run_record_is_reproducible(authors):
    body = request_for(authors, "bravo", settings={"chunk_size": 200})
    a = client.post("/v1/analyze", json=body).json()
    b = client.post("/v1/analyze", json=body).json()
    assert a == b
    assert a["settings"]["chunk_size"] == 200
    assert a["settings"]["mfw"] == 200  # defaults are filled in and echoed
    assert len(a["settings_sha256"]) == 64
    assert set(a["input_hashes"]["candidates"]["alpha"]) == {"alpha-d0", "alpha-d1"}
    assert a["engine_version"] and a["lexicon_versions"]["crs"]


def test_settings_hash_changes_with_settings(authors):
    a = client.post("/v1/analyze", json=request_for(authors, "alpha", settings={"mfw": 50})).json()
    b = client.post("/v1/analyze", json=request_for(authors, "alpha", settings={"mfw": 60})).json()
    assert a["settings_sha256"] != b["settings_sha256"]


def test_short_text_caps_grade(authors):
    out = client.post(
        "/v1/analyze", json=request_for(authors, "alpha", q_words=60, k_words=400, settings={"chunk_size": 50})
    ).json()
    assert out["confidence"]["grade"] in ("limited", "inconclusive")
    assert any("short" in r for r in out["confidence"]["reasons"])


def test_single_candidate_is_inconclusive(authors):
    body = request_for(authors, "alpha")
    body["candidates"] = body["candidates"][:1]
    out = client.post("/v1/analyze", json=body).json()
    assert out["confidence"]["grade"] == "inconclusive"


def test_zero_weight_disables_method(authors):
    out = client.post(
        "/v1/analyze", json=request_for(authors, "alpha", settings={"weights": {"style_marker": 0}})
    ).json()
    assert "style_marker" not in out["methods"]
    assert "style_marker" not in out["candidates"][0]["distances"]


def test_closed_set_caveat_present(authors):
    out = client.post("/v1/analyze", json=request_for(authors, "alpha")).json()
    assert any("Closed-set" in c for c in out["caveats"])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["questioned"][0].update(text="!!! ... ???"),
        lambda b: b["candidates"][0]["documents"][0].update(text="123 456") or b["candidates"][0].update(
            documents=b["candidates"][0]["documents"][:1]
        ),
    ],
)
def test_no_words_is_422(authors, mutate):
    body = request_for(authors, "alpha")
    mutate(body)
    assert client.post("/v1/analyze", json=body).status_code == 422


@pytest.mark.parametrize(
    "settings",
    [{"weights": {"magic": 1}}, {"weights": {"burrows_delta": -1}}, {"char_ngram_min": 4, "char_ngram_max": 2}, {"bogus": 1}],
)
def test_invalid_settings_rejected(authors, settings):
    assert client.post("/v1/analyze", json=request_for(authors, "alpha", settings=settings)).status_code == 422


def test_duplicate_candidate_ids_rejected(authors):
    body = request_for(authors, "alpha")
    body["candidates"][1]["id"] = body["candidates"][0]["id"]
    assert client.post("/v1/analyze", json=body).status_code == 422


def test_delta_formulas():
    zq = np.array([1.0, 0.0, -1.0])
    zc = np.array([0.0, 0.0, 1.0])
    assert burrows_delta(zq, zc) == pytest.approx(1.0)
    # weights 3/3, 2/3, 1/3 -> (1*1 + 0 + 2*(1/3)) / 2
    assert eder_delta(zq, zc) == pytest.approx((1 + 2 / 3) / 2)
    assert cosine_delta(zq, zq) == pytest.approx(0.0)
    assert cosine_delta(zq, -zq) == pytest.approx(2.0)


def test_preprocess_endpoint():
    text = "Zot pa konnen what they are doing!! \U0001F602\nC'est vraiment pa bon."
    out = client.post("/v1/preprocess", json={"text": text}).json()
    assert out["language"]["cmi"] > 0
    assert out["sentence_count"] == 2
    assert {t["kind"] for t in out["tokens"]} >= {"word", "emoji", "punct"}
    assert out["style_markers"]["emoji_per_100w"] > 0
    norm = out["normalised_text"]
    assert all(norm[t["start"]:t["end"]] == t["text"] for t in out["tokens"])


def test_preprocess_keeps_curly_quote_signal():
    out = client.post("/v1/preprocess", json={"text": "I’m sure it’s fine", "settings": {"include_tokens": False}}).json()
    assert out["style_markers"]["curly_quote_ratio"] == 1.0
    assert "tokens" not in out


def test_engine_token_required_when_configured(monkeypatch):
    monkeypatch.setenv("ENGINE_TOKEN", "s3cret-token")
    assert client.get("/health").status_code == 200  # health stays open
    assert client.get("/v1/info").status_code == 401
    assert client.get("/v1/info", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/v1/info", headers={"Authorization": "Bearer s3cret-token"}).status_code == 200
    monkeypatch.delenv("ENGINE_TOKEN")
    assert client.get("/v1/info").status_code == 200  # no token configured: open (local use)
