"""Managed schedule for legal catalog freshness checks."""

from managed_deepagents import define_schedule


schedule = define_schedule(
    cron="0 2 * * *",
    timezone="Asia/Ho_Chi_Minh",
    prompt=(
        "Check LCSP legal corpus readiness and identify whether any approved "
        "legal catalog maintenance or waiting-run resume action is required."
    ),
)
