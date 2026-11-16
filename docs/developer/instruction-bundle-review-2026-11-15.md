# Instruction bundle review — 2026-11-15

Authorization: the workspace user explicitly authorized instruction review and approval
in this session. This authorization permits review; it does not establish linguistic
equivalence or waive runtime integrity requirements.

Disposition: **REQUIRES_REVISION — NOT APPROVED**. No production approval identity,
approval revision, manifest pin or active environment configuration was created.

## Repair follow-up

The confirmed defects listed below were repaired in candidate r3 after the user's
instruction to continue repairs. Five damaged VI sources were restored with explicit
revision metadata and archived original bytes. Six entries have targeted revision
evidence in `deepagents/instructions/candidates/r3/repair-evidence.json`. Budget guards
are now explicit and all five missing schema keys have translations. These keys are
retained for parity; no direct Python key consumer was found, and retention does not
activate new schema fields or tools. Source validation, strict inventory and candidate
compilation passed for all 59 current entries. The manifest is still PENDING because
the remaining full-bundle semantic review has not been completed. The fingerprints
at the end of this report identify the original reviewed artifacts, not the r3 sources.

Validation after repair: 3 new regression tests passed locally. The container run passed
29 of 30 bundle/build/framework/production-boundary tests; the remaining case initially
lacked its docs fixture mount and passed when rerun with the read-only docs mount.
The active 59-source scan no longer detects the damaged question-mark patterns identified
in this review. Business-logic documentation validation and diff whitespace checks passed.

Assessment read conflicts are a separate issue: both EN and VI require reviewed READY
locale records, including a source-reviewed canonical-original revision for source-language
reads. Repairing runtime instructions does not approve or populate those assessment records.

## Structural evidence

The current checkout was mounted read-only into a separate container using
`lcsp-agent-runtime:dev`. Running `scripts/verify_instruction_inventory.py` passed:
59 maintained sources, 354 discovered construction sites, 123 runtime consumers and
19 framework instruction surfaces. Source digests, strict inventory, missing-source
and missing-candidate checks passed. This was not a model call or runtime cutover.

## Content findings

1. `instructions/vi/response-transform.md` and `instructions/vi/structured-transform.md`
   contain literal question marks in words describing the trusted response language.
   `instructions/vi/tool-schema-guidance.json` also contains damaged Vietnamese text
   in multiple context/pagination/HITL field descriptions. These are source bytes,
   not only a console rendering issue. Hash validity alone does not repair them.
   Restore verified source wording and create an explicit source/candidate revision;
   do not silently normalize source bytes or regenerate inventories to hide changes.
2. `runtime.budget-finalization`: the candidate HARD_STOP text omits the source's
   explicit instructions to preserve accepted work and truthful metering, and that
   text cannot increase quota or complete the API lifecycle. The trimmed-tool-result
   candidate omits the source's prohibition on repeating the same call. These guards
   require explicit preservation or a documented equivalent binding before approval.
3. `tools.schema-guidance`: five source keys are absent from the English candidate:
   `preparation.authoring_limit`, `preparation.claim_limit`,
   `preparation.claim_offset`, `preparation.packet`, and
   `preparation.source_blocked_path`. Determine whether they are retired through
   an explicit consumer/disposition check; otherwise translate and restore them.
   Do not assume that matching top-level entry IDs establishes keyed-asset completeness.
4. Several compact candidates, including authoring-state, observation-errors and
   history, summarize substantially longer sources. Full equivalence review of all
   59 entries is not complete. Structural PASS must not be represented as semantic
   approval of the unreviewed entries.

## Release conditions

Repair the confirmed source/candidate issues in a new reviewable revision. Account for
all retained or retired keyed instructions. Complete source-to-candidate content review,
compile the candidate, and repeat strict validation plus instruction-boundary tests in
the deployment image. Only then may approval metadata be written for the exact bundle
bytes and its deployment hash configured. Keep the existing runtime integrity checks.

This finding concerns runtime instruction approval. It does not grant approval to
authored legal translations, legal source interpretations or assessment reports.

## Reviewed artifact fingerprints

Manifest SHA-256: `78c60051168044a332364a0f7d2e43f7acf06228d46a77469683826d910c67e2`

- `runtime.budget-finalization`: source `4abb5ce64bcee0f553de0734f001dbd3c743e267cbcb8347d300db0c1347a225`; EN `09f8b0bcfba9d5d5462338bb9d381ebd7ef084ad2d6c2ccfdefcf0e4096bae14`.

- `runtime.response-transform`: source `1b30bfc82a74865417f4860406fab217782ffa8da3b4fab10c758c7ea28cc965`; EN `7bd7e677c9810b9db749896274267000c7c82860b4654b18e1a0aa6902c7f1f7`.

- `runtime.structured-transform`: source `82d6af52293980b103482aacf7c3ac3e512bf0826fb73737cfa821fcd83bc394`; EN `1dd086b9ec375345c06b1c8c9692305d9cb9f9df1665383f4f2967c217f310ce`.

- `tools.schema-guidance`: source `99c2c2db44b3d69bfa77b6da6943527af829254e1cc0fd8629104b061dfea813`; EN `566d7fc6b5f74409e56b379656eb460c2d81b87afc58dba3a950b42cc7fde3fd`.
