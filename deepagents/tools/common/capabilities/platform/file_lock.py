"""Small cross-platform advisory file-lock adapter for worker runtime state."""

from __future__ import annotations

import os
from pathlib import Path
from time import sleep
from typing import TextIO

if os.name == "nt":
    import msvcrt
else:
    import fcntl


def acquire_exclusive_lock(lock_file: TextIO, *, non_blocking: bool = False) -> None:
    """Acquire one exclusive advisory lock, preserving it until release_file_lock."""
    if os.name != "nt":
        operation = fcntl.LOCK_EX | (fcntl.LOCK_NB if non_blocking else 0)
        fcntl.flock(lock_file.fileno(), operation)
        return

    lock_file.seek(0)
    while True:
        try:
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            return
        except OSError as error:
            if non_blocking:
                raise BlockingIOError("exclusive file lock is already held") from error
            sleep(0.05)


def release_file_lock(lock_file: TextIO) -> None:
    """Release an exclusive advisory lock acquired by acquire_exclusive_lock."""
    if os.name != "nt":
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        return

    lock_file.seek(0)
    msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)


def ensure_lock_file(lock_path: Path) -> None:
    """Create a stable lock byte before any Windows handle acquires that byte range."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    if not lock_path.exists():
        lock_path.touch()
    if os.name != "nt" or lock_path.stat().st_size:
        return
    with lock_path.open("a", encoding="utf-8") as lock_file:
        lock_file.write("\0")
        lock_file.flush()
