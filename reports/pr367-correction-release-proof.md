# PR #367 final pre-merge correction

Status: **PASS — local final-candidate acceptance**. Exact publication and remote CI are authoritative in the [current PR evidence comment](https://github.com/khov4nfs/LCSP/pull/367#issuecomment-6109881367).

Exact HEAD: the current `refs/pull/367/head`, resolved in that publication receipt. A tracked report cannot embed the hash of the commit containing itself; this report binds the live PR head and the immutable candidate source manifest. Base: `047922c58147f5be3de093dc88db164daadedea8`.

Final candidate: **20261012041902_4058ec2256a0**. Final staging: **0294c54d42864ef0**. Pre-merge local acceptance: **PASS**. Release eligibility: **false — one required human approval; PR remains open and unmerged**. Production: **untouched**.

The physical cutover uses one forward in-place migration: 10 tables, 34 table columns, 28 index attribute labels, 4 enum types, 42 constraints, 35 indexes and 7 triggers renamed. No domain `@map`/`@@map` compatibility remains. The real PostgreSQL upgrade passed **14/14**, preserving rows, IDs, relationships, relevant OIDs, history, ACTIVE authority and assessment pins. Trigger/check rejection remains effective; repeat deployment is a no-op. Both the rehearsal and the new staging audit all relation kinds in `pg_attribute` and report zero old active physical names.

**Root cause:** logical Prisma aliases kept retired physical identities alive. Table renames also left independent index names and index tuple labels unchanged; the first narrow metadata check missed index attributes. Active source lifecycle symbols, routes and bilingual copy still used retired vocabulary, and the current Architecture Freeze contradicted accepted runtime terminology.

**Fix:** rename objects in place, explicitly rename the independent indexes and their tuple labels with PostgreSQL's supported `ALTER TABLE <index> RENAME COLUMN`, remove obsolete maps, and cut over every active caller/export/route together. Reconcile the current freeze and label older design documents historical. No accepted runtime ownership mechanism was redesigned.

Source gates: typecheck, imports, canonical contract literals and V1 retirement **PASS**. Actual PostgreSQL lifecycle/service regressions: **32/32**, zero skips. API units **11/11**, affected Web **16/16**, affected Deep Agents **192/192** after fixing three renamed fixtures, and additional terminology Python **15/15**. API/Web changed-file lint passes. The full terminology classifier finds zero defects and records every allowed historical/migration/retirement hit.

Candidate proof: **4/4 merged-rootfs audits**, **7/7 Docker integrations**, **0 source mismatches** across 1,116 entries and **0 build/policy mismatches** across 25 inputs.

The full fresh Playwright receipt names this exact final candidate: **21/21 phases, workers=1**, plus Playwright MCP English/Vietnamese admin and desktop/mobile chat checks. Unexpected browser errors and transport failures: **0**. Twelve expected authentication/foreign-tenant/deleted-resource console refusals remain visible and classified; navigation cancellations are recorded separately.

Fresh final-image model execution covered automatic preparation V1/V2 and Root A/C. Each preparation has a reasoned **6/6 semantic review**. Root decisions/explanations, evidence, facts and events prove investigation, material Human Resolution, applicability, criterion MET/NOT_MET and NON_COMPLIANT for a positive retention-timing defect. Missing public-use evidence caused a question, while bounded absence plus immutable storage supported MET. No hidden chain-of-thought was used; no new live NOT_APPLICABLE or overall COMPLIANT scenario is claimed.

A+B share V1 `533c7e7b-3a93-482e-82d3-0642c9bf5488`; assessment-triggered preparation count is **0**. V2 `0f0ef8c8-6cbb-491c-9b7d-14c281bd5983` becomes ACTIVE, V1 becomes SUPERSEDED, A/B pins and A decisions/report remain byte-identical, and new C pins V2. Stop/reload persists PAUSED with no stale spinner; Continue uses the same Root thread. A/C report downloads match immutable artifact hashes. Explicit UI deletion erases C's assessment/native state and preserves A and generic learning.

Accounting: **2 preparation runs / 10 successful model turns / 211,734 provider-reported tokens**; **2 Root threads / 32 invocations / 637,544 tokens**. Total **849,278 tokens**. Duplicate usage callbacks return 201 without changing totals or billing. Synthetic customer credits charged: **0**. Preparation initially tries APX slots 1/2/3, succeeds on slot 3, and remains APX; the next preparation skips known-dead slots and uses slot 3. Only counts/fingerprints are recorded. Rejected quota requests returned no usage; unknown provider billing is not estimated as zero.

Acceptance matrix: **25/25** — **21 current correction rows, 4 explicitly reused unchanged invariants** (crash recovery, heuristic provenance rejection, browser stale reinvestigation, concurrent Root ownership). Prior V1 backup/restore proof is an explicitly historical supplement to the fresh physical upgrade. All main browser/model journeys are fresh on this candidate. The owned staging stack and sandbox were removed after capture; historical receipts and private diagnostics are retained.

Current receipts: [source gates](pr367-final-correction-source-gates.json), [physical upgrade](pr367-physical-rename/receipt.json), [terminology audit](pr367-terminology-audit.json), [candidate](release-images/20261012041902_4058ec2256a0/report.json), [full browser](staging/0294c54d42864ef0/browser-full-flow.json), [accounting](staging/0294c54d42864ef0/accounting-reconciliation.json), [matrix](staging-acceptance-matrix.json), [publication binding](git-publication-browser-evidence.json).

[Historical correction proof](pr367-historical-correction-proof-before-physical-cutover.md) preserves prior snapshots. Previous candidates and their screenshot/CI receipts are historical, including this task's superseded partial candidates. They are not current merge proof.
