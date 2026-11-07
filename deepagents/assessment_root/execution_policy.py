"""Trusted in-process restrictions for an operator-owned native Assessment Root.

An HTTP request cannot select this policy. Normal production runs observe no policy
and retain the existing runner defaults. A trusted native runtime may install one
immutable policy while executing its already admitted physical run.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from functools import partial
from typing import Any

from orchestration.runtime_control import (
    PhysicalRunScope, active_physical_run_scope,
    active_runtime_incarnation_id, active_runtime_run_id,
)


@dataclass(frozen=True)
class NativeRootExecutionPolicy:
    """One trusted assessment/audit command and its additional execution restrictions."""

    assessment_id: str
    audit_request_id: str
    command_key: str
    backend_factory: Callable[..., Any]
    governance: tuple[Any, ...]


_active_policy: ContextVar[NativeRootExecutionPolicy | None] = ContextVar(
    "lcsp_native_root_execution_policy", default=None,
)


@contextmanager
def activate_root_execution_policy(policy: NativeRootExecutionPolicy):
    """Business purpose: Carry trusted operator restrictions through one native run.

    Business rules:
    - Only an in-process policy object is accepted; request dictionaries cannot install it.
    - This scope grants no admission, lease, checkpoint or provider authority.
    Execution flow:
    1. Validate the trusted object and bind it to the current execution context.
    2. Restore the previous context after the native runtime drains or raises.
    Failure cases:
    - An invalid object is rejected before any context is changed.
    Side effects:
    - Temporarily changes a process-local ContextVar; performs no I/O.
    """
    if not isinstance(policy, NativeRootExecutionPolicy):
        raise TypeError("A trusted native Root policy object is required")
    token = _active_policy.set(policy)
    try:
        yield
    finally:
        _active_policy.reset(token)


def root_runner_options(message: Mapping[str, Any], client: Any) -> dict[str, Any]:
    """Business purpose: Apply additional restrictions to the exact admitted audit command.

    Business rules:
    - Without a policy, production runner defaults remain unchanged.
    - Policy use requires exact assessment, audit and canonical command identities.
    - A real native run, incarnation and physical drain scope must already be bound.
    - Every production governance middleware must retain its identity and order.
    Execution flow:
    1. Read the trusted process-local policy and verify message/native bindings.
    2. Check that its governance adds restrictions around the production sequence.
    3. Bind the boundary's actual API client into the restricted backend factory.
    Failure cases:
    - Wrong or missing identities, missing physical scope or downgraded governance fail closed.
    Side effects:
    - Returns runner arguments only; never claims, reserves, resumes or dispatches work.
    """
    policy = _active_policy.get()
    if policy is None:
        return {}
    expected = {
        "assessmentId": policy.assessment_id,
        "auditRequestId": policy.audit_request_id,
        "idempotencyKey": policy.command_key,
    }
    if any(not isinstance(value, str) or not value for value in expected.values()):
        raise ValueError("Native Root policy identities are required")
    if any(message.get(key) != value for key, value in expected.items()):
        raise ValueError("Native Root policy command mismatch")
    if (not active_runtime_run_id.get()
            or not active_runtime_incarnation_id.get()
            or not isinstance(active_physical_run_scope.get(), PhysicalRunScope)):
        raise RuntimeError("Native Root policy requires admitted physical execution")

    from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE

    remaining = iter(policy.governance)
    for required in MODEL_GOVERNANCE_MIDDLEWARE:
        if not any(candidate is required for candidate in remaining):
            raise ValueError("Native Root policy cannot remove or reorder governance")
    return {
        "backend_factory": partial(policy.backend_factory, client),
        "governance": list(policy.governance),
    }
