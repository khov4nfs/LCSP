#!/usr/bin/env python3
"""Import precompiled EngineeringRules into LCSP's exact Chroma runtime cache.

This does not create or approve LegalRule authority. It only binds templates to
currently APPROVED LegalRule records and the APPROVED legal corpus, computes the
same fingerprint as EngineeringRuleService, validates the result, then writes the
same cache collection used by get_or_compile().
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import find_dotenv, load_dotenv


def args_parser():
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", required=True)
    p.add_argument("--corpus-version", default=None)
    p.add_argument("--catalog-version", default=None)
    p.add_argument("--env-file", default=None)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--allow-uncovered-primary", action="store_true")
    return p.parse_args()


def j(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    return json.loads(value) if isinstance(value, str) else value


def heading_only(content: str) -> bool:
    lines = [x.strip() for x in str(content).splitlines() if x.strip()]
    return len(lines) == 1 and bool(re.fullmatch(r"Điều\s+\d+\..+", lines[0], re.I))



def psycopg_connection_info(database_url: str) -> tuple[str, str | None]:
    """Convert a Prisma PostgreSQL URL into a psycopg-compatible URL.

    Prisma accepts query parameters such as `schema`, `connection_limit`,
    `pool_timeout`, `socket_timeout`, and `pgbouncer` that libpq/psycopg does
    not understand. We strip those parameters from the URI and apply the Prisma
    schema as `search_path` with a SQL statement after the connection opens.

    Applying search_path after connection avoids URI/options encoding problems
    such as PostgreSQL receiving `+search_path` instead of `search_path`.
    """
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        return database_url, None

    query = parse_qsl(parsed.query, keep_blank_values=True)
    prisma_only = {
        "schema",
        "connection_limit",
        "pool_timeout",
        "socket_timeout",
        "pgbouncer",
    }

    schema = None
    kept: list[tuple[str, str]] = []

    for key, value in query:
        if key == "schema":
            schema = value.strip() or None
            continue
        if key in prisma_only:
            continue
        kept.append((key, value))

    sanitized = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(kept), parsed.fragment)
    )
    return sanitized, schema


def main() -> int:
    args = args_parser()
    env_path = args.env_file or find_dotenv(usecwd=True)
    if env_path:
        load_dotenv(env_path, override=False)
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL is required. Run from LCSP root or pass --env-file.")

    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))

    from lcsp_workers.legal.chromadb_citation_retriever import ChromaDbCitationRetriever
    from lcsp_workers.legal.engineering_rules.cache import EngineeringRuleCache
    from lcsp_workers.legal.engineering_rules.compiler import COMPILER_VERSION, PROMPT_VERSION
    from lcsp_workers.legal.engineering_rules.fingerprint import engineering_rule_fingerprint
    from lcsp_workers.legal.engineering_rules.models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule
    from lcsp_workers.legal.engineering_rules.validator import validate_engineering_rule

    expected = (
        bundle.get("engineeringRuleSchemaVersion"),
        bundle.get("compilerVersion"),
        bundle.get("promptVersion"),
    )
    current = (ENGINEERING_RULE_SCHEMA_VERSION, COMPILER_VERSION, PROMPT_VERSION)
    if expected != current:
        raise SystemExit(f"Bundle/runtime contract mismatch: bundle={expected}, runtime={current}")

    corpus_version = args.corpus_version or bundle.get("legalCorpusVersionHint")
    if not corpus_version:
        raise SystemExit("Missing corpus version.")

    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row

    psycopg_url, prisma_schema = psycopg_connection_info(db_url)

    with psycopg.connect(psycopg_url, row_factory=dict_row) as conn:
        if prisma_schema:
            # Identifier quoting is handled by psycopg; never interpolate schema names.
            with conn.cursor() as schema_cur:
                schema_cur.execute(
                    sql.SQL("SET search_path TO {}").format(sql.Identifier(prisma_schema))
                )
        with conn.cursor() as cur:
            cur.execute(
                """SELECT "id","version","status"::text AS status
                   FROM "LegalCorpusVersion"
                   WHERE "version"=%s AND "status"::text='APPROVED'
                   ORDER BY "createdAt" DESC LIMIT 1""",
                (corpus_version,),
            )
            corpus = cur.fetchone()
            if not corpus:
                raise SystemExit(f"APPROVED LegalCorpusVersion not found: {corpus_version}")

            if args.catalog_version:
                cur.execute(
                    """SELECT "id","version","status"::text AS status
                       FROM "LegalRuleCatalogVersion"
                       WHERE "version"=%s AND "status"::text='APPROVED'
                       ORDER BY "createdAt" DESC LIMIT 1""",
                    (args.catalog_version,),
                )
            else:
                cur.execute(
                    """SELECT "id","version","status"::text AS status
                       FROM "LegalRuleCatalogVersion"
                       WHERE "status"::text='APPROVED'
                       ORDER BY "createdAt" DESC LIMIT 1"""
                )
            catalog = cur.fetchone()
            if not catalog:
                raise SystemExit("No APPROVED LegalRuleCatalogVersion found.")

            cur.execute(
                """SELECT "legalRuleId","ruleFamily","requiredFacts","optionalFacts",
                          "blockingFacts","unknownFactPolicy","citationLocatorRefs"
                   FROM "LegalRule"
                   WHERE "legalRuleCatalogVersionId"=%s AND "status"::text='APPROVED'
                   ORDER BY "legalRuleId" ASC""",
                (catalog["id"],),
            )
            legal_rules = cur.fetchall()

            cur.execute(
                """SELECT "id","documentId","locator","content","contentSha256","legalStatus"
                   FROM "LegalDocumentChunk"
                   WHERE "legalCorpusVersionId"=%s""",
                (corpus["id"],),
            )
            chunk_rows = cur.fetchall()

    by_id = {str(x["id"]): x for x in chunk_rows}
    by_locator = {(str(x["documentId"]), str(x["locator"])): x for x in chunk_rows}

    retriever = ChromaDbCitationRetriever()
    cache = EngineeringRuleCache()
    templates = list(bundle.get("templates") or [])
    matched_templates_global: set[str] = set()

    stats = {
        "approvedLegalRules": len(legal_rules),
        "matchedLegalRules": 0,
        "materializedEngineeringRules": 0,
        "cacheFingerprintsWritten": 0,
        "skippedNoTemplateRules": 0,
        "skippedUncoveredRules": 0,
        "skippedHashMismatchRules": 0,
    }

    for row in legal_rules:
        refs = j(row["citationLocatorRefs"]) or []
        enriched_refs = []
        primaries = []
        primary_rows = []

        for raw in refs:
            if not isinstance(raw, dict):
                raise SystemExit(f"{row['legalRuleId']}: citation refs must be objects for exact active-catalog fingerprinting.")
            ref = dict(raw)
            chunk = None
            direct = ref.get("chunkId") or ref.get("chunk_id") or ref.get("id")
            if direct:
                chunk = by_id.get(str(direct).removeprefix("legal-chunk:"))
            if chunk is None:
                document_id = ref.get("documentId") or ref.get("document_id")
                locator = ref.get("locator")
                if document_id and locator:
                    chunk = by_locator.get((str(document_id), str(locator)))
            if chunk is None:
                raise SystemExit(f"{row['legalRuleId']}: unresolved citation ref: {ref}")

            ref["id"] = str(chunk["id"])
            ref["legalStatus"] = str(chunk["legalStatus"])
            enriched_refs.append(ref)
            primaries.append(str(chunk["id"]))
            primary_rows.append(chunk)

        primaries = list(dict.fromkeys(primaries))
        matched = []
        for t in templates:
            needed = [str(x) for x in t.get("matchCitationChunkIds") or []]
            if needed and all(x in primaries for x in needed):
                matched.append(t)

        if not matched:
            print(f"SKIP {row['legalRuleId']}: no matching precompiled template")
            stats["skippedNoTemplateRules"] += 1
            continue

        covered = {str(x) for t in matched for x in t.get("matchCitationChunkIds") or []}
        substantive = {str(x["id"]) for x in primary_rows if not heading_only(str(x["content"]))}
        uncovered = sorted(substantive - covered)
        if uncovered and not args.allow_uncovered_primary:
            print(f"SKIP {row['legalRuleId']}: uncovered substantive primary citations={uncovered}")
            stats["skippedUncoveredRules"] += 1
            continue

        active_rule = {
            "legalRuleId": str(row["legalRuleId"]),
            "requiredFacts": j(row["requiredFacts"]),
            "optionalFacts": j(row["optionalFacts"]),
            "blockingFacts": j(row["blockingFacts"]),
            "unknownFactPolicy": str(row["unknownFactPolicy"]),
            "citationLocatorRefs": enriched_refs,
            "ruleFamily": str(row["ruleFamily"]) if row["ruleFamily"] is not None else None,
        }

        context = retriever.retrieve_exact_context(str(corpus["id"]), primaries)
        if not context:
            raise SystemExit(
                f"{row['legalRuleId']}: exact Chroma context unavailable. "
                "Build/activate the validated legal retrieval index first."
            )

        if any(str(x.get("legalStatus") or "ACTIVE") == "REPEALED" for x in context):
            print(f"SKIP {row['legalRuleId']}: context contains REPEALED legal chunk")
            continue

        expected_hashes = {}
        for t in matched:
            expected_hashes.update(t.get("groundingContextHashes") or {})

        actual_ids = {str(x["id"]) for x in context}
        uncovered_context = sorted(actual_ids - set(expected_hashes))
        if uncovered_context:
            print(f"SKIP {row['legalRuleId']}: runtime context not fully grounded by bundle={uncovered_context}")
            stats["skippedUncoveredRules"] += 1
            continue

        mismatches = []
        for x in context:
            cid = str(x["id"])
            expected_hash = str(expected_hashes.get(cid) or "")
            actual_hash = str(x.get("contentSha256") or "")
            if expected_hash != actual_hash:
                mismatches.append({"id":cid,"expected":expected_hash,"actual":actual_hash})
        if mismatches:
            print(f"SKIP {row['legalRuleId']}: source hash mismatch={mismatches}")
            stats["skippedHashMismatchRules"] += 1
            continue

        hashes = {str(x["id"]): str(x.get("contentSha256") or "") for x in context}
        fingerprint = engineering_rule_fingerprint(
            legal_rule=active_rule,
            legal_corpus_version_id=str(corpus["id"]),
            chunk_hashes=hashes,
            schema_version=ENGINEERING_RULE_SCHEMA_VERSION,
            prompt_version=PROMPT_VERSION,
            compiler_version=COMPILER_VERSION,
        )

        source_ids = [str(x["id"]) for x in context]
        source_locators = [str(x["locator"]) for x in context if x.get("locator")]
        materialized = []

        for t in matched:
            payload = {
                "engineeringRuleId": f"{row['legalRuleId']}::PRECOMPILED::{t['templateId']}",
                "legalRuleId": str(row["legalRuleId"]),
                "legalRuleCatalogVersionId": str(catalog["id"]),
                "legalCorpusVersionId": str(corpus["id"]),
                "concept": t["concept"],
                "legalIntent": t["legalIntent"],
                "investigationGoals": t["investigationGoals"],
                "startingNodeTypes": t["startingNodeTypes"],
                "targetNodeTypes": t["targetNodeTypes"],
                "edgeStrategies": t["edgeStrategies"],
                "graphQueries": t["graphQueries"],
                "keywords": t.get("keywords") or [],
                "commonApis": t.get("commonApis") or [],
                "commonLibraries": t.get("commonLibraries") or [],
                "patterns": t.get("patterns") or [],
                "requiredEvidence": t.get("requiredEvidence") or [],
                "supportingEvidence": t.get("supportingEvidence") or [],
                "negativeEvidence": t.get("negativeEvidence") or [],
                "unresolvedConditions": t.get("unresolvedConditions") or [],
                "sourceChunkIds": source_ids,
                "sourceLocators": source_locators,
                "sourceFingerprint": fingerprint,
                "compilerModel": str(bundle.get("compilerModel") or "precompiled"),
                "compilerVersion": COMPILER_VERSION,
                "promptVersion": PROMPT_VERSION,
                "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
            }
            materialized.append(validate_engineering_rule(EngineeringRule.from_dict(payload)))
            matched_templates_global.add(str(t["templateId"]))

        if not args.dry_run:
            cache.put(fingerprint, materialized)
            stats["cacheFingerprintsWritten"] += 1

        stats["matchedLegalRules"] += 1
        stats["materializedEngineeringRules"] += len(materialized)
        print(f"{'DRY-RUN ' if args.dry_run else ''}OK {row['legalRuleId']}: {len(materialized)} rule(s), {fingerprint}")

    unmatched = sorted(str(t["templateId"]) for t in templates if str(t["templateId"]) not in matched_templates_global)

    print("\n=== IMPORT SUMMARY ===")
    print(f"Corpus:  {corpus['version']} ({corpus['id']})")
    print(f"Catalog: {catalog['version']} ({catalog['id']})")
    print(f"Chroma:  {os.getenv('LEGAL_CHROMA_PATH', '/tmp/lcsp-chroma')}")
    for k, v in stats.items():
        print(f"{k}: {v}")
    print(f"templatesWithoutApprovedLegalRuleMatch: {len(unmatched)}")
    for x in unmatched:
        print(f"  - {x}")
    print("\nDRY RUN: cache unchanged." if args.dry_run else "\nImport complete; matching get_or_compile() calls should be cache hits.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
