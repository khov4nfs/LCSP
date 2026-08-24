from __future__ import annotations

import asyncio
import importlib
import sys
import types
from typing import Any


class _FakeAuth:
    def __init__(self) -> None:
        self.handlers: list[tuple[Any, Any]] = []
        self.on = _FakeOn(self)


class _FakeOn:
    def __init__(self, owner: _FakeAuth) -> None:
        self._owner = owner

    def __call__(self, **kwargs: Any) -> Any:
        def register(handler: Any) -> Any:
            self._owner.handlers.append((kwargs, handler))
            return handler

        return register


class _AuthContext:
    def __init__(self, action: str) -> None:
        self.action = action


def test_identity_registers_langgraph_metadata_authorization_handlers(
    monkeypatch,
) -> None:
    fake_auth = _FakeAuth()

    def build_managed_auth(identity_definition: Any) -> _FakeAuth:
        return fake_auth

    fake_mda_auth_module = types.ModuleType("langgraph_loader_auth")
    fake_mda_auth_module.__file__ = "/tmp/generated/_mda_auth.py"
    fake_mda_auth_module.build_managed_auth = build_managed_auth
    monkeypatch.setitem(sys.modules, "langgraph_loader_auth", fake_mda_auth_module)
    sys.modules.pop("identity", None)

    importlib.import_module("identity")
    fake_mda_auth_module.build_managed_auth(object())

    [metadata_handler] = [
        handler
        for kwargs, handler in fake_auth.handlers
        if kwargs == {"resources": ["assistants", "crons"]}
    ]
    assert asyncio.run(metadata_handler(_AuthContext("read"), {})) is None
    assert asyncio.run(metadata_handler(_AuthContext("search"), {})) is None
    assert asyncio.run(metadata_handler(_AuthContext("delete"), {})) is False
