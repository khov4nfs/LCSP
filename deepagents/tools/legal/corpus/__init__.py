"""Legal corpus artifact lifecycle capabilities."""

from __future__ import annotations

import sys

from tools.legal.sources.recovery import artifact_store as _artifact_store


# Preserve the existing import path while the recovery store is owned by the
# legal source-recovery capability instead of the corpus package root.
sys.modules[f"{__name__}.artifact_store"] = _artifact_store
