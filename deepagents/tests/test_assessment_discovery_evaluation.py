from __future__ import annotations

from scripts.evaluate_assessment_discovery import run_evaluation


def test_offline_discovery_evaluation_is_reproducible_and_fail_safe() -> None:
    result = run_evaluation()

    assert result["schemaVersion"] == "LCSP_DISCOVERY_EVAL_RESULT_V1"
    assert result["corpus"] == {
        "path": "evaluation/discovery_scanner_corpus.json",
        "sha256": "sha256:8202b8828d57844ff221c4eb1652b67369aff8df0497a047565a7a50b969e686",
        "caseCount": 13,
    }

    baseline = result["baseline"]
    assert baseline["aiUseCase"]["truePositiveCount"] == 4
    assert baseline["aiUseCase"]["falsePositiveCount"] == 1
    assert baseline["aiUseCase"]["falseNegativeCount"] == 5
    assert baseline["sourceRange"]["falseNegativeCount"] == 9

    discovery = result["discovery"]
    for metric_name in ("aiUseCase", "sourceRange", "ruleRelevantSource"):
        metric = discovery[metric_name]
        assert metric["precision"] == 1.0
        assert metric["recall"] == 1.0
        assert metric["falseNegativeRate"] == 0.0
        assert metric["falsePositives"] == []
        assert metric["falseNegatives"] == []
    assert discovery["classificationCorrect"] == discovery["classificationTotal"] == 10
    assert discovery["classificationAccuracy"] == 1.0

    assert all(result["cacheCorrectness"].values())
    assert baseline["modelCalls"] == discovery["modelCalls"] == 0
    assert baseline["tokens"] == discovery["tokens"] == 0
    assert set(result["unmeasured"]) == {
        "llmInputOutputTokens",
        "questionQuality",
        "evidenceReuseRate",
        "legalAccuracy",
    }
    assert all(not case["invocationFalseNegatives"] for case in result["cases"])
    assert all(not case["invocationFalsePositives"] for case in result["cases"])
