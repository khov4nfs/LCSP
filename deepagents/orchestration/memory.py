"""LCSP orchestration-memory boundary.

Managed Deep Agents injects a thread checkpointer, which is the supervisor's
short-term/durable execution memory. LCSP assessment, Wizard, legal and evidence
facts remain authoritative in the LCSP API/database and are referenced by pinned
IDs. Deployment-shared MDA long-term memory is intentionally not enabled because
LCSP is multi-tenant and assessment data must never bleed across callers.
"""

from __future__ import annotations


MEMORY_AUTHORITY = "managed-thread-checkpoint+lcsp-authoritative-store"
SHARED_MDA_MEMORY_ENABLED = False

# These categories must never be copied into deployment-shared agent memory.
FORBIDDEN_SHARED_MEMORY_CATEGORIES = frozenset(
    {
        "assessment_data",
        "wizard_answers",
        "repository_evidence",
        "legal_evidence",
        "customer_data",
        "credentials",
    }
)
