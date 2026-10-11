#!/usr/bin/env node
// Internal mechanical gates on an owned exact-image stack; never customer UI evidence.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const [runId, key, mode] = process.argv.slice(2);
assert.match(runId ?? "", /^[0-9a-f]{16}$/);
assert(["decision-provenance", "completion-blockers", "advance-case", "memory-provenance"].includes(mode));
const root = process.cwd();
const privateDir = path.join(root, "tmp/staging", runId);
const state = JSON.parse(readFileSync(path.join(privateDir, "browser-state.json"), "utf8"));
const assessmentId = state[key]?.assessmentId;
assert.match(assessmentId ?? "", /^[0-9a-f-]{36}$/);
const container = `lcsp-release-staging-${runId}-api`;
const inspected = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .}}", container], { encoding: "utf8" }));
assert.equal(inspected.Config.Labels["lcsp.release-staging"], runId);
assert(inspected.State.Running);
const report = JSON.parse(readFileSync(path.join(root, "reports/staging", runId, "report.json"), "utf8"));
assert.equal(inspected.Image, report.images.api);
const learning = mode === "memory-provenance" ? JSON.parse(readFileSync(path.join(root, "reports/staging", runId, "shared-learning-acceptance.json"), "utf8")) : null;
const source = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire('/app/apps/api/package.json');
const { PrismaService } = require('/app/apps/api/dist/src/infrastructure/prisma/prisma.service.js');
const { AssessmentCaseSupport } = require('/app/apps/api/dist/src/modules/assessment/infrastructure/persistence/assessment-case-support.service.js');
const { AssessmentCompletionGate } = require('/app/apps/api/dist/src/modules/assessment/application/services/assessment-completion-gate.service.js');
const { AssessmentEvidenceInvalidation } = require('/app/apps/api/dist/src/modules/assessment/application/services/assessment-evidence-invalidation.service.js');
const { validateRuleDecision } = require('/app/apps/api/dist/src/modules/assessment/domain/decision-validator.js');
const c = require('@lcsp/contracts/assessment-domain');
const a = require('@lcsp/contracts/assessment');
const legal = require('@lcsp/contracts/legal-portfolio');
const controls = require('@lcsp/contracts/evidence');
const assessmentId = ${JSON.stringify(assessmentId)};
const mode = ${JSON.stringify(mode)};
const heuristicId = ${JSON.stringify(learning?.heuristicId ?? null)};
const sourceAssessmentId = ${JSON.stringify(state.assessmentA?.assessmentId ?? null)};
const prisma = new PrismaService();
const support = new AssessmentCaseSupport();
const gate = new AssessmentCompletionGate(support);
try {
  const pins = await support.loadPins(prisma, assessmentId, 'mechanical-acceptance');
  const runtime = await prisma.assessmentRuntime.findUniqueOrThrow({where:{assessmentId}});
  const row = await prisma.assessmentRuleDecision.findFirstOrThrow({where:{assessmentId,state:'ACCEPTED'},orderBy:{decisionRevision:'desc'}});
  const decision = a.ruleDecisionSchema.parse(row.decision);
  const context = await support.buildValidationContext(prisma, {assessmentId,pins,decision});
  assert.deepEqual(validateRuleDecision(decision,context),[]);
  let result;
  if (mode === 'decision-provenance') {
    const evidence = [...context.evidence.entries()][0];
    assert(evidence, 'Root decision has no repository evidence');
    const payload = {scopes:[{kind:c.SEARCH_COVERAGE_SCOPE_KINDS.SOURCE_DIRECTORY,path:'.'}],queries:[{tool:'search_code',query:'bounded investigation',resultCount:0,truncated:false}],inspectedEntryPoints:[],knownGaps:[],directSourceFallbacks:[]};
    const reference = {type:a.RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,evidenceId:evidence[0]};
    const proposal = a.ruleDecisionSchema.parse({...decision,references:[reference],criteria:decision.criteria.map(criterion=>({...criterion,references:[reference]}))});
    const direct = [];
    for (const scenario of ['complete','truncated','known-gap','missing','unknown']) {
      const map = new Map(context.evidence);
      const p = structuredClone(payload);
      if (scenario==='truncated') p.queries[0].truncated=true;
      if (scenario==='known-gap') p.knownGaps=['Incomplete source coverage.'];
      map.set(evidence[0],{...evidence[1],type:c.ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,payload:scenario==='missing'?{}:p});
      if(scenario==='unknown')map.delete(evidence[0]);
      const failures=validateRuleDecision(proposal,{...context,evidence:map});
      if(scenario==='complete')assert.deepEqual(failures,[]);
      else assert(failures.some(f=>f.code===(scenario==='unknown'?c.DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE:c.DECISION_VALIDATION_FAILURE_CODES.SEARCH_COVERAGE_INCOMPLETE)));
      direct.push({scenario,failures});
    }
    const fact = [...context.facts.entries()].find(([,value])=>value.authority===c.ASSESSMENT_FACT_AUTHORITIES.EVIDENCE_CITED);
    assert(fact?.[1].evidenceIds.length, 'Root has no evidence-backed fact for indirect provenance proof');
    const factRef={type:a.RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,factId:fact[0],caseRevision:decision.caseRevision};
    const indirectProposal=a.ruleDecisionSchema.parse({...decision,references:[factRef],criteria:decision.criteria.map(criterion=>({...criterion,references:[factRef]}))});
    const indirect=[];
    for(const scenario of ['complete','truncated','known-gap','missing','unknown']) {
      const map=new Map(context.evidence);const p=structuredClone(payload);const evidenceId=fact[1].evidenceIds[0];
      if(scenario==='truncated')p.queries[0].truncated=true;
      if(scenario==='known-gap')p.knownGaps=['Incomplete source coverage.'];
      map.set(evidenceId,{...map.get(evidenceId),type:c.ASSESSMENT_EVIDENCE_TYPES.SEARCH_COVERAGE,payload:scenario==='missing'?{}:p});
      if(scenario==='unknown')map.delete(evidenceId);
      const failures=validateRuleDecision(indirectProposal,{...context,evidence:map});
      if(scenario==='complete')assert.deepEqual(failures,[]);
      else assert(failures.some(f=>f.code===(scenario==='unknown'?c.DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE:c.DECISION_VALIDATION_FAILURE_CODES.SEARCH_COVERAGE_INCOMPLETE)));
      indirect.push({scenario,failures});
    }
    result={status:'PASS_MECHANICAL_GUARD',direct,indirect,databaseWrites:0,semanticInterpretation:'NOT_ASSERTED_BY_THIS_PROBE'};
  } else if(mode==='memory-provenance') {
    const reference={type:a.RULE_DECISION_REFERENCE_TYPES.ASSESSMENT_EVIDENCE,evidenceId:heuristicId};
    const proposal=a.ruleDecisionSchema.parse({...decision,references:[reference],criteria:decision.criteria.map(criterion=>({...criterion,references:[reference]}))});
    const failures=validateRuleDecision(proposal,context);
    assert(failures.some(f=>f.code===c.DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_EVIDENCE_REFERENCE && f.ref===heuristicId));
    const foreignFact=assessmentId!==sourceAssessmentId ? await prisma.assessmentCaseFact.findFirstOrThrow({where:{assessmentId:sourceAssessmentId,authority:c.ASSESSMENT_FACT_AUTHORITIES.HUMAN_PROVIDED}}) : null;
    let foreignFailures=null;
    if(foreignFact) {
      const foreignReference={type:a.RULE_DECISION_REFERENCE_TYPES.CONFIRMED_FACT,factId:foreignFact.factId,caseRevision:decision.caseRevision};
      const foreignProposal=a.ruleDecisionSchema.parse({...decision,references:[foreignReference],criteria:decision.criteria.map(criterion=>({...criterion,references:[foreignReference]}))});
      foreignFailures=validateRuleDecision(foreignProposal,context);
      assert(foreignFailures.some(f=>f.code===c.DECISION_VALIDATION_FAILURE_CODES.UNKNOWN_FACT_REFERENCE && f.ref===foreignFact.factId));
    }
    result={status:'PASS_MECHANICAL_AUTHORITY_REJECTION',heuristicId,failures,foreignFactId:foreignFact?.factId ?? null,foreignFailures,databaseWrites:0,proposalPersisted:false};
  } else if(mode==='completion-blockers') {
    const baseline=await gate.inspectInTx(prisma,assessmentId);
    const allowed=new Set([c.ASSESSMENT_COMPLETION_BLOCKER_CODES.ASSESSMENT_NOT_ACTIVE,c.ASSESSMENT_COMPLETION_BLOCKER_CODES.EXECUTION_FAILURE,c.ASSESSMENT_COMPLETION_BLOCKER_CODES.INVALID_ARTIFACT_PREREQUISITE]);
    assert(baseline.blockers.every(b=>allowed.has(b.code)),JSON.stringify(baseline.blockers));
    const cases=[
      ['pending-stop','assessmentRuntimeTurn','findFirst',r=>({...r,state:controls.ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested}),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.RUNTIME_STOP_REQUESTED],
      ['open-human-request','assessmentHumanRequest','findMany',()=>[{requestId:assessmentId}],c.ASSESSMENT_COMPLETION_BLOCKER_CODES.OPEN_HUMAN_REQUEST],
      ['required-input','assessment','findUnique',r=>({...r,lifecycleState:a.ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT}),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.REQUIRED_INPUT_UNRESOLVED],
      ['pending-decision','assessmentDecisionCoverage','findMany',rows=>rows.map(r=>({...r,resolutionState:a.DECISION_RESOLUTION_STATES.PENDING})),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.DECISION_UNRESOLVED],
      ['invalidated-decision','assessmentDecisionCoverage','findMany',rows=>rows.map(r=>({...r,resolutionState:a.DECISION_RESOLUTION_STATES.INVALIDATED})),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION],
      ['stale-pin','assessmentCase','findUnique',r=>({...r,repositoryCommit:'b'.repeat(40)}),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.REPOSITORY_SNAPSHOT_INVALID],
      ['fatal-execution','assessment','findUnique',r=>({...r,runtime:{...r.runtime,executionState:a.AGENT_EXECUTION_STATES.FAILED}}),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.EXECUTION_FAILURE],
      ['invalid-portfolio','legalPortfolioVersion','findUnique',r=>({...r,validationOutcome:legal.LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.FAILED}),c.ASSESSMENT_COMPLETION_BLOCKER_CODES.PORTFOLIO_INVALID],
    ];
    const results=[];
    for(const [name,model,method,change,expected] of cases) {
      const tx=new Proxy(prisma,{get(target,p){if(p!==model)return Reflect.get(target,p);return new Proxy(target[model],{get(delegate,m){if(m!==method)return Reflect.get(delegate,m);return async args=>change(await delegate[method](args));}});}});
      const inspected=await gate.inspectInTx(tx,assessmentId);
      assert(inspected.blockers.some(b=>b.code===expected),name);assert.equal(inspected.snapshot,null);
      results.push({name,expected,blockers:inspected.blockers});
    }
    result={status:'PASS_MECHANICAL_GUARD',baselineBlockers:baseline.blockers,results,databaseWrites:0,method:'NONPERSISTED_PERTURBATIONS_OF_REAL_CURRENT_CASE_READS',httpRequest:'NOT_PERFORMED'};
  } else {
    assert.equal(runtime.executionState,a.AGENT_EXECUTION_STATES.PAUSED);
    const assessment=await prisma.assessment.findUniqueOrThrow({where:{id:assessmentId}});
    assert.equal(assessment.lifecycleState,a.ASSESSMENT_LIFECYCLE_STATES.PAUSED);
    const invalidation=new AssessmentEvidenceInvalidation();
    result=await prisma.$transaction(async tx=>{
      await support.lockCase(tx,assessmentId);
      const current=await tx.assessmentCase.findUniqueOrThrow({where:{assessmentId}});
      assert.equal(current.caseRevision,pins.caseRevision);
      const next=current.caseRevision+1;
      await tx.assessmentCase.update({where:{assessmentId},data:{caseRevision:next}});
      const invalidatedDecisionIds=await invalidation.invalidateCaseRevisionInTx(tx,assessmentId,next);
      assert(invalidatedDecisionIds.includes(row.decisionId));
      const inspection=await gate.inspectInTx(tx,assessmentId);
      assert(inspection.blockers.some(b=>b.code===c.ASSESSMENT_COMPLETION_BLOCKER_CODES.STALE_DECISION));
      assert.equal(inspection.snapshot,null);
      return {status:'PASS_INVALIDATION_PENDING_UI_REINVESTIGATION',beforeRevision:current.caseRevision,afterRevision:next,invalidatedDecisionIds,blockers:inspection.blockers,mutation:'CASE_REVISION_INCREMENT_WITH_EXISTING_CANONICAL_INVALIDATION_SERVICE',insertedFacts:0,insertedEvidence:0,insertedDecisions:0,insertedArtifacts:0};
    });
  }
  console.log(JSON.stringify({assessmentId,threadId:runtime.threadId,actualRootDecisionId:row.decisionId,...result}));
} finally {await prisma.$disconnect();}
`;
const raw = execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module"], { input: source, encoding: "utf8" });
const result = JSON.parse(raw.trim().split("\n").pop());
const receipt = { scope: "CURRENT_IMAGE_INTERNAL_ASSESSMENT_MECHANICAL_GATE", kind: "BACKEND_VERIFICATION", runId, key, mode,
  apiImageId: inspected.Image, imageReceipt: report.imageReceipt ?? report.imageEvidence, ...result };
writeFileSync(path.join(root, "reports/staging", runId, `${mode}-${key}.json`), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({mode,status:result.status,assessmentId}));
