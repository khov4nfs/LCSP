from __future__ import annotations

import logging
from typing import Any

from lcsp_workers.legal.models.partial_update import PartialUpdateContext
from lcsp_workers.legal.vbpl_effect_detector import detect_effects_from_html

logger = logging.getLogger(__name__)


def build_partial_update_context(
    document_id: str,
    source_url: str,
    base_snapshot_ref: str,
    new_snapshot_ref: str,
    old_html: str,
    new_html: str,
) -> PartialUpdateContext | None:
    """Compare two HTML snapshots and generate a PartialUpdateContext if changes are detected.

    Currently, this relies on VBPL markup effects present in the new HTML.
    If the new HTML contains explicit legal effect observations (e.g., AMENDED, REPEALED),
    those locators are considered changed.
    """
    if old_html == new_html:
        logger.info(
            "NO_CHANGES_DETECTED",
            extra={"document_id": document_id, "new_snapshot_ref": new_snapshot_ref},
        )
        return None

    # Detect effects in the new HTML snapshot
    payload = detect_effects_from_html(document_id, new_html)
    observations = payload.get("observations", [])

    if not observations:
        logger.info(
            "HTML_CHANGED_BUT_NO_LEGAL_EFFECTS_DETECTED",
            extra={"document_id": document_id, "new_snapshot_ref": new_snapshot_ref},
        )
        # We might still want to trigger a partial update if HTML changed significantly,
        # but for now, we rely on the specific markup.
        return None

    changed_locators = set()
    for obs in observations:
        locator = obs.get("locator")
        if locator:
            changed_locators.add(locator)

    context = PartialUpdateContext(
        document_id=document_id,
        source_url=source_url,
        base_snapshot_ref=base_snapshot_ref,
        new_snapshot_ref=new_snapshot_ref,
        changed_locators=tuple(sorted(changed_locators)),
        observations=tuple(observations),
    )

    logger.info(
        "PARTIAL_UPDATE_CONTEXT_BUILT",
        extra={
            "document_id": document_id,
            "changed_locator_count": len(changed_locators),
            "observation_count": len(observations),
        },
    )

    return context
