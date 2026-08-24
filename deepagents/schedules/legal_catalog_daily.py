"""Managed schedule for proactive legal-intelligence maintenance."""

from managed_deepagents import define_schedule


schedule = define_schedule(
    cron="0 2 * * *",
    timezone="Asia/Ho_Chi_Minh",
    prompt=(
        "Run LCSP in LEGAL_MAINTENANCE mode. Delegate first to the `triage` subagent. "
        "The cycle must proactively refresh only approved legal source manifests, detect "
        "source changes, preserve exact partial-update scope, rebuild/activate a corpus only "
        "when content changed, and resume compatible waiting runs after deterministic validation. "
        "Do not start Context Wizard, Planner, Investigator, Resolver, or an assessment flow. "
        "Do not use targeted repository reanalysis as a substitute for legal maintenance."
    ),
)
