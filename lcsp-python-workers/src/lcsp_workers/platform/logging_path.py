import os

def get_repo_root() -> str:
    """Traverse upwards to find pnpm-workspace.yaml, which sits at the repository root."""
    dir_path = os.path.abspath(os.getcwd())
    while dir_path != os.path.dirname(dir_path):
        if os.path.exists(os.path.join(dir_path, "pnpm-workspace.yaml")):
            return dir_path
        dir_path = os.path.dirname(dir_path)
    # Fallback to current working dir
    return os.path.abspath(os.getcwd())

def get_partitioned_log_path(user_id: str, assessment_id: str, is_orchestration: bool) -> str:
    """Get the path to the run.log or orchestration.log file partitioned by user and assessment."""
    repo_root = get_repo_root()
    uid = user_id if user_id and user_id.strip() else "unknown_user"
    aid = assessment_id if assessment_id and assessment_id.strip() else "unknown_assessment"
    filename = "orchestration.log" if is_orchestration else "run.log"
    return os.path.join(repo_root, "tmp", f"user_{uid}", f"assessment_{aid}", filename)

def get_partitioned_graph_path(user_id: str, assessment_id: str, filename: str) -> str:
    """Get the path to a graph source or artifact partitioned by user and assessment under graphs/."""
    repo_root = get_repo_root()
    uid = user_id if user_id and user_id.strip() else "unknown_user"
    aid = assessment_id if assessment_id and assessment_id.strip() else "unknown_assessment"
    return os.path.join(repo_root, "tmp", f"user_{uid}", f"assessment_{aid}", "graphs", filename)
