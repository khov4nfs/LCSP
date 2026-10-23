// Provider-free real API/PostgreSQL analytics acceptance. No gateway or model traffic.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { startStack, workerKey, root } from "./support/compliance-rule-set-stack.mjs";
import { RULE_SET_PREPARATION_SYSTEM_ACTOR } from "@lcsp/contracts/compliance-rule-set";
import { MODEL_ATTEMPT_STATUSES as S, adminUsageAnalyticsSchema } from "@lcsp/contracts/billing";
let stack = await startStack({ database: process.env.LCSP_USAGE_TEST_DB ?? "lcsp_admin_usage_test", apiPort: 3460, dbPort: 55504, resetDatabase: false });
const { hashSecret } = await import(`${root}/apps/api/dist/src/platform/security/crypto.utils.js`);
const marker = randomUUID();
const password = "OfflineUsageFixturePassword!";
const users = {};
let checks = 0;
const eq = (a,b) => { assert.deepEqual(a,b); checks++; };
const http = async (method, route, body, token, worker = false) => {
 const response = await fetch(stack.base + route, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(worker ? { "x-worker-api-key": workerKey } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
 return { status: response.status, body: await response.json() };
};
try {
 for (const [label, role] of [["admin", "ADMIN"], ["owner", "CUSTOMER"], ["other", "CUSTOMER"]]) {
  const id = randomUUID(), email = `${label}-${marker}@usage.test`;
  await stack.q(`INSERT INTO "User"(id,email,"passwordHash","emailVerified","failedLoginCount",role,"updatedAt") VALUES ($1,$2,$3,true,0,$4::"AuthUserRole",now())`, [id,email,hashSecret(password),role]);
  const login = await http("POST", "/auth/sign-in", { email, password, organization_id: "org-1" });
  eq(login.status,200); users[label] = { id,email,token:login.body.data.session_token };
 }
 const assessment = randomUUID(), otherAssessment = randomUUID();
 for (const [id,owner] of [[assessment,users.owner.id],[otherAssessment,users.other.id]])
  await stack.q(`INSERT INTO "Assessment"(id,"ownerId",name,"updatedAt") VALUES ($1,$2,'Offline usage proof',now())`,[id,owner]);
 const source = randomUUID(), preparation = randomUUID();
 await stack.q(`INSERT INTO "LegalSourceVersion"(id,version,status,"sourceManifest") VALUES ($1,$2,'DRAFT','{}')`,[source,marker]);
 await stack.q(`INSERT INTO "RuleSetPreparationRun"(id,"idempotencyKey","legalSourceVersionId","requestedBy","correlationId") VALUES ($1,$2,$3,$4,$5)`,[preparation,marker,source,users.owner.id,marker]);
 const occurredAt = new Date().toISOString();
 const common = { assessmentId: assessment, runId: marker, agentRole: "rule-set-preparation", provider: "MIRAIAPI", model: "claude-sonnet-5", occurredAt };
 const report = async (invocationId, extra = {}) => {
  const result = await http("POST", "/internal/billing/usage", { ...common, invocationId, ...extra }, null, true);
  eq(result.status,201); return result.body.data;
 };
 const measured = { inputTokens:"10",inputTokensIncludingCache:"12",cachedInputTokens:"2",cacheWriteTokens:"0",outputTokens:"5",reasoningTokens:"3",totalTokens:"17" };
 const producer = `${marker}-producer`, timeout = `${marker}-timeout`;
 await report(producer,{attemptStatus:S.STARTED});
 await report(producer,{attemptStatus:S.COMPLETED,...measured});
 await Promise.all(Array.from({length:6},()=>report(producer,{attemptStatus:S.COMPLETED,...measured})));
 await report(`${marker}-auditor`,{assessmentId:undefined,preparationRunId:preparation,runId:preparation,agentRole:"legal-semantic-auditor",attemptStatus:S.COMPLETED,provider:"APX",model:"claude-sonnet-4-6-free",...measured});
 await report(`${marker}-partial`,{attemptStatus:S.COMPLETED,outputTokens:"3"});
 await report(`${marker}-unknown-model`,{attemptStatus:S.COMPLETED,model:"unverified-model",...measured});
 await report(timeout,{attemptStatus:S.STARTED});
 await report(timeout,{attemptStatus:S.OUTCOME_UNKNOWN,failureClass:"TimeoutError"});
 await report(`${marker}-failed`,{attemptStatus:S.FAILED,failureClass:"BadRequestError"});
 await report(`${marker}-fallback`,{attemptStatus:S.COMPLETED,provider:"INCEPTION",model:"mercury-2.5",...measured});
 await report(`${marker}-other`,{assessmentId:otherAssessment,attemptStatus:S.COMPLETED,...measured});
 const path = `/admin/usage?from=${encodeURIComponent(occurredAt)}&userId=${users.owner.id}&pageSize=100`;
 const dashboard = await http("GET",path,undefined,users.admin.token);
 eq(dashboard.status,200);
 const data = adminUsageAnalyticsSchema.parse(dashboard.body.data);
 eq(data.summary.calls,7); eq(data.summary.successfulResponses,5); eq(data.summary.unresolvedAttempts,1); eq(data.summary.failedAttempts,1);
 eq(data.summary.tokens.totalTokens.known,"68"); eq(data.summary.tokens.totalTokens.unknownInvocations,3);
 eq(data.summary.estimatedCostUsd,null); eq(data.summary.unpricedInvocations,1);
 eq(data.summary.knownEstimatedCostUsd,"0.00021179");
 eq(data.breakdowns.filter(x=>x.dimension==="AGENT_ROLE").length,2);
 eq(data.items.find(x=>x.invocationId===producer).referenceCost.estimatedCostUsd,"0.0000704");
 const persisted = (await stack.q(`SELECT "userId","assessmentId","runId","referenceCostSnapshot" FROM "LlmUsageEvent" WHERE "invocationId"=$1`,[`${marker}-auditor`])).rows[0];
 eq(persisted.userId,users.owner.id); eq(persisted.assessmentId,null); eq(persisted.runId,preparation);
 eq(persisted.referenceCostSnapshot.canonicalModel,"claude-sonnet-4-6");
 eq((await http("GET",path,undefined,users.owner.token)).status,403);
 eq((await http("GET",path,undefined,users.other.token)).status,403);
 eq((await http("GET",path)).status,401);
 eq((await http("POST","/internal/billing/usage",{...common,invocationId:"unauthenticated"})).status,401);
 eq((await http("POST","/internal/billing/usage",{...common,invocationId:producer,...measured,outputTokens:"6",attemptStatus:S.COMPLETED},null,true)).status,409);
 eq((await http("GET",`${path}&provider=APX`,undefined,users.admin.token)).body.data.summary.calls,1);
 eq((await http("GET",`${path}&model=mercury-2.5`,undefined,users.admin.token)).body.data.summary.calls,1);
 eq((await http("GET",`${path}&assessmentId=${otherAssessment}`,undefined,users.admin.token)).body.data.summary.calls,0);
 eq((await http("GET",`${path}&attemptStatus=${S.OUTCOME_UNKNOWN}`,undefined,users.admin.token)).body.data.summary.calls,1);
 eq((await http("GET",path.replace("pageSize=100", "pageSize=2"),undefined,users.admin.token)).body.data.items.length,2);
 eq((await http("GET",`${path}&from=2020-01-01T00:00:00Z`,undefined,users.admin.token)).status,400);
 await report(timeout,{attemptStatus:S.COMPLETED,...measured});
 await report(timeout,{attemptStatus:S.OUTCOME_UNKNOWN,failureClass:"TimeoutError"});
 eq((await http("GET",path,undefined,users.admin.token)).body.data.summary.unresolvedAttempts,0);
 const systemRun = randomUUID();
 await stack.q(`INSERT INTO "RuleSetPreparationRun"(id,"idempotencyKey","legalSourceVersionId","requestedBy","correlationId") VALUES ($1,$2,$3,$4,$5)`,[systemRun,randomUUID(),source,RULE_SET_PREPARATION_SYSTEM_ACTOR,marker]);
 const systemUsage = {assessmentId:undefined,preparationRunId:systemRun,runId:systemRun,attemptStatus:S.COMPLETED,...measured};
 await Promise.all(Array.from({length:4},()=>report(`${marker}-system`,systemUsage)));
 const systemRows = (await stack.q(`SELECT "userId","runId" FROM "LlmUsageEvent" WHERE "invocationId"=$1`,[`${marker}-system`])).rows;
 eq(systemRows.length,1); eq(systemRows[0].userId,null); eq(systemRows[0].runId,systemRun);
 const systemDashboard = await http("GET",`/admin/usage?runId=${systemRun}`,undefined,users.admin.token);
 eq(systemDashboard.status,200); eq(systemDashboard.body.data.summary.calls,1);
 const snapshotBeforeRestart = (await http("GET",path,undefined,users.admin.token)).body.data;
 await stack.stop();
 stack = await startStack({database:process.env.LCSP_USAGE_TEST_DB ?? "lcsp_admin_usage_test",apiPort:3460,dbPort:55504,resetDatabase:false});
 const afterRestart = (await http("GET",path,undefined,users.admin.token)).body.data;
 eq(afterRestart.summary,snapshotBeforeRestart.summary); eq(afterRestart.items,snapshotBeforeRestart.items);
 const proof = { status:"PASS",checks,database:"lcsp_admin_usage_test",port:55504,marker,assessment,preparation,
  summary:data.summary,pricing:persisted.referenceCostSnapshot,paidCalls:0,paidTokens:0,paidCostUsd:"0",proof:"Real authenticated API + PostgreSQL; synthetic provider usage only" };
 writeFileSync("/tmp/lcsp360-admin-usage-api-proof.json",JSON.stringify(proof,null,2));
 console.log(JSON.stringify(proof));
 if (process.env.LCSP_USAGE_KEEP_BROWSER === "1") {
  writeFileSync("/tmp/lcsp360-admin-usage-browser.json",JSON.stringify({api:stack.base,admin:users.admin,email:users.admin.email,password,marker,assessment}),{mode:0o600});
  console.log("Browser fixture ready on 3460");
  await new Promise(resolve=>{process.once("SIGTERM",resolve);process.once("SIGINT",resolve);});
 }
} finally { await stack.stop(); }
