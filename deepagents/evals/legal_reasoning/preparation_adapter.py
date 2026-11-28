"""Reuse LCSP-402's frozen Preparation gate; never execute a model or create gold."""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path

from evals.legal_reasoning.scorer import score_dataset
from evals.legal_reasoning.validation import PACKAGE_ROOT, load_dataset
from evals.policy_baseline import _load_legal_context
from evals.run_manifest import stable_hash
from rule_set_preparation.reviewed_eval_gate import reviewed_eval_preflight


def integrate_preparation_artifacts(
    *,
    output_path: Path | None,
    manifest_path: Path | None,
    gold_path: Path | None,
    approved_gold_sha256: str | None,
    expected_output_sha256: str | None,
    annotations_path: Path | None = None,
    judgments_path: Path | None = None,
    rubric_path: Path | None = None,
    source_graph_path: Path | None = None,
) -> dict:
    """Business purpose: Import frozen source-pinned Preparation evidence through LCSP-402's own gate.

    Business rules:
    - Preparation output and independently approved gold are distinct input files.
    - Actual output bytes must match an externally supplied frozen output digest and its signed manifest.
    - The shared P15 scorer consumes independent annotations and output-bound human judgments.
    - LCSP-402 preflight validates its legacy artifact metadata only; no legacy scope filter runs.
    - Corpus/document hashes must match the official Vietnamese package; stage is always Preparation.
    - Structural receipt checks do not authenticate a reviewer or prove a live model invocation.

    Execution flow:
    1. Report absent frozen artifacts without fabricating execution or labels.
    2. Hash and decode exact bytes, check official source bindings and invoke the existing review preflight.
    3. Bind each reviewed claim judgment to exact manifest/output/claim bytes, then call the shared scorer.

    Failure cases:
    - Absent artifacts, changed output/source/manifest or unapproved gold yield NOT_SCORED with blockers.

    Side effects:
    - Reads explicit local artifacts only; no network, model execution or production writes.
    """
    report = {
        "integrationVersion": "LCSP-400-PREPARATION-ARTIFACT-V1",
        "evaluationTarget": "RULE_SET_PREPARATION_OUTPUT",
        "stage": "RULE_SET_PREPARATION",
        "scoringStatus": "NOT_SCORED",
        "reviewAuthenticityStatus": "NOT_AUTHENTICATED_BY_TOOL",
        "verifiedSemanticMetrics": False,
        "blockingReasons": [],
        "inputProvenance": {},
    }
    paths = {"output": output_path, "manifest": manifest_path, "gold": gold_path}
    raw, values = {}, {}
    for name, path in paths.items():
        if path is None or not path.is_file():
            report["blockingReasons"].append(
                f"FROZEN_PREPARATION_{name.upper()}_REQUIRED"
            )
        else:
            raw[name] = path.read_bytes()
            report["inputProvenance"][name + "Sha256"] = sha256(raw[name]).hexdigest()
            values[name] = json.loads(raw[name])
    if report["blockingReasons"]:
        return report
    if report["inputProvenance"]["outputSha256"] != expected_output_sha256:
        report["blockingReasons"].append("FROZEN_PREPARATION_OUTPUT_DIGEST_MISMATCH")
    manifest, candidate, gold = values["manifest"], values["output"], values["gold"]
    official = json.loads(
        (PACKAGE_ROOT / "source-pins.vn-ai.v1.json").read_text(encoding="utf-8")
    )
    pins = manifest.get("sourcePins", {})
    if pins.get("legalCorpusDigestSha256") != official["officialCorpus"][
        "corpusDigestSha256"
    ] or pins.get("legalSourceDocumentSha256") not in {
        row["pdfSha256"] for row in official["sources"]
    }:
        report["blockingReasons"].append(
            "FROZEN_PREPARATION_OFFICIAL_VN_SOURCE_BINDING_REQUIRED"
        )
    report["blockingReasons"].extend(
        reviewed_eval_preflight(
            gold,
            raw["gold"],
            candidate,
            manifest,
            approved_gold_sha256,
        )
    )
    if report["blockingReasons"]:
        return report
    if annotations_path is None or judgments_path is None or rubric_path is None:
        report["blockingReasons"].append(
            "PREPARATION_P15_ANNOTATIONS_JUDGMENTS_RUBRIC_REQUIRED"
        )
        return report
    annotations = load_dataset(annotations_path)
    if any(
        row.get("stage") != "RULE_SET_PREPARATION"
        or row.get("evaluationTarget") != "RULE_SET_PREPARATION_OUTPUT"
        for row in annotations
    ):
        raise ValueError("PREPARATION_P15_TARGET_MISMATCH")
    predictions = json.loads(judgments_path.read_text(encoding="utf-8"))
    if source_graph_path is None or not source_graph_path.is_file():
        report["blockingReasons"].append("PREPARATION_PINNED_SOURCE_GRAPH_REQUIRED")
        return report
    source_graph_bytes = source_graph_path.read_bytes()
    report["inputProvenance"]["sourceGraphSha256"] = sha256(
        source_graph_bytes
    ).hexdigest()
    if pins.get("sourceGraphSha256") != report["inputProvenance"]["sourceGraphSha256"]:
        raise ValueError("PREPARATION_PINNED_SOURCE_GRAPH_DIGEST_MISMATCH")
    source_graph = json.loads(source_graph_bytes)
    if source_graph.get("legalSourceVersionId") != pins["legalSourceVersionId"]:
        raise ValueError("PREPARATION_PINNED_SOURCE_GRAPH_VERSION_MISMATCH")
    nodes = {node["nodeId"]: node for node in source_graph.get("nodes", [])}
    original_context, _ = _load_legal_context()
    claims = {
        row["claimId"]: row
        for row in candidate.get("semanticGraph", {}).get("claims", [])
    }
    for row in predictions.get("casePredictions", []):
        binding = row.get("targetBinding", {})
        claim = claims.get(binding.get("claimId"))
        if (
            claim is None
            or binding.get("bindingKind") != "RULE_SET_PREPARATION_OUTPUT"
            or binding.get("manifestSha256") != manifest["manifestSha256"]
            or binding.get("outputSha256") != expected_output_sha256
            or binding.get("claimSha256") != stable_hash(claim)
            or binding.get("runId") != manifest["runId"]
            or binding.get("sourceVersion") != pins["legalSourceVersionId"]
            or binding.get("instructionBundleDigest")
            != manifest.get("instructionBundle", {}).get("enRuntimeBundleDigest")
            or binding.get("skillVersionDigest")
            != stable_hash(
                {
                    "available": manifest.get("availableSkillsSha256", {}),
                    "selected": manifest.get("selectedSkillsSha256", {}),
                }
            )
        ):
            raise ValueError("PREPARATION_P15_OUTPUT_CLAIM_BINDING_MISMATCH")
        annotation = next(
            (r for r in annotations if r["caseId"] == row["caseId"]), None
        )
        if (
            annotation is None
            or binding.get("sourceId") != annotation["legalSource"]["sourceId"]
            or binding.get("sourceVersion")
            != annotation["legalSource"]["sourceVersion"]
            or binding.get("provisionRefs")
            != annotation["legalSource"]["provisionRefs"]
        ):
            raise ValueError("PREPARATION_P15_ANNOTATION_SOURCE_MISMATCH")
        source = next(
            (
                item
                for item in official["sources"]
                if item["sourceId"] == binding["sourceId"]
            ),
            None,
        )
        if source is None or source["documentNumber"] not in binding["sourceVersion"]:
            raise ValueError("PREPARATION_P15_CLAIM_PROVISION_MISMATCH")
        claim_nodes = claim.get("sourceNodeIds")
        if (
            not isinstance(claim_nodes, list)
            or not claim_nodes
            or len(claim_nodes) != len(set(claim_nodes))
        ):
            raise ValueError("PREPARATION_P15_CLAIM_PROVISION_MISMATCH")
        for node_id in claim_nodes:
            node = nodes.get(node_id)
            if node is None or node.get("documentId") != source["documentNumber"]:
                raise ValueError("PREPARATION_P15_CLAIM_PROVISION_MISMATCH")
            lineage = []
            seen = set()
            while node is not None:
                if node["nodeId"] in seen:
                    raise ValueError("PREPARATION_P15_SOURCE_GRAPH_CYCLE")
                seen.add(node["nodeId"])
                lineage.append(node)
                node = nodes.get(node.get("parentNodeId"))
            article = next(
                (item for item in lineage if item.get("nodeType") == "ARTICLE"), None
            )
            ref = f"article-{article['label']}" if article else None
            if ref not in binding["provisionRefs"] or ref not in source["provisions"]:
                raise ValueError("PREPARATION_P15_CLAIM_PROVISION_MISMATCH")
            original = original_context.get(
                ("law-" if source["documentNumber"] == "134-2025-QH15" else "decree-")
                + str(article["label"])
            )
            content = lineage[0].get("content", "")
            if (
                original is None
                or not content
                or content not in original.content
                or original.content_sha256 != source["provisions"][ref]["contentSha256"]
            ):
                raise ValueError("PREPARATION_P15_CLAIM_PROVISION_MISMATCH")
        for key, value in binding.items():
            if key not in {"bindingKind", "candidateCaseId"}:
                row[key] = value
    rubric = json.loads(rubric_path.read_text(encoding="utf-8"))
    report["rubricReport"] = score_dataset(annotations, predictions, rubric, official)
    report["scoringStatus"] = report["rubricReport"]["scoringStatus"]
    report["artifactClassification"] = (
        "FROZEN_PREPARATION_BYTES_REVIEW_AUTHENTICITY_UNVERIFIED"
    )

    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-artifact", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--gold", type=Path)
    parser.add_argument("--approved-gold-sha256")
    parser.add_argument("--expected-output-sha256")
    parser.add_argument("--annotations", type=Path)
    parser.add_argument("--judgments", type=Path)
    parser.add_argument("--rubric", type=Path)
    parser.add_argument("--source-graph", type=Path)
    args = parser.parse_args()
    print(
        json.dumps(
            integrate_preparation_artifacts(
                output_path=args.output_artifact,
                manifest_path=args.manifest,
                gold_path=args.gold,
                approved_gold_sha256=args.approved_gold_sha256,
                expected_output_sha256=args.expected_output_sha256,
                annotations_path=args.annotations,
                judgments_path=args.judgments,
                rubric_path=args.rubric,
                source_graph_path=args.source_graph,
            ),
            indent=2,
        )
    )
