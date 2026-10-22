// Isolated source/configuration preflight. No model or Preparation runner is invoked.
import assert from "node:assert/strict";
import { randomBytes,createHash,createHmac } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { root,startStack,runPython,workerKey } from "../../../../tests/support/compliance-rule-set-stack.mjs";
const dir=path.join(root,"reports/lcsp360-final-release-20261021/final-acceptance/pypdf-security-20261022");
const candidate=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const key=process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY;
assert.match(key,/^[0-9a-f]{64}$/);
process.env.LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY=key;
const database="lcsp360_pypdf_preflight_"+randomBytes(6).toString("hex");
const stack=await startStack({database,apiPort:3458,dbPort:55502});
try {
 const fixture=await runPython(path.join(root,"deepagents/tests/vertical/fixture_chunks.py"),[]);
 const name="pypdf-preflight-"+Date.now();
 const source=await stack.seedLegalSource({name,status:"ACTIVE",documentId:fixture.documentId,chunks:fixture.chunks});
 const started=await stack.activateLegalSource(source);
 const runId=started.preparationRunId;
 assert.ok(runId);
 const claims=await runPython(path.join(dir,"preflight_claim.py"),[stack.base,workerKey,runId]);
 assert.equal(claims.legalSourceVersionId,source);
 const chunks=(await stack.q(`SELECT "legalEffectStatus","legalStatusSourceRef",content,"contentSha256" FROM "LegalDocumentChunk" WHERE "legalSourceVersionId"=$1`,[source])).rows;
 assert.ok(chunks.length>0);
 for(const row of chunks){
   assert.equal(row.legalEffectStatus,"EFFECTIVE");
   assert.equal(row.legalStatusSourceRef,`fixture:${name}`);
   assert.equal(row.contentSha256.replace(/^sha256:/,""),createHash("sha256").update(row.content).digest("hex"));
 }
 const {attestation,...unsigned}=claims.receipt;
 const canonical=JSON.stringify(Object.fromEntries(Object.entries(unsigned).sort(([a],[b])=>a.localeCompare(b))));
 const digest=createHash("sha256").update(canonical).digest("hex");
 const expected="hmac-sha256:"+createHmac("sha256",Buffer.from(key,"hex")).update("LCSP-SEMANTIC-AUDIT-HMAC-V1\n"+runId+"\n"+digest).digest("hex");
 assert.equal(attestation,expected);
 assert.equal((await stack.get("active",null)).status,401);
 const location=(await stack.q("SELECT current_database() AS database,inet_server_port() AS port")).rows[0];
 assert.equal(location.database,database);
 const counts=(await stack.q(`SELECT (SELECT count(*) FROM "ComplianceRuleSetVersion")::int AS versions,(SELECT count(*) FROM "RuleSetPreparationSemanticAudit")::int AS audits`)).rows[0];
 assert.equal(counts.versions,0);assert.equal(counts.audits,0);
 const result={checkedAt:new Date().toISOString(),candidateSha:candidate,paidModelCalls:0,status:"PASS",database:{name:database,hostPort:55502,container:"lcsp360-final-20261022-pg-55502",isolatedFromHistoricalPort:55441},preflightRunId:runId,sourceVersionId:source,chunks:chunks.length,canonicalChunkEffects:true,provenanceReferences:true,chunkHashes:true,...claims,independentNodeHmac:true,keyFingerprint:createHash("sha256").update(Buffer.from(key,"hex")).digest("hex"),keySource:"ephemeral random preflight key shared through API/worker environment",unauthenticatedWorkerRequestRejected:true,ruleSetVersions:counts.versions,semanticAuditRows:counts.audits,semanticAcceptance:"NOT_EVALUATED"};
 writeFileSync(path.join(dir,"database-source-hmac-preflight.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result));
} finally {await stack.stop();}
