---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-1-07-run-python-semantic-analysis
jira_issue: LCSP-158
status: DONE
---
# Build tool `run_python_semantic_analysis`

## 1–4. Task information and objective

AO-1 P0; Python analyzer/CST resolver in `deepagents`; `SYSTEM_ONLY`, `READ`. Deterministically extract sanitized Python import, call, parameter-name and bounded L1–L3 flow facts from the complete routed Python inventory. Caller `ScanConsumer`; no source text accepted. Timeout 180/240 s per scan, 50 KB per-file parser threshold, `maxDepth<=3`; no retry for syntax/oversize/dynamic edges, one retry for transient worker I/O.

## 5. Input schema

```json
{"type":"object","additionalProperties":false,"required":["workspaceRef","pythonDispatchRef","ruleTableId","maxDepth"],"properties":{"workspaceRef":{"type":"string","pattern":"^workspace:[A-Za-z0-9._-]{1,128}$"},"pythonDispatchRef":{"type":"string","pattern":"^evidence:inventory-[A-Za-z0-9._-]{1,128}$"},"ruleTableId":{"type":"string","pattern":"^ai-rule-table:[A-Za-z0-9._-]{1,64}$"},"maxDepth":{"type":"integer","minimum":1,"maximum":3}}}
```

## 6. Output schema and example

`result={filesAnalyzed,filesSkipped,aiCallSites:array<=budget.maxItems,importMap:array<=budget.maxItems,unsupportedDynamicFlows:array<=budget.maxItems,coverageLimitations:array<=budget.maxItems}`. Call site: `{relativePath,line,functionName,moduleAlias,matchedRuleId,findingType,analysisLevel,callArgsSchema,kwargNames,hasDynamicCall}`. `callArgsSchema` is names/categories only.

```json
{"status":"READY","toolName":"run_python_semantic_analysis","toolVersion":"1.0.0","configHash":"sha256:python-rules-3","correlationId":"3d173aa4-bb5b-4bd1-a2d9-53bfb698be5f","artifactVersions":{"snapshotId":"snapshot:repo-42"},"provenanceRef":"prov:py-4","coverageState":"PARTIAL","evidenceRefs":["evidence:py-call-4"],"limitations":[{"code":"DYNAMIC_FLOW","affectedScopeRef":"path:src/client.py:22","reason":"getattr boundary","retryable":false}],"result":{"filesAnalyzed":8,"filesSkipped":1,"aiCallSites":[{"relativePath":"src/client.py","line":18,"functionName":"ask","moduleAlias":"client","matchedRuleId":"openai.chat","findingType":"AI_INVOCATION","analysisLevel":1,"callArgsSchema":["messages:ARRAY","model:STRING"],"kwargNames":["messages","model"],"hasDynamicCall":false}],"importMap":[{"relativePath":"src/client.py","moduleAlias":"client","importSource":"openai"}],"unsupportedDynamicFlows":[{"relativePath":"src/client.py","line":22,"reason":"GETATTR"}],"coverageLimitations":["lim:py-dynamic-1"]}}
```

## 7–10. Outcomes and logic

Missing dispatch/rule table=`NEEDS_INPUT`; invalid workspace/rule/version=`BLOCKED`; syntax/oversize/dynamic path=`OUT_OF_COVERAGE` per file; parser bug=`FAILED`. Iterate every dispatch file; AST parse; construct imports/aliases; match pinned rule table; CST only after a rule hit to derive identifier names; resolve L2 same-module/L3 direct imports; stop at `getattr`, `**kwargs`, dispatch or L4; redact and sort. Reuse Python analyzer, rules and level guard from scanner task 06.

## 11–15. LLM, registry, audit and security

Not model-callable; models receive only normalized facts. Registry `run_python_semantic_analysis/1.0.0`, action `SCAN_EXECUTE`, state `SCAN_RUNNING`, workspace/dispatch/rule refs, 180/240 s, no mutation. Audit rule/config hashes, file/call/limitation counts, safe refs/duration/output hash; prohibit code, argument values, prompts, AST/CST, exceptions and absolute paths. PBAC validates scan workspace; deep privacy validation before assembler/callback.

## 16–22. Scenario, AC, tests, files

Scenario: Python alias `client.chat...` yields call location and argument *names*; LLM may cite it, but must keep a dynamic edge uncertain. AC: full dispatch attempted; no full source/prompt/AST; depth never exceeds 3; syntax/oversize/dynamic limits explicit; stable deterministic output. Tests: OpenAI/LangChain/RAG/sklearn aliases, dynamic `getattr`, L2/L3 stop, parser/oversize, secret prompt fixture, 500-file coverage. Files: Python analyzer/rule table/level guard, consumer/contracts/tests. Authority `06-python-ast-cst-analyzer.md`. OQ: approved dynamic-flow resolver list (Architecture, open).
