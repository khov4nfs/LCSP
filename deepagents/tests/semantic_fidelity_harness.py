"""Provider-free semantic regression input, independent of generated acceptance reports."""
import json
import subprocess
from copy import deepcopy
from pathlib import Path

from rule_set_preparation.source_graph import PinnedSourceGraph

ROOT = Path(__file__).resolve().parents[2]
RETAINED = Path(__file__).with_name("fixtures") / "source-semantic-regression.json"


def retained():
    fixture = json.loads(RETAINED.read_text())
    return fixture, PinnedSourceGraph(fixture["source"], fixture["chunks"]), {}
