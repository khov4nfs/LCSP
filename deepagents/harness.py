"""LCSP Deep Agents harness boundary configuration.

This module configures the Deep Agents harness itself. LCSP application tools are
defined separately under ``tools/<node>/<tool-name>/code.py``.
"""

from __future__ import annotations

from deepagents import HarnessProfile, register_harness_profile

from model_policy import load_model_routes

# LCSP intentionally uses the complete Deep Agents harness. Repository analysis runs
# inside an isolated backend per assessment, so filesystem, shell, task/subagent,
# summarization, skills and human-in-the-loop capabilities remain available instead
# of being reimplemented as LCSP-authored repository analyzers.
HIDDEN_BUILTIN_TOOLS = frozenset()
LCSP_HARNESS_PROFILE = HarnessProfile()
LCSP_FILESYSTEM_PERMISSIONS: list = []


def configure_lcsp_harness() -> None:
    """Register the identical LCSP harness profile for every configured model route.

    Models are built per role from the model routes YAML (see ``model_policy``), so no
    provider/model facts live here; every route receives the same restrictions.
    """
    routes = load_model_routes()
    for route in routes.routes.values():
        register_harness_profile(f"{route['provider']}:{route['model']}", LCSP_HARNESS_PROFILE)
