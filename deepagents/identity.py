"""Managed Deep Agents identity configuration for LCSP."""

import sys
from collections.abc import Iterable
from pathlib import Path
from types import ModuleType
from typing import Any

from managed_deepagents import auth, define_identity


def _install_langgraph_metadata_authorization_handlers() -> None:
    auth_modules = list(_iter_mda_auth_modules())
    if not auth_modules:
        return
    for auth_module in auth_modules:
        _patch_build_managed_auth(auth_module)


def _iter_mda_auth_modules() -> Iterable[ModuleType]:
    for module in sys.modules.values():
        if not isinstance(module, ModuleType):
            continue
        if getattr(module, "_lcsp_metadata_auth_patched", False):
            continue
        module_file = getattr(module, "__file__", None)
        if module_file and Path(module_file).name == "_mda_auth.py":
            yield module


def _patch_build_managed_auth(auth_module: ModuleType) -> None:
    original_build_managed_auth = getattr(auth_module, "build_managed_auth", None)
    if original_build_managed_auth is None:
        return

    def build_managed_auth_with_metadata_handlers(identity_definition: Any) -> Any:
        managed_auth = original_build_managed_auth(identity_definition)
        managed_auth.on(resources=["assistants", "crons"])(
            _authorize_deployment_metadata,
        )
        return managed_auth

    auth_module.build_managed_auth = build_managed_auth_with_metadata_handlers
    auth_module._lcsp_metadata_auth_patched = True


async def _authorize_deployment_metadata(ctx: Any, value: Any) -> bool | None:
    if getattr(ctx, "action", None) in {"read", "search"}:
        return None
    return False


_install_langgraph_metadata_authorization_handlers()

identity = define_identity(auth=auth.langsmith_api_key())
