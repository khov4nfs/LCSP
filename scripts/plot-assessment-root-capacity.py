"""Render derived local measurements, never a live or production screenshot.

Run with matplotlib available:
python scripts/plot-assessment-root-capacity.py reports/lcsp364-adaptive-capacity/native-load.json
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    """Business purpose: Make the captured admission/resource timeline reviewable without inventing metrics.

    Business rules:
    - Only explicitly labelled local provider-free measurements are accepted; unknown samples remain gaps.
    Execution flow:
    1. Validate the recorded scope and physical bounds, then plot capacity and measured resources.
    2. Export labelled PNG/SVG artifacts next to the source capture.
    Failure cases:
    - Missing/invalid captures or out-of-bound execution fail assertions instead of producing a PASS chart.
    Side effects:
    - Writes derived chart files only; does not query production or modify measurements.
    """
    source = Path(sys.argv[1])
    data = json.loads(source.read_text())
    assert data["scope"] == "LOCAL_PROVIDER_FREE_NATIVE_INTEGRATION_NOT_PRODUCTION"
    points = data["timeline"]
    assert points and all(0 <= p["actualRoots"] <= data["physicalCeiling"] for p in points)
    t0 = points[0]["at"]
    times = [(p["at"] - t0) / 60 for p in points]
    def values(key, divisor=1):
        return [p[key] / divisor if p.get(key) is not None else math.nan for p in points]
    fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True, layout="constrained")
    for key, label, color, style in [
        ("queued", "Queued", "#94a3b8", "-"), ("admitted", "Admitted", "#16a34a", "-"),
        ("actualRoots", "Active native Roots", "#2563eb", "-"),
        ("desired", "Desired capacity", "#9333ea", "--"), ("effective", "Effective capacity", "#f97316", ":"),
    ]:
        axes[0].step(times, values(key), where="post", label=label, color=color, linestyle=style, linewidth=1.7)
    axes[0].set(ylabel="Assessments / slots", title="Adaptive admission — two bridge consumers, one Agent Server (physical cap 3)")
    axes[0].legend(loc="upper left", ncols=3, fontsize=9)
    axes[0].set_ylim(bottom=-0.2)
    mem = axes[1].twinx()
    axes[1].plot(times, values("cpuPressure"), color="#dc2626", label="CPU PSI")
    mem.plot(times, values("memoryAvailableBytes", 1024**3), color="#0891b2", label="Available host memory")
    mem.plot(times, values("processRssBytes", 1024**3), color="#475569", label="Aggregate server RSS")
    axes[1].set(ylabel="CPU stall pressure (fraction)")
    mem.set_ylabel("Memory (GiB)")
    axes[1].legend(loc="upper left", fontsize=9)
    mem.legend(loc="upper right", fontsize=9)
    checkpoint = axes[2].twinx()
    axes[2].plot(times, values("dbConnectionRatio"), color="#7c3aed", label="DB connection utilization")
    checkpoint.plot(times, values("checkpointLatencyMs"), color="#d97706", label="Checkpoint latency (observed max)")
    axes[2].set(ylabel="DB utilization (fraction)", xlabel="Minutes since capture start")
    checkpoint.set_ylabel("Checkpoint latency (ms)")
    axes[2].legend(loc="upper left", fontsize=9)
    checkpoint.legend(loc="upper right", fontsize=9)
    previous = None
    for p, at in zip(points, times):
        if p["scenario"] != previous:
            for axis in axes:
                axis.axvline(at, color="#cbd5e1", linewidth=0.8)
            axes[0].text(at + 0.03, axes[0].get_ylim()[1] * 0.66, f"Submit {p['scenario']}", fontsize=9)
            previous = p["scenario"]
    for axis in axes:
        axis.grid(alpha=0.2)
    fig.suptitle("Derived captured measurements · LOCAL PROVIDER-FREE FIXTURE · NOT production / live screenshot", fontsize=12)
    fig.savefig(source.with_name("capacity-timeline.png"), dpi=150)
    fig.savefig(source.with_name("capacity-timeline.svg"))
    plt.close(fig)
    print(json.dumps({"source": str(source), "points": len(points), "matplotlib": matplotlib.__version__, "derived": True}))


if __name__ == "__main__":
    main()
