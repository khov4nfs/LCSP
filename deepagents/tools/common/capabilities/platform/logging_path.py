import os
from pathlib import Path
import re
import shutil


def get_repo_root() -> str:
    """Traverse upwards to find pnpm-workspace.yaml, which sits at the repository root."""
    dir_path = os.path.abspath(os.getcwd())
    while dir_path != os.path.dirname(dir_path):
        if os.path.exists(os.path.join(dir_path, "pnpm-workspace.yaml")):
            return dir_path
        dir_path = os.path.dirname(dir_path)
    # Fallback to current working dir
    return os.path.abspath(os.getcwd())


def get_partitioned_log_path(
    user_id: str,
    assessment_id: str,
    is_orchestration: bool,
) -> str:
    """Get the run.log/orchestration.log path partitioned by user and assessment."""
    repo_root = get_repo_root()
    uid = user_id if user_id and user_id.strip() else "unknown_user"
    aid = assessment_id if assessment_id and assessment_id.strip() else "unknown_assessment"
    if not all(re.fullmatch(r"[A-Za-z0-9_-]{1,300}", value) for value in (uid, aid)):
        raise ValueError("Invalid assessment log ownership")
    filename = "orchestration.log" if is_orchestration else "run.log"
    return os.path.join(
        repo_root,
        "tmp",
        f"user_{uid}",
        f"assessment_{aid}",
        filename,
    )


def erase_assessment_logs(owner_id: str, assessment_id: str) -> None:
    if not all(re.fullmatch(r"[A-Za-z0-9_-]{1,300}", value) for value in (owner_id, assessment_id)):
        raise ValueError("Invalid assessment log ownership")
    # Early worker events can precede owner attribution, but still belong to the same assessment.
    targets = [Path(get_repo_root()) / "tmp" / f"user_{user}" / f"assessment_{assessment_id}"
               for user in {owner_id, "unknown_user"}]
    for target in targets:
        if any(path.is_symlink() for path in (target, *target.parents)):
            raise ValueError("Invalid assessment log erasure target")
        if target.exists() and not target.is_dir():
            raise ValueError("Invalid assessment log erasure target")
    for target in targets:
        if target.exists():
            shutil.rmtree(target)
