import json
from pathlib import Path

from decision.eval import DEFAULT_DATASET, evaluate_dataset


def test_offline_decision_eval_reports_per_model_and_blocks_activation():
    report = evaluate_dataset(DEFAULT_DATASET)

    assert report["schemaVersion"] == "LCSP_JEV_DECISION_EVAL_REPORT_V1"
    assert report["dataset"]["hash"].startswith("sha256:")
    assert report["dataset"]["recordCount"] == 5
    assert "jev-2026-09-22.eval" in report["models"]
    model = report["models"]["jev-2026-09-22.eval"]
    assert model["agreementAccuracy"] == 1.0
    assert model["performance"]["removedGenerativeCalls"] == 5
    assert model["fallbackRate"] == 0.0
    assert report["policy"]["defaultMode"] == "SHADOW"
    assert report["policy"]["passed"] is False
    assert report["policy"]["recommendation"] == "DO_NOT_PROMOTE"
    investigator = report["perDecision"]["INVESTIGATOR_NEXT_ACTION"]["models"][
        "jev-2026-09-22.eval"
    ]
    assert investigator["agreementAccuracy"] == 1.0
    assert investigator["highRiskFalseNegativeRate"] == 0.0
    assert investigator["safetyQuestionCount"] == 1
    assert investigator["questionMetrics"]["next_action"]["accuracy"] == 1.0
    assert investigator["requirements"]["sufficientEvalSampleSize"] is False
    assert investigator["requirements"]["acceptableCalibrationPassed"] is False
    assert investigator["activationEvidence"]["modelVersion"] == "jev-2026-09-22.eval"
    pr_review = report["perDecision"]["PR_REVIEW_TRIAGE"]["models"][
        "jev-2026-09-22.eval"
    ]
    assert pr_review["safetyQuestionCount"] == 5
    assert pr_review["questionMetrics"]["affected_domain"]["accuracy"] == 1.0
    assert pr_review["questionMetrics"]["needs_deep_review"]["recall"] == 1.0
    assert (
        pr_review["activationEvidence"]["safetyQuestionMetrics"]["needs_deep_review"][
            "falseNegativeRate"
        ]
        == 0.0
    )
    planner = report["perDecision"]["PLANNER_CANDIDATE_RANKING"]["models"][
        "jev-2026-09-22.eval"
    ]
    assert planner["rankingMetrics"]["meanReciprocalRank"] == 1.0
    assert planner["rankingMetrics"]["ndcg"] == 1.0


def test_offline_decision_eval_report_is_machine_readable_json():
    report = evaluate_dataset(DEFAULT_DATASET)
    encoded = json.dumps(report, sort_keys=True)

    decoded = json.loads(encoded)
    assert decoded["perDecision"]["INVESTIGATOR_NEXT_ACTION"]["activationMode"] == "SHADOW"
    assert "FINAL_READINESS" in decoded["policy"]["permanentExclusions"]


def test_secondary_safety_false_negative_blocks_activation_evidence(tmp_path: Path):
    dataset = json.loads(DEFAULT_DATASET.read_text(encoding="utf-8"))
    pr_record = next(
        item
        for item in dataset["records"]
        if item["decision_class"] == "PR_REVIEW_TRIAGE"
    )
    for decision in pr_record["captured_response"]["decisions"]:
        if decision["questionId"] == "needs_deep_review":
            decision["noul"] = {"value": False, "reason_code": "NO"}
            decision["probability"] = 0.91
            decision["confidence"] = 0.91
            break
    path = tmp_path / "jev-decision-eval-secondary-fn.json"
    path.write_text(json.dumps(dataset), encoding="utf-8")

    report = evaluate_dataset(path)
    pr_review = report["perDecision"]["PR_REVIEW_TRIAGE"]["models"][
        "jev-2026-09-22.eval"
    ]

    assert pr_review["questionMetrics"]["affected_domain"]["accuracy"] == 1.0
    assert pr_review["questionMetrics"]["needs_deep_review"]["accuracy"] == 0.0
    assert pr_review["questionMetrics"]["needs_deep_review"]["falseNegativeRate"] == 1.0
    assert pr_review["highRiskFalseNegativeRate"] > 0
    assert pr_review["requirements"]["boundedFalseNegativeRatePassed"] is False
    blocked = next(
        item
        for item in report["policy"]["blockedDecisionTypes"]
        if item["decisionType"] == "PR_REVIEW_TRIAGE"
    )
    assert "boundedFalseNegativeRatePassed" in blocked["missing"]
