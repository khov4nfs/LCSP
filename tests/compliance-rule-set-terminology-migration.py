"""Rehearse the terminology upgrade in the single PR #367 disposable PostgreSQL container."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/api"
MIGRATIONS = API / "prisma/migrations"
MIGRATION = "20261011120000_compliance_rule_set_terminology"
URL = "postgresql://postgres:postgres@127.0.0.1:55446/lcsp_pr367_terminology"
RENAMES = {
    "LEGAL_PORTFOLIO_UNAVAILABLE": "COMPLIANCE_RULE_SET_UNAVAILABLE",
    "COVERED_BY_ENGINEERING_RULES": "COVERED_BY_ASSESSMENT_RULES",
    "PORTFOLIO_VALIDATION_FAILED": "RULE_SET_VALIDATION_FAILED",
    "CORPUS_UNAVAILABLE": "SOURCE_VERSION_UNAVAILABLE",
    "LEGAL_PORTFOLIO_VERSION": "COMPLIANCE_RULE_SET_VERSION",
    "LEGAL_CORPUS_VERSION": "LEGAL_SOURCE_VERSION",
}
EVENTS = {
    "command.legal-portfolio.preparation.requested.v1": "command.compliance-rule-set.preparation.requested.v1",
    "event.legal-portfolio.activated.v1": "event.compliance-rule-set.activated.v1",
    "event.legal-portfolio.validation-failed.v1": "event.compliance-rule-set.validation-failed.v1",
}
OUT = ROOT / "reports/pr367-terminology-migration.json"


def migrate(config, log):
    result = subprocess.run(
        ["pnpm", "exec", "prisma", "migrate", "deploy", "--config", str(config)], cwd=API,
        env={**os.environ, "DATABASE_URL": URL, "NODE_OPTIONS": "--max-old-space-size=1536"},
        capture_output=True, text=True, check=False,
    )
    (ROOT / f"reports/pr367-terminology-{log}.log").write_text(result.stdout + result.stderr)
    assert result.returncode == 0, f"migration {log} failed; see saved log"


def catalog(conn):
    return conn.execute("""SELECT c.oid, c.relname, a.attnum, a.attname, a.atttypid
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'_prisma_migrations'
        ORDER BY c.oid,a.attnum""").fetchall()


def rows(conn, table):
    return conn.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t ORDER BY id").format(sql.Identifier(table))).fetchall()


def renamed(value):
    text = json.dumps(value, default=str, sort_keys=True)
    for old, new in RENAMES.items():
        text = text.replace(old, new)
    return text


def main():
    report = {"status": "FAIL", "database": "127.0.0.1:55446/lcsp_pr367_terminology", "checks": []}
    try:
        with psycopg.connect(URL.rsplit("/", 1)[0] + "/postgres", autocommit=True) as admin:
            # No reset/drop: an existing target is refused.
            admin.execute('CREATE DATABASE "lcsp_pr367_terminology"')
        (API / "tmp").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="pr367-terminology-", dir=API / "tmp") as tmp:
            task = Path(tmp)
            prior = task / "migrations"
            prior.mkdir()
            for path in sorted(MIGRATIONS.iterdir()):
                if path.is_dir() and path.name < MIGRATION:
                    shutil.copytree(path, prior / path.name)
                elif path.name == "migration_lock.toml":
                    shutil.copyfile(path, prior / path.name)
            config = task / "prisma.config.ts"
            def configure(path):
                config.write_text('import { defineConfig, env } from "prisma/config";\n'
                    + 'export default defineConfig({schema:' + json.dumps(str(API / "prisma/schema.prisma"))
                    + ',migrations:{path:' + json.dumps(str(path)) + '},datasource:{url:env("DATABASE_URL")}});\n')
            configure(prior)
            migrate(config, "prior")
            report["checks"].append("105 historical migrations deploy before terminology upgrade")
            with psycopg.connect(URL, autocommit=True) as conn:
                conn.execute('INSERT INTO "LegalCorpusVersion" (id,version,"sourceManifest") VALUES (\'source\',\'source\',\'{}\')')
                for i, reason in enumerate(("PORTFOLIO_VALIDATION_FAILED", "CORPUS_UNAVAILABLE")):
                    conn.execute('INSERT INTO "LegalPreparationRun" (id,"idempotencyKey","legalCorpusVersionId","requestedBy","correlationId","executionState","failureReason") VALUES (%s,%s,\'source\',\'fixture\',\'fixture\',\'FAILED\',%s)', (f"run-{i}", f"run-{i}", reason))
                conn.execute('INSERT INTO "LegalPortfolioVersion" (id,version,"legalCorpusVersionId","preparationRunId","portfolioDigest") VALUES (\'rules\',\'rules\',\'source\',\'run-0\',%s)', ("a" * 64,))
                conn.execute('INSERT INTO "LegalPortfolioRule" (id,"portfolioVersionId","legalRuleId",title,proposition,"applicabilityConditions",qualifiers,exceptions,"nonRepositoryDuty","coverageState","contentDigest",ordinal) VALUES (\'requirement\',\'rules\',\'LR-1\',\'fixture\',\'fixture\',\'[]\',\'[]\',\'[]\',false,\'COVERED_BY_ENGINEERING_RULES\',%s,0)', ("b" * 64,))
                for i, event in enumerate(EVENTS):
                    for status in ("PENDING", "FAILED", "DLQ", "PUBLISHED", "CANCELLED"):
                        identity = f"event-{i}-{status}"
                        conn.execute('INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",status,payload) VALUES (%s,\'LEGAL_PORTFOLIO_VERSION\',\'rules\',%s,%s,\'{"fixture":true}\')', (identity, event, status))
                conn.execute('INSERT INTO "AuditEvent" (id,"eventType","resourceType","resourceId","correlationId",payload) VALUES (\'audit\',\'fixture\',\'LEGAL_CORPUS_VERSION\',\'source\',\'fixture\',\'{}\')')
                # Store every renamed value, including values without a convenient production fixture.
                for i, (type_name, value) in enumerate([
                    ("BlockerReason", "LEGAL_PORTFOLIO_UNAVAILABLE"),
                    ("AuditResourceType", "LEGAL_PORTFOLIO_VERSION"),
                    ("OutboxAggregateType", "LEGAL_CORPUS_VERSION"),
                ]):
                    conn.execute(sql.SQL("CREATE TABLE {} (id text, value {})").format(sql.Identifier(f"enum_fixture_{i}"), sql.Identifier(type_name)))
                    conn.execute(sql.SQL("INSERT INTO {} VALUES ('fixture',%s)").format(sql.Identifier(f"enum_fixture_{i}")), (value,))
                tables = ["LegalCorpusVersion", "LegalPreparationRun", "LegalPortfolioVersion", "LegalPortfolioRule", "AuditEvent", *[f"enum_fixture_{i}" for i in range(3)]]
                before = {table: rows(conn, table) for table in tables}
                before_catalog = catalog(conn)
                before_constraints = conn.execute("SELECT oid,conname FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY oid").fetchall()
                before_triggers = conn.execute("SELECT oid,tgname,tgfoid FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid").fetchall()
                before_events = rows(conn, "OutboxMessage")
            shutil.copytree(MIGRATIONS / MIGRATION, prior / MIGRATION)
            configure(prior)
            migrate(config, "upgrade")
            with psycopg.connect(URL, autocommit=True) as conn:
                assert catalog(conn) == before_catalog, "table/column/type identities changed"
                assert conn.execute("SELECT oid,conname FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY oid").fetchall() == before_constraints
                assert conn.execute("SELECT oid,tgname,tgfoid FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid").fetchall() == before_triggers
                report["checks"].append("physical table/column/type OIDs, constraints and triggers preserved")
                assert renamed(before) == json.dumps({t: rows(conn, t) for t in tables}, default=str, sort_keys=True)
                report["checks"].append("stored source, preparation, rule-set, requirement, audit and enum rows preserved with only enum labels changed")
                expected = []
                for (row,) in before_events:
                    row = dict(row)
                    row["aggregateType"] = RENAMES[row["aggregateType"]]
                    if row["status"] in ("PENDING", "FAILED", "DLQ"):
                        row["eventType"] = EVENTS[row["eventType"]]
                    expected.append((row,))
                assert rows(conn, "OutboxMessage") == expected
                report["checks"].append("all three undelivered routing keys renamed; published/cancelled history and payloads preserved")
                with conn.transaction():
                    try:
                        conn.execute('INSERT INTO "LegalPortfolioRule" SELECT \'bad\',"portfolioVersionId",\'LR-BAD\',title,proposition,"applicabilityConditions",qualifiers,exceptions,"nonRepositoryDuty","coverageState",\'invalid reason\',"contentDigest",1 FROM "LegalPortfolioRule" WHERE id=\'requirement\'')
                    except psycopg.errors.CheckViolation:
                        pass
                    else:
                        raise AssertionError("coverage CHECK accepted contradictory renamed state")
                report["checks"].append("coverage CHECK still rejects contradictory reason after enum rename")
            migrate(config, "replay")
            report["checks"].append("repeat migrate deploy is a no-op")
        report["migrationSha256"] = hashlib.sha256((MIGRATIONS / MIGRATION / "migration.sql").read_bytes()).hexdigest()
        report["status"] = "PASS"
    finally:
        OUT.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
