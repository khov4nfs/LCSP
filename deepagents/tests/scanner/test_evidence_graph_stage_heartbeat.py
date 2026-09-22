"""Evidence-graph builds must stay visibly alive while they run.

The API fails a scan whose latest runtime event is older than its stale window.
A repository-sized graph build is a single tool call that runs for tens of
minutes, and one of its stages alone can outlast that window, so a timer sends
the current stage for as long as the build runs.
"""

import threading
import time
from pathlib import Path

from tools.common.capabilities.evidence.graph.construction.assembly.assembler import (
    EVIDENCE_GRAPH_ASSEMBLY_STAGES,
    ProgramGraphAssembler,
)
from tools.common.capabilities.evidence.scanner.scanning.scan_boundary import (
    EVIDENCE_GRAPH_HEARTBEAT_INTERVAL_SECONDS,
    _EvidenceGraphHeartbeat,
)


def test_assembly_reports_every_stage_once_and_in_order(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text("const x = 1;\n", encoding="utf-8")
    reported: list[tuple[str, int, int]] = []

    ProgramGraphAssembler().assemble(
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        workspace_path=tmp_path,
        on_stage=lambda name, index, total: reported.append((name, index, total)),
    )

    total = len(EVIDENCE_GRAPH_ASSEMBLY_STAGES)
    assert reported == [
        (name, position, total)
        for position, name in enumerate(EVIDENCE_GRAPH_ASSEMBLY_STAGES, start=1)
    ]


def test_assembly_without_a_stage_callback_is_unchanged(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text("const x = 1;\n", encoding="utf-8")

    graph = ProgramGraphAssembler().assemble(
        scan_job_id="scan-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        workspace_path=tmp_path,
    )

    assert graph.node_count > 0


class _Emitter:
    """Records heartbeats and lets a test wait for them without sleeping blindly."""

    def __init__(self, fail: bool = False) -> None:
        self.stages: list[str] = []
        self.fail = fail
        self.delivered = threading.Semaphore(0)

    def __call__(self, stage: str) -> None:
        self.stages.append(stage)
        self.delivered.release()
        if self.fail:
            raise RuntimeError("API unavailable")

    def wait_for(self, count: int, timeout: float = 5.0) -> None:
        for _ in range(count):
            assert self.delivered.acquire(timeout=timeout), "heartbeat was not sent"


INTERVAL = 0.02


def test_heartbeat_keeps_ticking_inside_a_single_long_stage() -> None:
    emitter = _Emitter()

    with _EvidenceGraphHeartbeat(emitter, INTERVAL) as heartbeat:
        heartbeat.report("semantic extraction", 1, 16)
        # One stage spanning several intervals must still produce heartbeats,
        # otherwise a long extraction outlives the API stale window.
        emitter.wait_for(3)

    assert emitter.stages[:3] == ["semantic extraction (1/16)"] * 3


def test_heartbeat_reports_the_stage_currently_running() -> None:
    emitter = _Emitter()

    with _EvidenceGraphHeartbeat(emitter, INTERVAL) as heartbeat:
        heartbeat.report("semantic extraction", 1, 16)
        emitter.wait_for(1)
        heartbeat.report("AI discovery", 7, 16)
        emitter.wait_for(2)

    assert emitter.stages[-1] == "AI discovery (7/16)"


def test_heartbeat_stops_when_the_build_ends() -> None:
    emitter = _Emitter()

    with _EvidenceGraphHeartbeat(emitter, INTERVAL) as heartbeat:
        heartbeat.report("graph build and validation", 16, 16)
        emitter.wait_for(1)
    delivered = len(emitter.stages)

    time.sleep(INTERVAL * 5)
    assert len(emitter.stages) == delivered, "no heartbeat after the build ended"


def test_undeliverable_heartbeat_never_fails_the_build() -> None:
    emitter = _Emitter(fail=True)

    with _EvidenceGraphHeartbeat(emitter, INTERVAL):
        emitter.wait_for(2)


def test_heartbeat_interval_stays_inside_the_default_stale_window() -> None:
    default_stale_window_seconds = 5 * 60
    assert EVIDENCE_GRAPH_HEARTBEAT_INTERVAL_SECONDS < default_stale_window_seconds / 2


def test_builder_hashes_each_source_file_once(tmp_path: Path, monkeypatch) -> None:
    from tools.common.capabilities.evidence.graph.construction.assembly.builder import (
        ProgramGraphBuilder,
    )

    source = tmp_path / "app.js"
    source.write_text("const a = 1;\n", encoding="utf-8")
    builder = ProgramGraphBuilder(
        tmp_path, scan_job_id="scan-1", snapshot_id="snapshot-1", commit_sha="abc"
    )
    reads: list[Path] = []
    original = Path.read_bytes

    def counting_read(self: Path) -> bytes:
        reads.append(self)
        return original(self)

    monkeypatch.setattr(Path, "read_bytes", counting_read)

    first = builder._file_hash("app.js")
    for _ in range(50):
        assert builder._file_hash("app.js") == first

    assert len(reads) == 1
    assert first.startswith("sha256:")
