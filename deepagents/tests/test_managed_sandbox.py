from __future__ import annotations

from managed_deepagents.sandbox import SandboxDefinition

from sandbox import sandbox


def test_sandbox_uses_managed_deep_agents_declaration() -> None:
    assert isinstance(sandbox, SandboxDefinition)
    assert sandbox.options.get("scope", "thread") == "thread"
    assert sandbox.options["default_timeout"] == 300
    managed_provider_keys = set(SandboxDefinition.MANAGED_OPTION_KEYS) - {"scope"}
    assert not managed_provider_keys & sandbox.options.keys()
