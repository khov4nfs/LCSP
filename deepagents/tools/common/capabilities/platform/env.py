"""Runtime environment loading for LCSP Agent Runtime."""

from __future__ import annotations

from dotenv import find_dotenv, load_dotenv


def load_runtime_env() -> str | None:
    """Load the nearest .env file without overriding process environment."""
    env_file = find_dotenv(usecwd=True)
    if not env_file:
        return None
    load_dotenv(env_file, override=False)
    return env_file
