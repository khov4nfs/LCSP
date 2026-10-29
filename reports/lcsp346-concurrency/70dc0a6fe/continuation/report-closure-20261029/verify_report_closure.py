"""Check recorded closure observations without pretending an unexecuted report passed."""
from pathlib import Path
import collections,json
base=Path(__file__).resolve().parent
if (base/'artifacts').is_dir():base=base/'artifacts'
load=lambda name:json.loads((base/name).read_text())
sha='44dba336f332d566d3fee9fc0d32642a402d024e'
prod=load('report-closure-production-preflight.json')
pr=load('report-closure-pr-baseline.json')
review=load('report-closure-reviews-protection.json')['data']['repository']['pullRequest']
rules=load('report-closure-develop-ruleset.json')
probe=load('report-closure-contract-probe.json')
usage=load('report-closure-usage-status.json')
ci=load('report-closure-head-check-runs.json')
rollup=load('report-closure-current-ci.json')
parity=load('report-closure-base-parity.json')
assert prod['head']==prod['sandboxImage']['revision']==pr['headRefOid']==review['headRefOid']==sha
assert not prod['workingTree'] and all(prod[k]==200 for k in ['apiHealth','webHealth','agentHealth'])
assert prod['postDeploymentReportCount']==0 and prod['activeLeaseCount']==0
assert not [r for r in prod['nativeRunStates'] if r['status'] in ['running','pending']]
assert not pr['reviews'] and not review['reviews']['nodes'] and not review['reviewThreads']['nodes']
assert pr['state']=='OPEN' and pr['reviewDecision']=='REVIEW_REQUIRED'
assert [x['login'] for x in pr['reviewRequests']]==['khov4nfs']
pull=next(r for r in rules['rules'] if r['type']=='pull_request')['parameters']
assert pull['required_approving_review_count']==1 and pull['required_review_thread_resolution'] and pull['dismiss_stale_reviews_on_push']
required=next(r for r in rules['rules'] if r['type']=='required_status_checks')['parameters']
assert required['strict_required_status_checks_policy']
for check in required['required_status_checks']:
    assert any(r['name']==check['context'] and r['state']=='SUCCESS' for r in rollup)
assert all(r['state']=='SUCCESS' for r in rollup)
assert all(r['head_sha']==sha and r['status']=='completed' and r['conclusion']=='success' for r in ci['check_runs'])
assert parity['behind_by']==0
assert probe['productionWrites']==0 and probe['providerFree'] and not probe['explicitScenarioBoundaryPresent']
assert usage['providerRequestsMade']==usage['domainWrites']==0
assert {r['status']:r['count'] for r in usage['postDeploymentUsageStates']}=={'SETTLED':64,'UNAVAILABLE':1}
assert all(not x['isLCSP346RecoveryCase'] and x['occurredAt']<'2026-10-29T08:00:49Z' for x in usage['quarantinedJournalRecords'])
result={'implementationSha':sha,'productionObservedAt':prod['observedAt'],'revalidation':'PASS','currentSuccessfulPRCheckNames':len(rollup),'successfulCheckRunRecords':len(ci['check_runs']),'requiredCheckContexts':[x['context'] for x in required['required_status_checks']],'behindDevelopCommits':0,'newProductionAssessmentsAttempted':0,'newRootExecutions':0,'newProviderCalls':0,'newTokens':0,'newUsageCostUsd':'0','postDeploymentArtifacts':0,'freshReportLifecycle':'BLOCKED: no eligible supported scenario or verified owned deployment context','freshAssessmentId':None,'freshRootId':None,'freshArtifactId':None,'completionGateInvokedForNewCase':False,'freshArtifactChecksum':None,'freshRenderDownloadAccessControl':'NOT_EXECUTED','requiredApprovals':1,'actualApprovals':0,'reviewThreads':0,'reviewApproval':'BLOCKED','merged':False,'mergeReady':False,'finalMergedDeployment':'NOT_EXECUTED: no merge','ownerAcceptanceDecision':'PENDING; no alternative evidence has been accepted','overall':'BLOCKED'}
(base/'report-closure-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
