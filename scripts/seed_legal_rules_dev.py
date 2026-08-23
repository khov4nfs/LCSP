#!/usr/bin/env python3
"""Seed a development-only APPROVED LegalRule catalog for EngineeringRule bootstrap.

This script exists only to make the checked-in precompiled EngineeringRule bundle
usable in an isolated local development database. It does NOT promote the current
production legal-rule authoring candidates and it does NOT turn EngineeringRules
into legal authority.

Instead, each precompiled template receives one development-only LegalRule whose
citations are resolved against an already APPROVED LegalCorpusVersion. Every rule
contains a sentinel required fact that normal VerifiedProfiles do not provide, so
these bootstrap rules cannot become positive legal matches during ordinary local
assessment flows. Their purpose is only to provide governed-looking, exact
LegalRule identities/fingerprints for EngineeringRule cache materialization.

The command refuses NODE_ENV=production and refuses non-local PostgreSQL targets
unless LCSP_DEV_SEED_ALLOW_REMOTE=true is explicitly set for an isolated dev DB.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import uuid

from dotenv import find_dotenv, load_dotenv


SEED_VERSION = "legal-rule-catalog-dev-seed/1.0.0"
DEFAULT_CORPUS_VERSION = "VN-LEGAL-2026-08"
DEFAULT_CATALOG_VERSION = "VN-LEGAL-RULES-2026-08-DEV"
DEFAULT_BUNDLE = Path(
    "reports/legal-corpus-ocr/lcsp-precompiled-engineering-rules-vn-2026-08.json"
)
LOCAL_DB_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEV_RULE_PREFIX = "DEV-ER-"
DEV_RULE_FAMILY = "DEV_ENGINEERING_RULE_BOOTSTRAP"
DEV_RULE_AUTHOR = "lcsp-dev-legal-rule-seed"
DEV_SENTINEL_FACT = "__lcspDevEngineeringRuleSeedGate"
DEV_SENTINEL_EXPECTED_VALUE = "ENABLED"
UNKNOWN_FACT_POLICY = "BLOCK_ON_UNKNOWN"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--corpus-version", default=DEFAULT_CORPUS_VERSION)
    parser.add_argument("--catalog-version", default=DEFAULT_CATALOG_VERSION)
    parser.add_argument("--env-file", default=None)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def bool_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def psycopg_connection_info(database_url: str) -> tuple[str, str | None, str]:
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise SystemExit("DATABASE_URL must be a PostgreSQL URL for development legal-rule seed")

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


def assert_development_target(host: str) -> None:
    if os.getenv("NODE_ENV", "").strip().lower() == "production":
        raise SystemExit("Refusing development legal-rule seed with NODE_ENV=production")
    if host not in LOCAL_DB_HOSTS and not bool_env("LCSP_DEV_SEED_ALLOW_REMOTE"):
        raise SystemExit(
            f"Refusing non-local PostgreSQL target {host!r}. "
            "Set LCSP_DEV_SEED_ALLOW_REMOTE=true only for an explicitly isolated dev database."
        )


def load_bundle(path: Path) -> dict[str, Any]:
    try:
        bundle = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise SystemExit(f"Missing EngineeringRule bundle: {path}") from error
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid EngineeringRule bundle JSON: {path}") from error
    if not isinstance(bundle, dict):
        raise SystemExit("EngineeringRule bundle must be a JSON object")
    templates = bundle.get("templates")
    if not isinstance(templates, list) or not templates:
        raise SystemExit("EngineeringRule bundle has no templates")
    return bundle


def json_value(value: Any):
    from psycopg.types.json import Jsonb

    return Jsonb(value)


def plain_json(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if isinstance(value, str):
        return json.loads(value)
    return value


def dev_rule_id(template_id: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in template_id)
    return f"{DEV_RULE_PREFIX}{safe}"


def build_rules(
    *,
    bundle: dict[str, Any],
    corpus_id: str,
    source_documents: dict[str, dict[str, Any]],
    chunks_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    sources = bundle.get("sources") or []
    if not isinstance(sources, list):
        raise SystemExit("EngineeringRule bundle sources must be a list")

    for source in sources:
        if not isinstance(source, dict):
            raise SystemExit("EngineeringRule bundle contains an invalid source descriptor")
        document_id = str(source.get("documentId") or "")
        expected_sha = str(source.get("sourceSha256") or "")
        stored = source_documents.get(document_id)
        if not stored:
            raise SystemExit(f"Bundle source is missing from approved corpus: {document_id}")
        if str(stored["sourceSha256"]) != expected_sha:
            raise SystemExit(
                f"Approved corpus source hash mismatch for {document_id}: "
                f"bundle={expected_sha} db={stored['sourceSha256']}"
            )

    rules: list[dict[str, Any]] = []
    seen_template_ids: set[str] = set()
    seen_rule_ids: set[str] = set()

    for raw_template in bundle.get("templates") or []:
        if not isinstance(raw_template, dict):
            raise SystemExit("EngineeringRule bundle contains an invalid template")
        template_id = str(raw_template.get("templateId") or "").strip()
        if not template_id or template_id in seen_template_ids:
            raise SystemExit(f"Duplicate/empty templateId: {template_id!r}")
        seen_template_ids.add(template_id)

        rule_id = dev_rule_id(template_id)
        if rule_id in seen_rule_ids:
            raise SystemExit(f"Development LegalRule ID collision: {rule_id}")
        seen_rule_ids.add(rule_id)

        raw_chunk_ids = raw_template.get("matchCitationChunkIds")
        if not isinstance(raw_chunk_ids, list) or not raw_chunk_ids:
            raise SystemExit(f"{template_id}: matchCitationChunkIds is required")
        chunk_ids = list(dict.fromkeys(str(item) for item in raw_chunk_ids if str(item)))
        if len(chunk_ids) != len(raw_chunk_ids):
            raise SystemExit(f"{template_id}: duplicate/empty citation chunk IDs")

        citations: list[dict[str, Any]] = []
        for chunk_id in chunk_ids:
            chunk = chunks_by_id.get(chunk_id)
            if not chunk:
                raise SystemExit(f"{template_id}: citation chunk not found: {chunk_id}")
            if str(chunk["legalStatus"]).upper() == "REPEALED":
                raise SystemExit(
                    f"{template_id}: development rule cannot cite repealed authority: {chunk_id}"
                )
            citations.append(
                {
                    "legalCorpusVersionId": corpus_id,
                    "documentId": str(chunk["documentId"]),
                    "locator": str(chunk["locator"]),
                }
            )

        grounding_hashes = raw_template.get("groundingContextHashes") or {}
        if not isinstance(grounding_hashes, dict):
            raise SystemExit(f"{template_id}: groundingContextHashes must be an object")
        for chunk_id, expected_hash in grounding_hashes.items():
            chunk = chunks_by_id.get(str(chunk_id))
            if not chunk:
                raise SystemExit(f"{template_id}: grounding context chunk missing: {chunk_id}")
            if str(chunk["contentSha256"]) != str(expected_hash):
                raise SystemExit(
                    f"{template_id}: grounding hash mismatch for {chunk_id}: "
                    f"bundle={expected_hash} db={chunk['contentSha256']}"
                )

        rules.append(
            {
                "legalRuleId": rule_id,
                "ruleFamily": DEV_RULE_FAMILY,
                "requiredFacts": [
                    {
                        "field": DEV_SENTINEL_FACT,
                        "expectedValue": DEV_SENTINEL_EXPECTED_VALUE,
                    }
                ],
                "optionalFacts": [],
                "blockingFacts": [],
                "unknownFactPolicy": UNKNOWN_FACT_POLICY,
                "citationLocatorRefs": citations,
                "authoredBy": DEV_RULE_AUTHOR,
                "templateId": template_id,
            }
        )

    return rules


def rule_projection(rule: dict[str, Any]) -> dict[str, Any]:
    return {
        "legalRuleId": rule["legalRuleId"],
        "ruleFamily": rule["ruleFamily"],
        "requiredFacts": rule["requiredFacts"],
        "optionalFacts": rule["optionalFacts"],
        "blockingFacts": rule["blockingFacts"],
        "unknownFactPolicy": rule["unknownFactPolicy"],
        "citationLocatorRefs": rule["citationLocatorRefs"],
        "authoredBy": rule["authoredBy"],
    }


def stored_rule_projection(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "legalRuleId": str(row["legalRuleId"]),
        "ruleFamily": str(row["ruleFamily"]),
        "requiredFacts": plain_json(row["requiredFacts"]),
        "optionalFacts": plain_json(row["optionalFacts"]),
        "blockingFacts": plain_json(row["blockingFacts"]),
        "unknownFactPolicy": str(row["unknownFactPolicy"]),
        "citationLocatorRefs": plain_json(row["citationLocatorRefs"]),
        "authoredBy": str(row["authoredBy"]),
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
    bundle = load_bundle(args.bundle)

    bundle_corpus_hint = str(bundle.get("legalCorpusVersionHint") or "")
    if bundle_corpus_hint and bundle_corpus_hint != args.corpus_version:
        raise SystemExit(
            f"Bundle/corpus version mismatch: bundle={bundle_corpus_hint} requested={args.corpus_version}"
        )

    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    with psycopg.connect(psycopg_url, row_factory=dict_row) as conn:
        if schema:
            with conn.cursor() as cursor:
                cursor.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))

        with conn.cursor() as cursor:
            cursor.execute(
                'SELECT "id","version","status"::text AS status '
                'FROM "LegalCorpusVersion" '
                'WHERE "version"=%s AND "status"::text=\'APPROVED\' '
                'ORDER BY "createdAt" DESC LIMIT 1',
                (args.corpus_version,),
            )
            corpus = cursor.fetchone()
            if not corpus:
                raise SystemExit(
                    f"APPROVED LegalCorpusVersion not found: {args.corpus_version}. "
                    "Run pnpm seed:legal:dev first."
                )
            corpus_id = str(corpus["id"])

            cursor.execute(
                'SELECT "documentId","sourceSha256" FROM "LegalSourceDocument" '
                'WHERE "legalCorpusVersionId"=%s',
                (corpus_id,),
            )
            source_documents = {
                str(row["documentId"]): row for row in cursor.fetchall()
            }

            cursor.execute(
                'SELECT "id","documentId","locator","contentSha256","legalStatus" '
                'FROM "LegalDocumentChunk" WHERE "legalCorpusVersionId"=%s',
                (corpus_id,),
            )
            chunks_by_id = {str(row["id"]): row for row in cursor.fetchall()}

            rules = build_rules(
                bundle=bundle,
                corpus_id=corpus_id,
                source_documents=source_documents,
                chunks_by_id=chunks_by_id,
            )
            expected_rule_refs = [rule["legalRuleId"] for rule in rules]
            content_projection = {
                "seedVersion": SEED_VERSION,
                "catalogVersion": args.catalog_version,
                "corpusVersion": args.corpus_version,
                "bundleId": bundle.get("bundleId"),
                "rules": [rule_projection(rule) for rule in rules],
            }
            content_hash = canonical_sha256(content_projection)

            summary = {
                "status": "VALIDATED",
                "catalogVersion": args.catalog_version,
                "corpusVersion": args.corpus_version,
                "corpusVersionId": corpus_id,
                "ruleCount": len(rules),
                "contentHash": content_hash,
                "sentinelFact": DEV_SENTINEL_FACT,
                "databaseHost": host,
            }
            if args.dry_run:
                print(json.dumps(summary, ensure_ascii=False, indent=2))
                return 0

            cursor.execute(
                'SELECT "id","version","status"::text AS status,"ruleRefs" '
                'FROM "LegalRuleCatalogVersion" WHERE "version"=%s '
                'ORDER BY "createdAt" DESC',
                (args.catalog_version,),
            )
            existing_catalogs = cursor.fetchall()
            if len(existing_catalogs) > 1:
                raise SystemExit(
                    f"Multiple LegalRuleCatalogVersion rows already use {args.catalog_version}; refusing ambiguous dev seed"
                )

            if existing_catalogs:
                catalog = existing_catalogs[0]
                if str(catalog["status"]) != "APPROVED":
                    raise SystemExit(
                        f"Catalog {args.catalog_version} already exists but is not APPROVED; refusing overwrite"
                    )
                stored_refs = plain_json(catalog["ruleRefs"])
                if stored_refs != expected_rule_refs:
                    raise SystemExit(
                        f"Catalog {args.catalog_version} ruleRefs differ from current dev seed; refusing overwrite"
                    )
                cursor.execute(
                    'SELECT "legalRuleId","ruleFamily","requiredFacts","optionalFacts",'
                    '"blockingFacts","unknownFactPolicy","citationLocatorRefs","authoredBy",'
                    '"status"::text AS status '
                    'FROM "LegalRule" WHERE "legalRuleCatalogVersionId"=%s '
                    'ORDER BY "legalRuleId" ASC',
                    (catalog["id"],),
                )
                stored_rules = cursor.fetchall()
                expected_by_id = {
                    rule["legalRuleId"]: rule_projection(rule) for rule in rules
                }
                if len(stored_rules) != len(expected_by_id):
                    raise SystemExit(
                        f"Catalog {args.catalog_version} rule count differs from current dev seed; refusing overwrite"
                    )
                for row in stored_rules:
                    rule_id = str(row["legalRuleId"])
                    if str(row["status"]) != "APPROVED":
                        raise SystemExit(f"Existing dev rule is not APPROVED: {rule_id}")
                    expected = expected_by_id.get(rule_id)
                    if expected is None or stored_rule_projection(row) != expected:
                        raise SystemExit(
                            f"Existing dev rule differs from current deterministic seed: {rule_id}"
                        )
                print(
                    json.dumps(
                        {
                            **summary,
                            "status": "ALREADY_SEEDED",
                            "catalogVersionId": str(catalog["id"]),
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
                return 0

            now = datetime.now(timezone.utc)
            catalog_id = str(uuid.uuid4())
            cursor.execute(
                'INSERT INTO "LegalRuleCatalogVersion" '
                '("id","version","status","ruleRefs","approvedAt") '
                'VALUES (%s,%s,\'APPROVED\'::"LegalRuleLifecycleStatus",%s,%s)',
                (
                    catalog_id,
                    args.catalog_version,
                    json_value(expected_rule_refs),
                    now,
                ),
            )

            for rule in rules:
                cursor.execute(
                    'INSERT INTO "LegalRule" '
                    '("id","legalRuleId","legalRuleCatalogVersionId","ruleFamily",'
                    '"requiredFacts","optionalFacts","blockingFacts","unknownFactPolicy",'
                    '"citationLocatorRefs","status","authoredBy") '
                    'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'
                    '\'APPROVED\'::"LegalRuleLifecycleStatus",%s)',
                    (
                        str(uuid.uuid4()),
                        rule["legalRuleId"],
                        catalog_id,
                        rule["ruleFamily"],
                        json_value(rule["requiredFacts"]),
                        json_value(rule["optionalFacts"]),
                        json_value(rule["blockingFacts"]),
                        rule["unknownFactPolicy"],
                        json_value(rule["citationLocatorRefs"]),
                        rule["authoredBy"],
                    ),
                )

            cursor.execute(
                'INSERT INTO "RuleApprovalRecord" '
                '("id","legalRuleCatalogVersionId","approvedBy","status",'
                '"scopeDescription","comments","approvalDate") '
                'VALUES (%s,%s,%s,\'APPROVED\'::"LegalRuleLifecycleStatus",%s,%s,%s)',
                (
                    str(uuid.uuid4()),
                    catalog_id,
                    DEV_RULE_AUTHOR,
                    "Development-only EngineeringRule bootstrap catalog",
                    (
                        "Sentinel-gated direct local seed. Not production legal authority, "
                        "legal review, legal opinion, or regulatory approval. "
                        f"contentHash={content_hash}"
                    ),
                    now,
                ),
            )
            conn.commit()

    print(
        json.dumps(
            {
                **summary,
                "status": "SEEDED",
                "catalogVersionId": catalog_id,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
