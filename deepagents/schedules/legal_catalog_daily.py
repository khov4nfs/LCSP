"""Legal catalog maintenance prompt for application-owned schedulers."""

LEGAL_CATALOG_MAINTENANCE_CRON = "0 2 * * *"
LEGAL_CATALOG_MAINTENANCE_TIMEZONE = "Asia/Ho_Chi_Minh"
LEGAL_CATALOG_MAINTENANCE_PROMPT = (
        "Run LCSP in LEGAL_MAINTENANCE mode. Delegate the full legal-preparation cycle "
        "to the `triage` subagent. This is the SCHEDULED trigger. Claim the global Triage "
        "singleton, then call `maintain_legal_catalog` with `max_runs=0` so legal maintenance "
        "cannot resume an Assessment before EngineeringRules are READY. Refresh only approved "
        "official legal source manifests, crawl within governed source boundaries, compare "
        "content hashes, preserve PartialUpdateContext for changed sources, and rebuild/activate "
        "the legal corpus/catalog only when content changed. Then load pending or affected Legal "
        "Rule Triage work items for approved LegalRules. For each ready pending item, read the "
        "exact authoritative legal chunks, apply the legal-rule-triage skill, decide exactly one "
        "verdict per chunk (ENGINEERING_RULE_CANDIDATE, CONTEXT_ONLY, or REJECT), and for Candidate "
        "chunks prepare reusable EngineeringRule proposals before persisting the result through "
        "the deterministic triage boundary. Skip items already completed for the same governed "
        "source fingerprint; changed legal content or rule identity must be triaged again. The "
        "schedule and Triage reasoning never select or inspect customer Assessments. After "
        "`finish_legal_rule_triage_execution` releases the singleton, deterministic orchestration "
        "reconciles every Assessment checkpoint currently waiting on EngineeringRule readiness. "
        "An Assessment whose pre-analysis readiness gate finds missing READY EngineeringRules "
        "automatically checkpoints and emits its own bounded ENGINEERING_RULE_NOT_READY Triage "
        "trigger; no admin/operator manual trigger is required. Do not start Context Wizard, "
        "Repository Analyst, Resolver, or any customer assessment flow from Triage reasoning. "
        "Do not use customer assessment context, repository findings, user answers, or targeted "
        "repository reanalysis to make Legal Rule Triage decisions."
)


__all__ = [
    "LEGAL_CATALOG_MAINTENANCE_CRON",
    "LEGAL_CATALOG_MAINTENANCE_PROMPT",
    "LEGAL_CATALOG_MAINTENANCE_TIMEZONE",
]
