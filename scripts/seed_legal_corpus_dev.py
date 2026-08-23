#!/usr/bin/env python3
"""Seed the checked-in Vietnamese legal corpus into a local development runtime.

This command is intentionally DEVELOPMENT ONLY. It does not replace the normal
review/PBAC/API activation lifecycle used outside local development. The seed
loads the deterministic checked-in ingest artefacts, applies the known Law 134
repeal effects to Law 71, validates every chunk hash, persists one APPROVED local
LegalCorpusVersion plus a VALID vectorless retrieval-index record, and builds the
exact Chroma collection used by LCSP legal retrieval/EngineeringRule runtime.

The command refuses non-local PostgreSQL targets unless the caller explicitly
sets LCSP_DEV_SEED_ALLOW_REMOTE=true. It also refuses NODE_ENV=production.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import uuid
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import find_dotenv, load_dotenv

from lcsp_workers.legal.normative_chunk_filter import (
    legal_chunk_normative_class,
    is_legal_database_chunk,
)


SEED_VERSION = "legal-corpus-dev-seed/1.0.0"
DEFAULT_CORPUS_VERSION = "VN-LEGAL-2026-08"
DEFAULT_PAYLOADS = (
    Path("reports/legal-corpus-source/LAW-71-2025-QH15.ingest.json"),
    Path("reports/legal-corpus-source/LAW-134-2025-QH15.ingest.json"),
)
LOCAL_DB_HOSTS = {"127.0.0.1", "localhost", "::1"}
LAW_71_DOCUMENT_ID = "LAW-71-2025-QH15"
REPEALED_LAW_71_PREFIXES = (
    "art-3::cl-9",
    "art-4::cl-7",
    "art-12::cl-6",
    "art-34::cl-2::pt-đ",
    "art-41",
    "art-42",
    "art-43",
    "art-44",
    "art-45",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-version", default=DEFAULT_CORPUS_VERSION)
    parser.add_argument("--env-file", default=None)
    parser.add_argument("--chroma-path", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def sha256_text(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def read_payload(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Missing legal corpus payload: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid legal corpus JSON: {path}") from error
    if not isinstance(payload, dict):
        raise SystemExit(f"Legal corpus payload must be an object: {path}")
    return payload


def is_repealed_law_71_locator(locator: str) -> bool:
    return any(
        locator == prefix or locator.startswith(f"{prefix}::")
        for prefix in REPEALED_LAW_71_PREFIXES
    )


def merge_and_validate_payloads(
    payload_paths: tuple[Path, ...], corpus_version: str
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    source_artifacts: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []
    seen_documents: set[str] = set()
    seen_chunks: set[str] = set()

    for path in payload_paths:
        payload = read_payload(path)
        if str(payload.get("version") or "") != corpus_version:
            raise SystemExit(
                f"Corpus version mismatch in {path}: "
                f"expected={corpus_version} actual={payload.get('version')}"
            )

        source_manifest = payload.get("sourceManifest")
        if not isinstance(source_manifest, dict):
            raise SystemExit(f"Missing sourceManifest in {path}")
        warnings = source_manifest.get("normalizationWarnings") or []
        if not isinstance(warnings, list) or warnings:
            raise SystemExit(f"Unresolved normalization warnings in {path}: {warnings}")
        artifacts = source_manifest.get("sourceArtifacts") or []
        if not isinstance(artifacts, list):
            raise SystemExit(f"sourceManifest.sourceArtifacts must be a list in {path}")
        source_artifacts.extend(dict(item) for item in artifacts if isinstance(item, dict))

        raw_documents = payload.get("documents")
        if not isinstance(raw_documents, list) or not raw_documents:
            raise SystemExit(f"No legal documents in {path}")

        for raw_document in raw_documents:
            if not isinstance(raw_document, dict):
                raise SystemExit(f"Invalid legal document in {path}")
            document = dict(raw_document)
            document_id = str(document.get("documentId") or "").strip()
            if not document_id or document_id in seen_documents:
                raise SystemExit(f"Duplicate/empty documentId in {path}: {document_id!r}")
            seen_documents.add(document_id)

            source_sha = str(document.get("sourceSha256") or "")
            if not source_sha.startswith("sha256:") or len(source_sha) != 71:
                raise SystemExit(f"Invalid sourceSha256 for {document_id}")

            chunks = document.get("chunks")
            if not isinstance(chunks, list) or not chunks:
                raise SystemExit(f"No chunks for {document_id}")

            normalized_chunks: list[dict[str, Any]] = []
            excluded_chunk_count = 0
            for raw_chunk in chunks:
                if not isinstance(raw_chunk, dict):
                    raise SystemExit(f"Invalid chunk in {document_id}")
                chunk = dict(raw_chunk)
                chunk_id = str(chunk.get("id") or "").strip()
                locator = str(chunk.get("locator") or "").strip()
                content = str(chunk.get("content") or "")
                content_sha = str(chunk.get("contentSha256") or "")
                if not chunk_id or chunk_id in seen_chunks:
                    raise SystemExit(f"Duplicate/empty chunk id: {chunk_id!r}")
                if not locator or not content:
                    raise SystemExit(f"Chunk missing locator/content: {chunk_id}")
                if sha256_text(content) != content_sha:
                    raise SystemExit(f"Chunk hash mismatch: {chunk_id}")
                seen_chunks.add(chunk_id)

                if document_id == LAW_71_DOCUMENT_ID and is_repealed_law_71_locator(locator):
                    chunk["legalStatus"] = "REPEALED"
                else:
                    chunk["legalStatus"] = str(chunk.get("legalStatus") or "ACTIVE")

                # Chroma exact-context metadata requires the owning document ID.
                chunk["documentId"] = document_id
                chunk["normativeClass"] = legal_chunk_normative_class(chunk)
                if not is_legal_database_chunk(chunk):
                    excluded_chunk_count += 1
                    continue
                hierarchy = (
                    dict(chunk.get("hierarchy") or {})
                    if isinstance(chunk.get("hierarchy"), dict)
                    else {}
                )
                hierarchy["normativeClass"] = chunk["normativeClass"]
                chunk["hierarchy"] = hierarchy
                normalized_chunks.append(chunk)

            if not normalized_chunks:
                raise SystemExit(
                    f"No database-eligible legal chunks remain for {document_id}"
                )
            document["excludedChunkCount"] = excluded_chunk_count
            document["chunks"] = normalized_chunks
            documents.append(document)

    manifest = {
        "reviewRequired": True,
        "normalizationWarnings": [],
        "sourceArtifacts": source_artifacts,
        "developmentSeed": {
            "seedVersion": SEED_VERSION,
            "corpusVersion": corpus_version,
            "sourceFiles": [str(path) for path in payload_paths],
            "governance": "DEVELOPMENT_ONLY_DIRECT_SEED_NOT_PRODUCTION_APPROVAL",
            "chunkSelectionPolicy": (
                "Persist only hierarchy-addressable legal chunks; exclude formal "
                "headers/preamble. Mark context-only chunks separately from "
                "EngineeringRule source candidates."
            ),
        },
    }

    content_projection = [
        {
            "documentId": document["documentId"],
            "sourceSha256": document["sourceSha256"],
            "chunks": [
                {
                    "id": chunk["id"],
                    "contentSha256": chunk["contentSha256"],
                    "legalStatus": chunk["legalStatus"],
                }
                for chunk in document["chunks"]
            ],
        }
        for document in documents
    ]
    content_hash = canonical_sha256(content_projection)
    manifest["developmentSeed"]["contentHash"] = content_hash
    return manifest, documents, content_hash


def psycopg_connection_info(database_url: str) -> tuple[str, str | None, str]:
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SystemExit("DATABASE_URL must be a PostgreSQL URL for development legal seed")

    schema = None
    kept: list[tuple[str, str]] = []
    prisma_only = {
        "schema",
        "connection_limit",
        "pool_timeout",
        "socket_timeout",
        "pgbouncer",
    }
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == "schema":
            schema = value.strip() or None
            continue
        if key in prisma_only:
            continue
        kept.append((key, value))

    sanitized = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(kept), parsed.fragment)
    )
    return sanitized, schema, parsed.hostname or ""


def bool_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def assert_development_target(host: str) -> None:
    if os.getenv("NODE_ENV", "").strip().lower() == "production":
        raise SystemExit("Refusing development legal seed with NODE_ENV=production")
    if host not in LOCAL_DB_HOSTS and not bool_env("LCSP_DEV_SEED_ALLOW_REMOTE"):
        raise SystemExit(
            f"Refusing non-local PostgreSQL target {host!r}. "
            "Set LCSP_DEV_SEED_ALLOW_REMOTE=true only for an explicitly isolated dev database."
        )


def json_value(value: Any):
    from psycopg.types.json import Jsonb

    return Jsonb(value)


def seed_database_and_index(
    *,
    db_url: str,
    schema: str | None,
    corpus_version: str,
    source_manifest: dict[str, Any],
    documents: list[dict[str, Any]],
    content_hash: str,
    chroma_path: str | None,
) -> dict[str, Any]:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever

    corpus_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    digest = content_hash.removeprefix("sha256:")
    integrity_ref = f"dev-seed:{digest}"
    retrieval_ref = f"dev-index:{digest}"
    retrieval_version = f"{corpus_version}:dev-vectorless-v1"
    config_hash = sha256_text("lcsp-vectorless-legal-retrieval:dev-seed:v1")
    all_chunks = [chunk for document in documents for chunk in document["chunks"]]

    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        if schema:
            with conn.cursor() as cursor:
                cursor.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))

        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT "id","status"::text AS status,"sourceManifest" '
                'FROM "LegalCorpusVersion" WHERE "version"=%s LIMIT 1',
                (corpus_version,),
            )
            existing = cursor.fetchone()
            if existing:
                manifest = existing["sourceManifest"] or {}
                if isinstance(manifest, str):
                    manifest = json.loads(manifest)
                seeded = manifest.get("developmentSeed") if isinstance(manifest, dict) else None
                existing_hash = seeded.get("contentHash") if isinstance(seeded, dict) else None
                if existing_hash != content_hash or existing["status"] != "APPROVED":
                    raise SystemExit(
                        f"Corpus version {corpus_version} already exists and is not the same approved dev seed. "
                        "Refusing to overwrite governed/local state."
                    )
                corpus_id = str(existing["id"])
                retriever = ChromaDbCitationRetriever(chroma_path)
                retriever.index_corpus(corpus_id, all_chunks)
                retrieved = retriever.retrieve_exact(corpus_id, [str(chunk["id"]) for chunk in all_chunks])
                if {item.id for item in retrieved} != {str(chunk["id"]) for chunk in all_chunks}:
                    raise SystemExit("Existing dev corpus Chroma index validation failed")
                return {
                    "status": "ALREADY_SEEDED",
                    "corpusVersionId": corpus_id,
                    "version": corpus_version,
                    "documentCount": len(documents),
                    "chunkCount": len(all_chunks),
                    "contentHash": content_hash,
                }

            cursor.execute(
                'UPDATE "LegalCorpusVersion" '
                'SET "status"=\'SUPERSEDED\'::"LegalRuleLifecycleStatus" '
                'WHERE "status"=\'APPROVED\'::"LegalRuleLifecycleStatus"'
            )
            cursor.execute(
                'INSERT INTO "LegalCorpusVersion" '
                '("id","version","status","sourceManifest","integrityManifestRef","approvedAt") '
                'VALUES (%s,%s,\'APPROVED\'::"LegalRuleLifecycleStatus",%s,%s,%s)',
                (
                    corpus_id,
                    corpus_version,
                    json_value(source_manifest),
                    integrity_ref,
                    now,
                ),
            )

            for document in documents:
                source_document_id = str(uuid.uuid4())
                cursor.execute(
                    'INSERT INTO "LegalSourceDocument" '
                    '("id","legalCorpusVersionId","documentId","title","sourceUrl",'
                    '"sourceSha256","effectiveDate","sourceEffectStatus","snapshotPath") '
                    'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                    (
                        source_document_id,
                        corpus_id,
                        document["documentId"],
                        document["title"],
                        document["sourceUrl"],
                        document["sourceSha256"],
                        document.get("effectiveDate"),
                        document.get("sourceEffectStatus") or "UNKNOWN",
                        document.get("snapshotPath"),
                    ),
                )
                for chunk in document["chunks"]:
                    cursor.execute(
                        'INSERT INTO "LegalDocumentChunk" '
                        '("id","legalCorpusVersionId","legalSourceDocumentId","documentId",'
                        '"locator","content","contentSha256","hierarchy","legalStatus","pageStart","pageEnd") '
                        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (
                            chunk["id"],
                            corpus_id,
                            source_document_id,
                            document["documentId"],
                            chunk["locator"],
                            chunk["content"],
                            chunk["contentSha256"],
                            json_value(chunk.get("hierarchy") or {}),
                            chunk["legalStatus"],
                            chunk.get("pageStart"),
                            chunk.get("pageEnd"),
                        ),
                    )

            retriever = ChromaDbCitationRetriever(chroma_path)
            retriever.index_corpus(corpus_id, all_chunks)
            expected_ids = {str(chunk["id"]) for chunk in all_chunks}
            retrieved = retriever.retrieve_exact(corpus_id, sorted(expected_ids))
            retrieved_ids = {item.id for item in retrieved}
            if retrieved_ids != expected_ids:
                missing = sorted(expected_ids - retrieved_ids)
                raise SystemExit(f"Chroma exact-index validation failed; missing={missing[:20]}")

            cursor.execute(
                'INSERT INTO "LegalRetrievalIndex" '
                '("id","legalCorpusVersionId","version","status","configHash","contentHash",'
                '"validationManifestRef","validatedAt") '
                'VALUES (%s,%s,%s,\'VALID\'::"LegalRetrievalIndexStatus",%s,%s,%s,%s)',
                (
                    str(uuid.uuid4()),
                    corpus_id,
                    retrieval_version,
                    config_hash,
                    content_hash,
                    retrieval_ref,
                    now,
                ),
            )
            cursor.execute(
                'INSERT INTO "CorpusApprovalRecord" '
                '("id","legalCorpusVersionId","approvedBy","status","idempotencyKey",'
                '"integrityManifestRef","retrievalValidationRef","scopeDescription","comments","approvalDate") '
                'VALUES (%s,%s,%s,\'APPROVED\'::"LegalRuleLifecycleStatus",%s,%s,%s,%s,%s,%s)',
                (
                    str(uuid.uuid4()),
                    corpus_id,
                    "lcsp-dev-seed",
                    f"dev-seed:{corpus_version}:{digest}",
                    integrity_ref,
                    retrieval_ref,
                    "Development-only deterministic bootstrap of checked-in legal corpus",
                    "Direct local seed; not a production legal approval or legal certification",
                    now,
                ),
            )

        conn.commit()

    return {
        "status": "SEEDED",
        "corpusVersionId": corpus_id,
        "version": corpus_version,
        "documentCount": len(documents),
        "chunkCount": len(all_chunks),
        "repealedChunkCount": sum(
            1 for chunk in all_chunks if chunk["legalStatus"] == "REPEALED"
        ),
        "contentHash": content_hash,
        "chromaPath": chroma_path or os.getenv("LEGAL_CHROMA_PATH", "/tmp/lcsp-chroma"),
    }


def main() -> int:
    args = parse_args()
    env_path = args.env_file or find_dotenv(usecwd=True)
    if env_path:
        load_dotenv(env_path, override=False)

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required. Run from the LCSP repository root.")

    psycopg_url, schema, host = psycopg_connection_info(database_url)
    assert_development_target(host)

    source_manifest, documents, content_hash = merge_and_validate_payloads(
        DEFAULT_PAYLOADS,
        args.corpus_version,
    )

    summary = {
        "status": "VALIDATED",
        "version": args.corpus_version,
        "documentCount": len(documents),
        "chunkCount": sum(len(document["chunks"]) for document in documents),
        "repealedChunkCount": sum(
            1
            for document in documents
            for chunk in document["chunks"]
            if chunk["legalStatus"] == "REPEALED"
        ),
        "contentHash": content_hash,
        "databaseHost": host,
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    result = seed_database_and_index(
        db_url=psycopg_url,
        schema=schema,
        corpus_version=args.corpus_version,
        source_manifest=source_manifest,
        documents=documents,
        content_hash=content_hash,
        chroma_path=args.chroma_path,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
