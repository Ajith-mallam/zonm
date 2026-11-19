import random

import pytest

# Shared code-mixed vocabulary. Each synthetic author draws from it with their
# own word preferences and punctuation habits, the way real authors share a
# language but differ in how often they use each word.
VOCAB = (
    "mon ou i nou zot sa en bann pe ti pou in ki avek dan lo me si pa annan konman kote kan akoz osi ankor deza "
    "the and to of a in is it that for you was with on are be this have not but they "
    "le la les de et un une est pas que qui dans pour sur avec je il ce "
    "gouvernman lepep larzan travay lakaz zanfan dimoun lapolis people money work house government police"
).split()


def make_author(seed: int):
    rng = random.Random(seed)
    weights = [rng.paretovariate(1.2) for _ in VOCAB]
    endings = rng.choice([[".", "."], ["!", "!!"], ["...", "."], ["?", "."]])
    caps = rng.random() < 0.5
    sent_len = rng.randint(6, 18)

    def write(n_words: int, text_seed: int) -> str:
        r = random.Random(seed * 1000 + text_seed)
        out, words = [], 0
        while words < n_words:
            k = max(3, int(r.gauss(sent_len, 3)))
            sent = r.choices(VOCAB, weights=weights, k=k)
            if caps:
                sent[0] = sent[0].capitalize()
            out.append(" ".join(sent) + r.choice(endings))
            words += k
        return " ".join(out)

    return write


@pytest.fixture(scope="session")
def authors():
    return {name: make_author(seed) for name, seed in (("alpha", 11), ("bravo", 22), ("charlie", 33))}
