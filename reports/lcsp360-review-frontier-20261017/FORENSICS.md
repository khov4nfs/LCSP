# Source review convergence forensics

SOURCE_REVIEW_CONVERGENCE_ROOT_CAUSE = PROVEN

The prior 152-call run produced23 discovery-operation validation observations:13 INCOMPLETE_STRUCTURAL_ACCOUNTING,7 CLAIM_SCHEMA_INVALID,3 CLAIM_IDENTITY_CONFLICT. It never called full inventory validation/finalization. Required nodes16, final reviewed3, pending13, runtime claims41, frozen rows0. `prior-discovery-forensics.json` captures each observation, preceding tool calls, counts and retained hashes.

## Root cause

`ClaimInventory.__post_init__`, `claim_tools.inspect` and `validateSemanticClaimGraph` require every non-empty node. Five nodes in the actual17-node AST contain only hierarchy headings: two Chapters and Article2/3/6 containers. Their child paragraphs contain the source body. The old16-node denominator therefore includes five independent dispositions that can be supplied as ancestor context instead. The terminal gap, however, was Article1, a genuine body-bearing definitions node and reference target; containers alone do not explain termination.

`claim_tools.review_node` requires the Agent to submit the exact set in `claims_by_node`. It rejects missing/extra/duplicate IDs and inconsistent no-claim reasons, returning only a generic instruction. There is no scheduler or active review unit. `get_claim_inventory(CLAIMS,source_node_id)` can recover IDs through pagination, but the Agent must reconcile them manually. The final three unchanged state/gap hashes caused the working NoProgressDetected guard to terminate. The provider-free before-fix regression matches the actual Article1 gap fingerprint exactly by submitting a subset of two already registered canonical claims. It proves the contract defect without claiming to reconstruct the original omitted/extra payload.

## Requested answers and evidence limits

1. Exactly13 nodes remained unreviewed, including Article1 (node2a9c23e0419e4d0ad7fc65099655ec2ec3466204c14293b26b263989cf121548). The exact other12 cannot be recovered: only counts and aggregate accounting hashes were retained; the ephemeral review dictionary disappeared before freeze. No IDs are invented.
2. The required set includes five heading-only containers,11 body-bearing units, parents and children independently, and explicit-reference targets. Which of the unknown final12 were operative omissions cannot be proven from retained telemetry. Article1 is a body-bearing reference target. The complete required set and structural classifications are retained in JSON.
3. The Agent supplied Article1's exact ID (verified by recomputing its recorded gap hash). Global bounded query tools could return all required node IDs. Original query arguments and returned pages were not retained, so exact knowledge of every ID cannot be proved.
4. A direct review action existed, but required manually enumerating canonical IDs. Feedback supplied neither the expected ID set nor a deterministic next work item. This was an ergonomics/scheduling gap, not an absent mutation method.
5. Successful reviews changed in-memory state; durable progress counts show successful increments and later regressions after new claims. Heading-only/leaf membership was never scheduled independently.
6. Review writes were not persisted transactionally. Only frozen inventory finalization writes to the database; this run had none.
7. The unreviewed query excludes existing review entries, but new claims explicitly remove the corresponding entry and reset it. A processed node can therefore reappear without a durable reopen event/reason. Claim mutations were global.
8. Yes: every non-empty parent and child is required even when a parent's content is only its structural heading.

## Scope before implementation

Change shared contracts, source-review derivation/validation, Preparation persistence/worker commands, native claim tools/phase middleware/instructions, diagnostic lifecycle/harness, fixtures and tests. Preserve document AST identity/parser/content, frozen inventory immutability, downstream authority, no-progress, historical Rule Sets and pins. No production Preparation or authority mutation. Live acceptance is one discovery-only run stopping at frozen inventory.
