import asyncio
import os
from pathlib import Path
from typing import Any


class CleanupBlockedError(Exception):
    pass


async def mark_terminal_state(job_id: str, quality_state: str, api_client: Any) -> None:
    attempts = 0
    max_attempts = 3
    while attempts < max_attempts:
        try:
            await api_client.mark_scan_job_complete(job_id, quality_state)
            return
        except Exception as error:
            attempts += 1
            if attempts >= max_attempts:
                raise RuntimeError(
                    f"Callback failed after {max_attempts} attempts: {error}"
                ) from error
            await asyncio.sleep(1)  # simple backoff


def verify_workspace_cleanup_sync(workspace_path: str | os.PathLike[str]) -> bool:
    resolved_path = Path(workspace_path)
    if resolved_path.exists():
        raise CleanupBlockedError(
            f"Workspace still exists after callback: {resolved_path}"
        )
    return True


async def verify_workspace_cleanup(workspace_path: str | os.PathLike[str]) -> bool:
    return verify_workspace_cleanup_sync(workspace_path)
