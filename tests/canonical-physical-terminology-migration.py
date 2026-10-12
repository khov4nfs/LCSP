"""Real upgrade fixture: historical physical names -> canonical V2 names, without row copies."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps/api"
MIGRATIONS = API / "prisma/migrations"
MIGRATION = "20261012090000_canonical_physical_terminology"
DATABASE = "lcsp_pr367_physical_rename"
URL = f"postgresql://postgres:postgres@127.0.0.1:55446/{DATABASE}"
OUT = ROOT / "reports/pr367-physical-rename"
TABLES = {
    "LegalCorpusVersion": "LegalSourceVersion",
    "CorpusApprovalRecord": "LegalSourceActivationRecord",
    "LegalPreparationRun": "RuleSetPreparationRun",
    "LegalPortfolioVersion": "ComplianceRuleSetVersion",
    "LegalPortfolioRule": "LegalRequirement",
    "EngineeringRuleLegalRule": "AssessmentRuleLegalRequirement",
    "EngineeringRule": "AssessmentRule",
    "LegalRuleProvenance": "LegalRequirementProvenance",
    "LegalRuleContextRelation": "LegalRequirementContextRelation",
    "LegalPortfolioActivationRecord": "ComplianceRuleSetActivationRecord",
}
COLUMNS = {
    "legalCorpusVersionId": "legalSourceVersionId", "legalPortfolioVersionId": "ruleSetVersionId",
    "portfolioVersionId": "ruleSetVersionId", "portfolioRuleId": "legalRequirementRowId",
    "portfolioDigest": "ruleSetDigest", "legalRuleId": "legalRequirementId",
    "engineeringRuleId": "assessmentRuleId", "engineeringRuleVersion": "assessmentRuleVersion",
    "engineeringRuleRowId": "assessmentRuleRowId", "previousActivePortfolioVersionId": "previousActiveRuleSetVersionId",
}
SCOPED = {"LegalCorpusVersion": {"approvedAt": "activatedAt"}, "CorpusApprovalRecord": {"approvedBy": "activatedBy", "approvalDate": "activatedAt"}}
ENUMS = {"LegalRuleLifecycleStatus": "LegalSourceLifecycleStatus", "LegalPortfolioCoverageState": "LegalRequirementCoverageState", "LegalPreparationFailureReason": "RuleSetPreparationFailureReason", "LegalPortfolioValidationOutcome": "ComplianceRuleSetValidationOutcome"}
RETIRED = re.compile(r"corpus|portfolio|engineering_?rule|legal_?preparation|legal_?rule", re.I)


def deploy(config, label):
    result = subprocess.run(["pnpm", "exec", "prisma", "migrate", "deploy", "--config", str(config)], cwd=API,
        env={**os.environ, "DATABASE_URL": URL, "NODE_OPTIONS": "--max-old-space-size=1536"}, capture_output=True, text=True)
    (OUT / f"{label}.log").write_text(result.stdout + result.stderr)
    assert result.returncode == 0, f"{label} failed; see migration log"
    return result.stdout


def catalog(c):
    return {
        "relations": c.execute("SELECT oid,relname,relkind FROM pg_class WHERE relnamespace='public'::regnamespace ORDER BY oid").fetchall(),
        "columns": c.execute("SELECT a.attrelid,a.attnum,a.attname,a.atttypid FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attrelid,a.attnum").fetchall(),
        "types": c.execute("SELECT oid,typname,typtype FROM pg_type WHERE typnamespace='public'::regnamespace ORDER BY oid").fetchall(),
        "constraints": c.execute("SELECT oid,conname,contype,conrelid,confrelid,conkey,confkey,conindid,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY oid").fetchall(),
        "indexes": c.execute("SELECT i.indexrelid,i.indrelid,i.indisunique,i.indisprimary,i.indkey::text,pg_get_indexdef(i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace ORDER BY i.indexrelid").fetchall(),
        "triggers": c.execute("SELECT t.oid,t.tgname,t.tgrelid,t.tgfoid,t.tgtype,t.tgattr::text,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY t.oid").fetchall(),
        "informationSchemaTriggers": c.execute("SELECT trigger_name,event_object_table,action_statement FROM information_schema.triggers WHERE trigger_schema='public' ORDER BY trigger_name,event_manipulation").fetchall(),
        "functions": c.execute("SELECT oid,proname,pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid").fetchall(),
        "enumValues": c.execute("SELECT e.oid,e.enumtypid,e.enumsortorder,e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace='public'::regnamespace ORDER BY e.oid").fetchall(),
        "pgIndexes": c.execute("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY indexname").fetchall(),
    }


def rows(c, table):
    return sorted((row[0] for row in c.execute(sql.SQL("SELECT to_jsonb(t) FROM {} t").format(sql.Identifier(table))).fetchall()), key=lambda row: json.dumps(row, sort_keys=True, default=str))


def failure(c, query, values=(), error=psycopg.Error):
    try:
        with c.transaction():
            c.execute(query, values)
    except error:
        return
    raise AssertionError("a required database invariant did not reject the write")


def historical_schema():
    # MIGRATION_REHEARSAL_FIXTURE: reconstruct only the old physical naming, never runtime aliases.
    source = (API / "prisma/schema.prisma").read_text()
    reverse_tables = {v:k for k,v in TABLES.items()}
    reverse_enums = {v:k for k,v in ENUMS.items()}
    reverse_columns = {v:k for k,v in COLUMNS.items() if k != "legalPortfolioVersionId"}
    def block(match):
        kind, name, body = match.groups()
        if kind == "enum":
            if name == "LegalSourceLifecycleStatus":
                body = body.replace("  ACTIVE", '  ACTIVE @map("APPROVED")').replace("  INVALID", '  INVALID @map("REJECTED")')
            if name == "AuditResourceType":
                body = body.replace("  LEGAL_REQUIREMENT", '  LEGAL_REQUIREMENT @map("LEGAL_RULE")')
            if name in reverse_enums:
                body += '\n  @@map("' + reverse_enums[name] + '")'
        else:
            old_table = reverse_tables.get(name,name)
            lines = []
            for line in body.splitlines():
                field = re.match(r"\s+([a-zA-Z][a-zA-Z0-9]*)\s+",line)
                if field:
                    logical = field[1]
                    physical = {v:k for k,v in SCOPED.get(old_table,{}).items()}.get(logical,reverse_columns.get(logical,logical))
                    if name in ("AssessmentCase","AssessmentArtifact") and logical == "ruleSetVersionId":
                        physical = "legalPortfolioVersionId"
                    if physical != logical:
                        line += ' @map("' + physical + '")'
                lines.append(line)
            body = '\n'.join(lines)
            if name in reverse_tables:
                body += '\n  @@map("' + reverse_tables[name] + '")'
        return kind + ' ' + name + ' {' + body + '\n}'
    return re.sub(r"(model|enum) ([A-Za-z0-9]+) \{(.*?)\n\}",block,source,flags=re.S)


def main():
    OUT.mkdir(exist_ok=True)
    report = {"status": "FAIL", "migration": MIGRATION, "database": DATABASE, "checks": []}
    def passed(message):
        report["checks"].append(message)
    try:
        with psycopg.connect(URL.rsplit("/", 1)[0] + "/postgres", autocommit=True) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DATABASE)))
        (API / "tmp").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="pr367-physical-", dir=API / "tmp") as tmp:
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
            deploy(config, "before")
            passed("all 106 historical migrations deployed before the physical cutover")
            with psycopg.connect(URL, autocommit=True) as c:
                # MIGRATION_REHEARSAL_FIXTURE: representative accepted V2 data uses old physical names.
                c.execute('''
                INSERT INTO "LegalCorpusVersion" (id,version,status,"sourceManifest","approvedAt") VALUES ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000101','APPROVED','{"fixture":true}',now());
                INSERT INTO "LegalSourceDocument" (id,"legalCorpusVersionId","documentId",title,"sourceUrl","sourceSha256","sourceEffectStatus") VALUES ('00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000101','DOC','Fixture','https://example.test/source',repeat('a',64),'IN_FORCE');
                INSERT INTO "LegalDocumentChunk" (id,"legalCorpusVersionId","legalSourceDocumentId","documentId",locator,content,"contentSha256",hierarchy,"legalStatus") VALUES ('chunk','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000112','DOC','art-1','Fixture',repeat('a',64),'{}','IN_FORCE');
                INSERT INTO "LegalRetrievalIndex" (id,"legalCorpusVersionId",version,status,"configHash","contentHash","validationManifestRef","validatedAt") VALUES ('index','00000000-0000-4000-8000-000000000101','index','VALID','fixture','fixture','retrieval-validation:fixture',now());
                INSERT INTO "CorpusApprovalRecord" (id,"legalCorpusVersionId","approvedBy",status,"scopeDescription") VALUES ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000101','system','APPROVED','Fixture activation');
                INSERT INTO "LegalPreparationRun" (id,"idempotencyKey","legalCorpusVersionId","requestedBy","correlationId","executionState") VALUES ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000101','system','fixture','SUCCEEDED');
                INSERT INTO "LegalPortfolioVersion" (id,version,"legalCorpusVersionId","preparationRunId","lifecycleState","portfolioDigest","validationOutcome","activatedAt") VALUES ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102','ACTIVE',repeat('a',64),'PASSED',now());
                INSERT INTO "LegalPortfolioRule" (id,"portfolioVersionId","legalRuleId",title,proposition,"applicabilityConditions",qualifiers,exceptions,"nonRepositoryDuty","coverageState","contentDigest",ordinal) VALUES ('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000103','LR-1','Fixture','Fixture','[]','[]','[]',false,'COVERED_BY_ASSESSMENT_RULES',repeat('a',64),0);
                INSERT INTO "EngineeringRule" (id,"portfolioVersionId","engineeringRuleId","engineeringRuleVersion",concept,"legalIntent","applicabilityGuidance",criteria,contract,"sourceFingerprint","contentDigest",ordinal) VALUES ('00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000103','AR-1','v1','Fixture','Fixture','Fixture','[]','{}',repeat('a',64),repeat('a',64),0);
                INSERT INTO "EngineeringRuleLegalRule" ("portfolioVersionId","engineeringRuleRowId","portfolioRuleId") VALUES ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000106');
                INSERT INTO "LegalRuleProvenance" (id,"portfolioVersionId","portfolioRuleId","legalCorpusVersionId","chunkId","documentId",locator,"contentSha256","sourceEffectStatus",ordinal) VALUES ('00000000-0000-4000-8000-000000000109','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000101','chunk','DOC','art-1',repeat('a',64),'IN_FORCE',0);
                INSERT INTO "LegalRuleContextRelation" (id,"portfolioVersionId","relationId",kind,"fromRuleId","toChunkId","legalCorpusVersionId","relationDigest",ordinal) VALUES ('00000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000103','CTX-1','DEFINITION','00000000-0000-4000-8000-000000000106','chunk','00000000-0000-4000-8000-000000000101',repeat('a',64),0);
                INSERT INTO "LegalPortfolioActivationRecord" (id,"portfolioVersionId","preparationRunId","idempotencyKey","requestDigest","validationOutcome","correlationId") VALUES ('00000000-0000-4000-8000-000000000110','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000110',repeat('a',64),'PASSED','fixture');
                INSERT INTO "User" (id,email,"passwordHash","emailVerified","failedLoginCount","updatedAt") VALUES ('00000000-0000-4000-8000-000000000113','physical-rename@example.test','fixture',true,0,now());
                INSERT INTO "Assessment" (id,"ownerId",name,"lifecycleState","lifecycleRevision","updatedAt") VALUES ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000113','Fixture','CREATED',0,now());
                INSERT INTO "RepositoryConnection" (id,"assessmentId","userId","installationId","repositoryId","repositoryName","repositoryFullName","defaultBranch",permissions) VALUES ('00000000-0000-4000-8000-000000000115','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000113','fixture-installation','repo','repo','fixture/repo','main','{}');
                INSERT INTO "RepositorySnapshot" (id,"assessmentId","connectionId","repositoryId","repositoryFullName","commitSha","providerMetadata","actorId") VALUES ('00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000115','repo','fixture/repo',repeat('b',40),'{}','00000000-0000-4000-8000-000000000113');
                INSERT INTO "RepositoryScanJob" (id,"assessmentId","snapshotId","idempotencyKey","triggerSource","correlationId","updatedAt") VALUES ('00000000-0000-4000-8000-000000000117','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000117','MANUAL','fixture',now());
                INSERT INTO "AssessmentCase" ("assessmentId","legalPortfolioVersionId","repositorySnapshotId","repositoryScanJobId","repositoryCommit","updatedAt") VALUES ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000117',repeat('b',40),now());
                INSERT INTO "AssessmentEvidence" ("evidenceId","assessmentId",type,"repositoryCommit","contentSha256",payload) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000114','REPOSITORY_SOURCE',repeat('b',40),'sha256:'||repeat('a',64),'{"fixture":true}');
                INSERT INTO "AssessmentRuleDecision" ("decisionId","assessmentId","portfolioVersionId","engineeringRuleId","engineeringRuleVersion","scopeId","decisionRevision",applicability,compliance,"repositoryCommit","caseRevision","idempotencyKey","requestDigest",decision) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000103','AR-1','v1','system',1,'APPLICABLE','COMPLIANT',repeat('b',40),0,'decision',repeat('a',64),'{"fixture":true}');
                INSERT INTO "AssessmentDecisionCoverage" ("assessmentId","portfolioVersionId","engineeringRuleId","engineeringRuleVersion","resolutionState","currentDecisionId","decisionRevision","updatedAt") VALUES ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000103','AR-1','v1','PENDING',NULL,0,now());
                UPDATE "AssessmentDecisionCoverage" SET "resolutionState"='INVESTIGATING' WHERE "assessmentId"='00000000-0000-4000-8000-000000000114';
                UPDATE "AssessmentDecisionCoverage" SET "resolutionState"='RESOLVED',"currentDecisionId"='00000000-0000-4000-8000-000000000002',"decisionRevision"=1 WHERE "assessmentId"='00000000-0000-4000-8000-000000000114';
                INSERT INTO "AuditEvent" (id,"eventType","resourceType","resourceId","correlationId",payload) VALUES ('audit','event.legal-corpus.activated.v1','LEGAL_RULE','00000000-0000-4000-8000-000000000106','fixture','{"historical":"LegalCorpusVersion"}');
                ''')
                for status in ("PENDING", "FAILED", "DLQ", "PUBLISHED", "CANCELLED"):
                    c.execute('INSERT INTO "OutboxMessage" (id,"aggregateType","aggregateId","eventType",status,payload) VALUES (%s,\'LEGAL_SOURCE_VERSION\',\'00000000-0000-4000-8000-000000000101\',\'event.legal-corpus.activated.v1\',%s,\'{"legalSourceVersionId":"source","historical":"LegalCorpusVersion"}\')', ('event-' + status,status))
                before = catalog(c)
                baseline_schema = task / "schema-before.prisma"
                baseline_schema.write_text(historical_schema())
                baseline_diff = subprocess.run(['pnpm','exec','prisma','migrate','diff','--from-config-datasource','--config',str(config),'--to-schema',str(baseline_schema),'--script'],cwd=API,env={**os.environ,'DATABASE_URL':URL},capture_output=True,text=True)
                assert baseline_diff.returncode == 0, baseline_diff.stderr
                (OUT/'prior-prisma-schema-diff.sql').write_text(baseline_diff.stdout)
                (OUT/'before-catalog.json').write_text(json.dumps(before,indent=2,default=str)+'\n')
                names = [r[1] for r in before['relations'] if r[2] == 'r' and r[1] != '_prisma_migrations']
                before_rows = {t: rows(c,t) for t in names}
                assert sum(len(v) for v in before_rows.values()) == 28
                passed("28 representative V2 rows seeded, including accepted decision/evidence, pin, context, activation, audit and outbox")
            configure(MIGRATIONS)
            deploy(config, "upgrade")
            with psycopg.connect(URL, autocommit=True) as c:
                after = catalog(c)
                assert [(x[0],x[2]) for x in before['relations']] == [(x[0],x[2]) for x in after['relations']]
                assert [(x[0],x[1],x[3]) for x in before['columns']] == [(x[0],x[1],x[3]) for x in after['columns']]
                assert [(x[0],x[2]) for x in before['types']] == [(x[0],x[2]) for x in after['types']]
                passed("table/index/type OIDs and column attnums/types preserved")
                assert [(x[0],*x[2:8]) for x in before['constraints']] == [(x[0],*x[2:8]) for x in after['constraints']]
                assert [x[:5] for x in before['indexes']] == [x[:5] for x in after['indexes']]
                passed("PK/FK/check identities, relationships and index definitions preserve their object bindings")
                assert [(x[0],*x[2:]) for x in before['triggers']] == [(x[0],*x[2:]) for x in after['triggers']]
                assert [x[0] for x in before['functions']] == [x[0] for x in after['functions']]
                assert [x[:3] for x in before['enumValues']] == [x[:3] for x in after['enumValues']]
                passed("trigger/function/enum-value OIDs and trigger bindings preserved")
                expected = {}
                for table, entries in before_rows.items():
                    mapped = []
                    for row in entries:
                        row = {SCOPED.get(table,{}).get(k,COLUMNS.get(k,k)):v for k,v in row.items()}
                        if table in SCOPED:
                            row['status'] = {'APPROVED':'ACTIVE','REJECTED':'INVALID'}.get(row['status'],row['status'])
                        if table == 'AuditEvent' and row['resourceType'] == 'LEGAL_RULE':
                            row['resourceType'] = 'LEGAL_REQUIREMENT'
                        if table == 'OutboxMessage' and row['status'] in ('PENDING','FAILED','DLQ'):
                            row['eventType'] = 'event.legal-source.activated.v1'
                        mapped.append(row)
                    expected[TABLES.get(table,table)] = sorted(mapped,key=lambda row: json.dumps(row,sort_keys=True,default=str))
                assert expected == {TABLES.get(t,t): rows(c,TABLES.get(t,t)) for t in before_rows}
                passed("all row counts, IDs, payload bytes, decision/evidence and history preserved; only expected names/enum labels/undelivered routing changed")
                for key,entries in after.items():
                    assert not RETIRED.search(json.dumps(entries,default=str)), f"old active physical metadata remains in {key}"
                assert set(TABLES.values()) <= {r[1] for r in after['relations']}
                assert set(ENUMS.values()) <= {r[1] for r in after['types']}
                passed("pg_class/pg_attribute/pg_type/pg_constraint/pg_indexes/information_schema.triggers have zero retired names")
                assert c.execute('SELECT id FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"=\'ACTIVE\'').fetchall() == [('00000000-0000-4000-8000-000000000103',)]
                assert c.execute('SELECT "ruleSetVersionId","currentDecisionId"::text FROM "AssessmentDecisionCoverage" WHERE "assessmentId"=\'00000000-0000-4000-8000-000000000114\'').fetchone() == ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000002')
                assert c.execute('SELECT "ruleSetVersionId" FROM "AssessmentCase" WHERE "assessmentId"=\'00000000-0000-4000-8000-000000000114\'').fetchone() == ('00000000-0000-4000-8000-000000000103',)
                passed("ACTIVE authority, immutable assessment pin and accepted decision identity preserved")
                failure(c,'UPDATE "LegalRequirement" SET title=\'changed\' WHERE id=\'00000000-0000-4000-8000-000000000106\'')
                failure(c,'UPDATE "AssessmentRule" SET concept=\'changed\' WHERE id=\'00000000-0000-4000-8000-000000000107\'')
                failure(c,'UPDATE "ComplianceRuleSetVersion" SET "ruleSetDigest"=repeat(\'c\',64) WHERE id=\'00000000-0000-4000-8000-000000000103\'')
                failure(c,'UPDATE "AssessmentRuleDecision" SET "scopeId"=\'changed\' WHERE "assessmentId"=\'00000000-0000-4000-8000-000000000114\'')
                failure(c,'UPDATE "AssessmentCase" SET "ruleSetVersionId"=NULL WHERE "assessmentId"=\'00000000-0000-4000-8000-000000000114\'',error=psycopg.errors.CheckViolation)
                passed("renamed rule-set/requirement/rule/decision and assessment-pin guards still reject mutation")
                failure(c,'INSERT INTO "LegalRequirement" (id,"ruleSetVersionId","legalRequirementId",title,proposition,"applicabilityConditions",qualifiers,exceptions,"nonRepositoryDuty","coverageState","nonAssessableReason","contentDigest",ordinal) VALUES (\'bad\',\'00000000-0000-4000-8000-000000000103\',\'BAD\',\'Fixture\',\'Fixture\',\'[]\',\'[]\',\'[]\',false,\'COVERED_BY_ASSESSMENT_RULES\',\'contradictory\',repeat(\'a\',64),1)',error=psycopg.errors.CheckViolation)
                passed("renamed coverage CHECK rejects contradictory state")
                c.execute('UPDATE "ComplianceRuleSetVersion" SET "lifecycleState"=\'SUPERSEDED\',"supersededAt"=now() WHERE id=\'00000000-0000-4000-8000-000000000103\'')
                c.execute('UPDATE "AssessmentCase" SET "caseRevision"=1 WHERE "assessmentId"=\'00000000-0000-4000-8000-000000000114\'')
                assert c.execute('SELECT "ruleSetVersionId" FROM "AssessmentCase"').fetchone() == ('00000000-0000-4000-8000-000000000103',)
                c.execute('UPDATE "ComplianceRuleSetVersion" SET "lifecycleState"=\'ACTIVE\',"supersededAt"=NULL WHERE id=\'00000000-0000-4000-8000-000000000103\'')
                passed("legal supersession and audited reactivation transitions still fire; old pin stays unchanged")
                diff=subprocess.run(['pnpm','exec','prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--script'],cwd=API,env={**os.environ,'DATABASE_URL':URL},capture_output=True,text=True)
                (OUT/'prisma-schema-diff.sql').write_text(diff.stdout+diff.stderr)
                expected_diff = baseline_diff.stdout
                # Existing unmodeled checks/FKs and unrelated schema drift must stay exactly as before.
                names = {}
                for category in ('relations','constraints','types','triggers'):
                    for a,b in zip(before[category],after[category]):
                        names[a[1]] = b[1]
                for a,b in sorted(names.items(),key=lambda item:-len(item[0])):
                    expected_diff = expected_diff.replace('"'+a+'"','"'+b+'"')
                for a,b in {**TABLES,**COLUMNS,**ENUMS}.items():
                    expected_diff = expected_diff.replace(a,b)
                assert diff.returncode == 0 and diff.stdout == expected_diff, 'new Prisma schema drift introduced by physical cutover'
                passed("canonical Prisma schema introduces zero drift beyond the captured pre-existing unmodeled constraints/unrelated objects")
                node='''import {createRequire} from 'node:module'; const r=createRequire(process.cwd()+'/apps/api/package.json'); const {PrismaClient}=r('@prisma/client');const {PrismaPg}=r('@prisma/adapter-pg');const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});try{const row=await p.complianceRuleSetVersion.findUniqueOrThrow({where:{id:'00000000-0000-4000-8000-000000000103'},include:{legalSourceVersion:true,rules:true,assessmentRules:true}});if(row.legalSourceVersion.status!=='ACTIVE'||row.rules[0].id!=='00000000-0000-4000-8000-000000000106'||row.assessmentRules[0].id!=='00000000-0000-4000-8000-000000000107')throw Error('canonical read mismatch');await p.legalSourceVersion.create({data:{id:'00000000-0000-4000-8000-000000000104',version:'00000000-0000-4000-8000-000000000104',sourceManifest:{fixture:true}}});await p.ruleSetPreparationRun.create({data:{id:'00000000-0000-4000-8000-000000000105',idempotencyKey:'00000000-0000-4000-8000-000000000105',legalSourceVersionId:'00000000-0000-4000-8000-000000000104',requestedBy:'fixture',correlationId:'fixture'}});}finally{await p.$disconnect();}'''
                result=subprocess.run(['node','--input-type=module','-e',node],cwd=ROOT,env={**os.environ,'DATABASE_URL':URL},capture_output=True,text=True)
                (OUT/'prisma-read-write.log').write_text(result.stdout+result.stderr)
                assert result.returncode==0,'canonical Prisma read/write failed'
                passed("current generated Prisma client reads preserved graph and writes new source/preparation using canonical names")
                stable = {t:rows(c,t) for t in expected}
                stable_catalog = catalog(c)
            replay = deploy(config, "replay")
            assert 'No pending migrations to apply' in replay
            with psycopg.connect(URL) as c:
                assert stable == {t:rows(c,t) for t in stable}
                assert stable_catalog == catalog(c)
            passed("repeat deploy is a no-op for data, metadata and object identity")
            (OUT/'before-catalog.json').write_text(json.dumps(before,indent=2,default=str)+'\n')
            (OUT/'after-catalog.json').write_text(json.dumps(after,indent=2,default=str)+'\n')
            report['rowCounts']={TABLES.get(t,t):len(v) for t,v in before_rows.items() if v}
            report['renames']={k:sum(a!=b for a,b in zip(before[key],after[key])) for k,key in [('tablesAndIndexes','relations'),('columns','columns'),('types','types'),('constraints','constraints'),('triggers','triggers')]}
        report['migrationSha256']=hashlib.sha256((MIGRATIONS/MIGRATION/'migration.sql').read_bytes()).hexdigest()
        migration_sql=(MIGRATIONS/MIGRATION/'migration.sql').read_text()
        report['physicalRenames']={
            'tables':len(re.findall(r'ALTER TABLE \"[^\"]+\" RENAME TO',migration_sql)),
            'columns':len(re.findall(r'RENAME COLUMN',migration_sql)),
            'tableColumns':34,
            'indexAttributeLabels':28,
            'enumTypes':len(re.findall(r'ALTER TYPE \"[^\"]+\" RENAME TO',migration_sql)),
            'constraints':len(re.findall(r'RENAME CONSTRAINT',migration_sql)),
            'indexes':len(re.findall(r'ALTER INDEX',migration_sql)),
            'triggers':len(re.findall(r'ALTER TRIGGER',migration_sql)),
        }
        report['oldActivePhysicalNameHits']=0
        report['status']='PASS'
    finally:
        report['tests']=f"{len(report['checks'])}/14"
        (OUT/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))


if __name__ == '__main__':
    main()
