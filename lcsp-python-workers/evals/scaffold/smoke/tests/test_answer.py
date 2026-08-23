from pathlib import Path


def test_answer_is_pong():
    assert Path("/app/answer.txt").read_text().strip() == "PONG"
