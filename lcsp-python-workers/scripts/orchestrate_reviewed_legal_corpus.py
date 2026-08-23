#!/usr/bin/env python3
"""Fail-closed orchestration for an approved reviewed corpus.

The builder remains responsible for producing an ingest payload. This script is
responsible for the post-review lifecycle only:

reviewed text + hierarchy APPROVED -> ingest DRAFT -> build/validate retrieval
index -> approve corpus.

`reviewedBy` and the authenticated approval actor are independent technical
audit principals. The reviewed artefacts prove what content was reviewed; the
API token proves who is authorized to execute the lifecycle action. Neither is
a legal signature. The API re-validates the explicit identity policy carried by
this sign-off before allowing those principals to differ.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import httpx

from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever


APPROVED = "APPROVED"
REVIEW_IDENTITY_POLICY = "TECHNICAL_AUDIT_PRINCIPALS_INDEPENDENT"


class ReviewGateError(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def _required_string(values: dict[str, Any], key: str, *, source: str) -> str:
    value = values.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ReviewGateError(f"{source} is missing {key}")
    return value.strip()


def build_review_signoff(
    payload: dict[str, Any],
    *,
    reviewed_dir: Path,
) -> dict[str, Any]:
    documents = payload.get("documents")
    if not isinstance(documents, list) or not documents:
        raise ReviewGateError("Corpus payload has no documents")

    source_manifest = payload.get("sourceManifest")
    source_artifacts = (
        source_manifest.get("sourceArtifacts")
        if isinstance(source_manifest, dict)
        else None
    )
    source_artifacts_by_document = {
        str(item.get("documentId")): item
        for item in source_artifacts or []
        if isinstance(item, dict) and isinstance(item.get("documentId"), str)
    }
    signoffs: list[dict[str, Any]] = []
    reviewers: set[str] = set()

    for document in documents:
        if not isinstance(document, dict):
            raise ReviewGateError("Corpus payload contains an invalid document")
        document_id = _required_string(document, "documentId", source="document")
        reviewed_text = reviewed_dir / f"{document_id}.reviewed.txt"
        hierarchy_review = reviewed_dir / f"{document_id}.hierarchy-review.json"
        if not reviewed_text.is_file():
            raise ReviewGateError(f"Missing reviewed text: {reviewed_text}")
        if not hierarchy_review.is_file():
            raise ReviewGateError(f"Missing hierarchy review: {hierarchy_review}")

        try:
            review = json.loads(hierarchy_review.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ReviewGateError(
                f"Invalid hierarchy review JSON: {hierarchy_review}"
            ) from error
        if not isinstance(review, dict):
            raise ReviewGateError(
                f"Hierarchy review must be an object: {hierarchy_review}"
            )

        reviewed_document_id = _required_string(
            review, "documentId", source=hierarchy_review.name
        )
        if reviewed_document_id != document_id:
            raise ReviewGateError(
                f"Hierarchy review documentId mismatch for {document_id}"
            )
        review_state = _required_string(
            review, "reviewState", source=hierarchy_review.name
        )
        if review_state != APPROVED:
            raise ReviewGateError(
                f"{hierarchy_review.name} reviewState must be APPROVED"
            )
        reviewed_by = _required_string(
            review, "reviewedBy", source=hierarchy_review.name
        )
        reviewers.add(reviewed_by)

        actual_reviewed_text_sha = sha256_file(reviewed_text)
        declared_reviewed_text_sha = _required_string(
            review, "reviewedTextSha256", source=hierarchy_review.name
        )
        if declared_reviewed_text_sha != actual_reviewed_text_sha:
            raise ReviewGateError(
                f"Reviewed text hash mismatch for {document_id}"
            )

        reviewed_source_sha = _required_string(
            review, "reviewedSourceSha256", source=hierarchy_review.name
        )
        payload_source_sha = _required_string(
            document, "sourceSha256", source=f"payload document {document_id}"
        )
        if reviewed_source_sha != payload_source_sha:
            artifact = source_artifacts_by_document.get(document_id)
            fallback = artifact.get("sourceSnapshotFallback") if artifact else None
            if (
                not isinstance(artifact, dict)
                or not isinstance(fallback, dict)
                or artifact.get("declaredReviewedSourceSha256") != reviewed_source_sha
                or artifact.get("reviewedSourceSha256") != payload_source_sha
            ):
                raise ReviewGateError(
                    f"Reviewed source hash mismatch for {document_id}"
                )

        signoff_document: dict[str, Any] = {
            "documentId": document_id,
            "reviewState": review_state,
            "reviewedBy": reviewed_by,
            "reviewedAt": _required_string(
                review, "reviewedAt", source=hierarchy_review.name
            ),
            "reviewedSourceSha256": payload_source_sha,
            "reviewedTextSha256": actual_reviewed_text_sha,
            "hierarchyReviewSha256": sha256_file(hierarchy_review),
        }
        if reviewed_source_sha != payload_source_sha:
            signoff_document["declaredReviewedSourceSha256"] = reviewed_source_sha
            signoff_document["sourceSnapshotFallback"] = source_artifacts_by_document[
                document_id
            ]["sourceSnapshotFallback"]
        signoffs.append(signoff_document)

    if len(reviewers) != 1:
        raise ReviewGateError(
            "All corpus documents must currently share one review-gate principal for automatic orchestration"
        )

    return {
        "state": APPROVED,
        "reviewedBy": next(iter(reviewers)),
        "identityPolicy": REVIEW_IDENTITY_POLICY,
        "approvalActorMayDiffer": True,
        "documents": signoffs,
    }


def enrich_payload_with_signoff(
    payload: dict[str, Any], signoff: dict[str, Any]
) -> dict[str, Any]:
    enriched = dict(payload)
    source_manifest = dict(enriched.get("sourceManifest") or {})
    warnings = source_manifest.get("normalizationWarnings") or []
    if not isinstance(warnings, list):
        raise ReviewGateError("sourceManifest.normalizationWarnings must be a list")
    if warnings:
        raise ReviewGateError(
            "Normalization warnings must be resolved before automatic ingestion"
        )
    source_manifest["reviewRequired"] = True
    source_manifest["reviewSignoff"] = signoff
    enriched["sourceManifest"] = source_manifest
    return enriched


def _unwrap_response(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError as error:
        raise ReviewGateError(
            f"API returned non-JSON response ({response.status_code})"
        ) from error
    if response.status_code >= 400:
        raise ReviewGateError(
            f"API request failed ({response.status_code}): {body}"
        )
    if isinstance(body, dict) and body.get("ok") is True:
        data = body.get("data")
        if isinstance(data, dict):
            return data
    if not isinstance(body, dict):
        raise ReviewGateError("API response payload was invalid")
    return body


def _post(
    client: httpx.Client,
    base_url: str,
    path: str,
    payload: dict[str, Any],
    token: str,
) -> dict[str, Any]:
    response = client.post(
        f"{base_url.rstrip('/')}{path}",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    return _unwrap_response(response)


def validate_retrieval_index(
    corpus_version_id: str,
    payload: dict[str, Any],
    *,
    chroma_path: str | None,
) -> None:
    chunks = [
        chunk
        for document in payload.get("documents") or []
        if isinstance(document, dict)
        for chunk in document.get("chunks") or []
        if isinstance(chunk, dict)
    ]
    if not chunks:
        raise ReviewGateError("Corpus payload has no chunks to index")

    retriever = ChromaDbCitationRetriever(chroma_path)
    retriever.index_corpus(corpus_version_id, chunks)
    expected_ids = {str(chunk.get("id") or "") for chunk in chunks}
    if "" in expected_ids:
        raise ReviewGateError("Corpus payload contains a chunk without a stable ID")
    retrieved = retriever.retrieve_exact(corpus_version_id, list(expected_ids))
    primary_ids = {
        chunk.id for chunk in retrieved if chunk.role == "PRIMARY_MATCH"
    }
    if primary_ids != expected_ids:
        missing = sorted(expected_ids - primary_ids)
        raise ReviewGateError(
            f"Retrieval index validation failed; missing chunk IDs: {missing}"
        )


def orchestrate(
    *,
    payload_path: Path,
    reviewed_dir: Path,
    api_base_url: str,
    operator_token: str,
    chroma_path: str | None,
    dry_run: bool,
) -> dict[str, Any]:
    try:
        payload = json.loads(payload_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ReviewGateError(f"Invalid corpus payload JSON: {payload_path}") from error
    if not isinstance(payload, dict):
        raise ReviewGateError("Corpus payload must be a JSON object")

    signoff = build_review_signoff(payload, reviewed_dir=reviewed_dir)
    enriched_payload = enrich_payload_with_signoff(payload, signoff)

    if dry_run:
        return {
            "status": "VALIDATED",
            "reviewedBy": signoff["reviewedBy"],
            "identityPolicy": signoff["identityPolicy"],
            "documentCount": len(signoff["documents"]),
        }
    if not operator_token:
        raise ReviewGateError("LEGAL_OPERATOR_BEARER_TOKEN is required")

    with httpx.Client(timeout=60.0) as client:
        draft = _post(
            client,
            api_base_url,
            "/internal/legal-rule-catalog/corpus",
            enriched_payload,
            operator_token,
        )
        corpus_id = _required_string(draft, "id", source="corpus ingest response")
        if str(draft.get("status") or "") != "DRAFT":
            raise ReviewGateError("Corpus ingest did not return DRAFT status")

        validate_retrieval_index(
            corpus_id,
            enriched_payload,
            chroma_path=chroma_path,
        )

        approved = _post(
            client,
            api_base_url,
            f"/internal/legal-rule-catalog/corpus/{corpus_id}/approve",
            {
                "scopeDescription": "Automatic approval after reviewed-text, hierarchy and retrieval-index validation",
                "comments": "Review audit principal and lifecycle approval actor are independently authenticated technical principals",
            },
            operator_token,
        )
        if str(approved.get("status") or "") != APPROVED:
            raise ReviewGateError("Corpus approval did not return APPROVED status")
        return approved


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--payload", required=True, type=Path)
    parser.add_argument("--reviewed-dir", required=True, type=Path)
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("NESTJS_API_BASE_URL", "http://127.0.0.1:4000"),
    )
    parser.add_argument(
        "--operator-token",
        default=os.getenv("LEGAL_OPERATOR_BEARER_TOKEN", ""),
        help="Authenticated principal holding legal-corpus ingest/approve PBAC actions. It need not equal reviewedBy.",
    )
    parser.add_argument(
        "--chroma-path",
        default=os.getenv("LEGAL_CHROMA_PATH"),
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = orchestrate(
        payload_path=args.payload,
        reviewed_dir=args.reviewed_dir,
        api_base_url=args.api_base_url,
        operator_token=args.operator_token,
        chroma_path=args.chroma_path,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
