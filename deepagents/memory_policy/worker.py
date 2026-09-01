"""Worker entrypoint for verified episode consolidation."""

from __future__ import annotations

from typing import Any
import os

from .gateway import ApiVerifiedEpisodeGateway, consolidate_verified_episodes, episode_backend
from .models import CAPTURE_PATH_ENV, STORE_PATH_ENV, EpisodeStoreError


def run_verified_episode_consolidation_from_env() -> Any:
    """Run the configured consolidation path.

    Production uses the governed API path. Local JSONL consolidation remains for
    development and regression tests.
    """
    if episode_backend() == "api":
        assessment_id = _required_env("LCSP_VERIFIED_EPISODE_ASSESSMENT_ID")
        user_id = _required_env("LCSP_VERIFIED_EPISODE_USER_ID")
        workflow_run_id = os.environ.get("LCSP_VERIFIED_EPISODE_WORKFLOW_RUN_ID")
        return ApiVerifiedEpisodeGateway().consolidate(
            assessment_id=assessment_id,
            user_id=user_id,
            workflow_run_id=workflow_run_id,
        )

    input_path = os.environ.get(CAPTURE_PATH_ENV)
    output_path = os.environ.get(STORE_PATH_ENV)
    if not input_path or not output_path:
        raise EpisodeStoreError(
            "local verified episode consolidation requires capture and store paths"
        )
    return consolidate_verified_episodes(input_path=input_path, output_path=output_path)


def _required_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise EpisodeStoreError(f"{name} is required for API episode consolidation.")
    return value


__all__ = ["run_verified_episode_consolidation_from_env"]
