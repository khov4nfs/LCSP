# Corrections to statements in the prior live-run report and chat summary

The original evidence files in `reports/lcsp360-authoring-memory-20261018/` are preserved byte-for-byte (see `retained-live-0964420f/EVIDENCE_INDEX.json`).
Where my earlier wording was wrong, the correction is recorded here rather than by editing them.

| Earlier statement | Retained evidence says | Source |
|---|---|---|
| "The primary model returned HTTP 429 nineteen times" | 19 failed attempts had three causes: 9 apx 429 (one invocation walked all 9 apx credential slots), 7 Gemini 429, 3 Gemini 401 (slots 02, 03, 05 refused; 01 and 04 were 429) | `disposable-summary.json` `model.safeProviderFailures` |
| "consistent with failing to reach `author_assessment_rule`" | `author_assessment_rule` was called 0 times; the stall was entirely in Requirement authoring | `disposable-summary.json` `agent.toolCounts` |
| "2-vs-4 Requirement mismatch was draft-level Requirements" (unsupported guess, retracted in the same task) | observer skew: counts were sampled at different instants | `RULE_AUTHORING_CONTEXT` timeline |
| the 10 -> 9 -> 10 dip "could be a removal" | exactly one of three `remove_rule_candidate` calls succeeded; 24 mutation calls = 12 success transitions + 12 rejections | derived, see `derived` in the fixture; attribution of individual rejections is NOT recorded |
| (not previously stated) why only 8 of 147 completions are flagged `fallback_used` | failed routes stay disabled for the rest of the run (sticky fallback), so one early apx exhaustion pinned every later call to the fallback route | `deepagents/middleware/provider_fallback.py` `_stick_to_fallback` |
