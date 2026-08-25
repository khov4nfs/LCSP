"""Container entrypoint for the LCSP Managed Deep Agent service."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from collections.abc import Sequence
from pathlib import Path


def main() -> int:
    mda = _mda_executable()
    processes = [
        _start((mda, "dev", "--no-reload", ".")),
        _start(
            (
                sys.executable,
                "-m",
                "tools.common.capabilities.managed.rabbitmq_consumer",
            )
        ),
    ]

    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for process in processes:
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    exit_code = 0
    try:
        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    exit_code = code
                    stop(signal.SIGTERM, None)
                    return exit_code
            time.sleep(0.5)
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()


def _start(args: Sequence[str]) -> subprocess.Popen[bytes]:
    return subprocess.Popen(args, cwd=os.getcwd())


def _mda_executable() -> str:
    sibling = Path(sys.executable).with_name("mda")
    return str(sibling) if sibling.exists() else "mda"


if __name__ == "__main__":
    raise SystemExit(main())
