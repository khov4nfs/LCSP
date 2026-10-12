# Assessment deletion and retention policy

Authority: explicit user decisions for W7 / LCSP-357, 2026-10-09.

Legacy V1 retention is **0 days**, with **no legal hold**. V1-only runtime,
archive, checkpoint, sandbox and customer content may be erased after ownership
classification and the accepted W6 reconciliation proof. Shared or mixed data
must first be separated. Historical SQL migration files remain unchanged.
This authorizes release implementation and disposable/staging verification;
production execution still requires separate deployment authorization.

Canonical V2 assessment-owned customer content retention after an explicit,
tenant-authorized DELETE is **0 days**, with **no default legal hold**. Active
assessments do not expire automatically. No grace period applies.

The canonical deletion command must:

1. Authorize the actor against the assessment owner and commit execution/request
   cancellation and lease revocation before external erasure.
2. Drain native execution, revoke Root and transport access, erase their
   checkpoint namespaces, and delete their verified assessment sandboxes and
   private log/workspace content.
3. Erase owned immutable artifact bytes, retaining a chunk only if another
   assessment owns it. Release remaining billing reservations through the ledger.
4. Transactionally erase assessment-owned Case facts, Evidence including search
   coverage, Human Resolution content, decisions/coverage, artifact metadata,
   runtime/event content and attributable outbox payloads. Erase attributable
   audit payloads. Remove unused assessment-owned repository connection metadata.
5. Preserve another assessment and shared legal portfolios/rules, official legal
   source history, authorization and generic accounting/outbox infrastructure.

An external cleanup failure must not report deletion success. The committed
revocation remains in effect, and repeating the same authorized DELETE finishes
cleanup idempotently. A deleted assessment cannot be fetched or resumed.

Only bounded, content-free deletion/security/accounting receipts may remain:
receipt ID, tenant/actor identity, timestamp, assessment identifier or irreversible
reference, outcome and required billing reference. No repository source, evidence,
HITL answer, report, checkpoint, sandbox, semantic output or raw customer payload
may remain in such receipts.

Shared learning attributable to the deleted assessment must be erased. Only
independently sanitized, non-authoritative heuristics without assessment/customer
attribution may remain. The canonical Root currently has no shared-store writer;
absence and external storage erasure still require release evidence.
