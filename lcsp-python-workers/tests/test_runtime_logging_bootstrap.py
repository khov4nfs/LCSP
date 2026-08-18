from __future__ import annotations

from unittest.mock import patch

from lcsp_workers import runtime


def test_normal_worker_runtime_always_configures_structured_logging(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_DEV_UNSAFE_TRACE", raising=False)
    monkeypatch.setenv("LOG_LEVEL", "INFO")

    with (
        patch("lcsp_workers.runtime.configure_logging") as configure_logging,
        patch("lcsp_workers.runtime.install_dev_unsafe_instrumentation") as install_trace,
    ):
        runtime._configure_runtime_logging()

    configure_logging.assert_called_once_with("INFO")
    install_trace.assert_not_called()
