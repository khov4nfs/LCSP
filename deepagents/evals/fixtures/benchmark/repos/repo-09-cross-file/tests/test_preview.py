"""Test double with an AI-like method name and no provider dependency."""


class LocalResponses:
    def create(self, *, model, input):
        return {"model": model, "echo": input}


def test_preview_double():
    assert LocalResponses().create(model="fake", input="demo")["echo"] == "demo"
