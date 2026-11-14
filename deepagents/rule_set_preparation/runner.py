"""Run one claimed Rule Set Preparation: claim -> read pinned legal_source -> author -> submit."""

from __future__ import annotations

import contextvars
import traceback
import json
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import ToolMessage
from langchain_core.runnables.config import var_child_runnable_config
from anthropic import APIError as AnthropicAPIError
from openai import APIError as OpenAIAPIError
from langchain_google_genai.chat_models import GoogleAPIError
from langgraph.errors import GraphRecursionError, NodeCancelledError
from middleware.failure_policy import AgentRunBudgetExceeded, NoProgressDetected, PaidAdmissionError
from middleware.usage_metering import (
    AgentRunState,
    activate_agent_run_state,
    active_agent_run_state,
)
from middleware.durable_budget_kernel import (
    RULE_SET_PREPARATION_SCOPE,
    resolve_workload_limits,
)
from orchestration.agent_stream import DURABLE, active_agent_stream, publish_agent_stream_event
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger

from rule_set_preparation.agent import (
    create_rule_set_preparation_agent,
    ScopeReviewPauseRequired,
    RULE_SET_PREPARATION_ROLE,
    CLAIM_AUTHOR_ROLE,
)
from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.source_graph import GRAPH_TOOL_NAMES, PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext

# Reasons mirror packages/contracts RULE_SET_PREPARATION_FAILURE_REASONS.
NO_SUBMISSION = "NO_SUBMISSION"
NO_OPERATIVE_OBLIGATIONS = "NO_OPERATIVE_OBLIGATIONS"
MODEL_ERROR = "MODEL_ERROR"
SOURCE_VERSION_UNAVAILABLE = "SOURCE_VERSION_UNAVAILABLE"
RUNTIME_ERROR = "RUNTIME_ERROR"

HTTP_CONFLICT = 409

logger = get_logger(__name__)

_TASK = (
    "Prepare the complete compliance rule set for the pinned Legal Source. Resume the durable phase and authoring state. "
    "During discovery call discovery_status, delegate its whole-Article assignments to claim-author tasks, explicitly finalize "
    "the frozen claim inventory, then enter Rule authoring against that revision. "
    "then derive LegalRequirements and AssessmentRules, validate until the packet "
    "passes, then submit it once."
)

_ACTIVITY_TOOLS = frozenset(
    {
        "ls",
        "glob",
        "grep",
        "read_file",
        "task",
        "write_file", "edit_file", "write_todos", "commit_claims", "discovery_status",
        "get_next_legal_analysis_package", "get_rule_set_draft_candidate", "submit_rule_set_draft_candidates", "correct_rule_set_draft_submission",
        "validate_compliance_rule_set",
        "submit_compliance_rule_set",
        "record_preparation_progress",
        "remove_rule_candidate", "get_claim_inventory", "validate_semantic_claim_inventory",
        "finalize_semantic_claim_inventory", "conclude_no_operative_obligations", "reopen_semantic_claim_inventory", "start_rule_authoring",
        "author_legal_requirement", "author_assessment_rule",
        "report_rule_set_source_blocked",
    }
) | GRAPH_TOOL_NAMES
_SOURCE_PATH_RE = re.compile(r"/legal-source/[A-Za-z0-9._/-]{1,200}")


class PreparationStreamTrace(BaseCallbackHandler):
    """Project native tool callbacks into the existing redacted agent stream."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._names: dict[str, str] = {}
        self._subagent_names: dict[str, str] = {}

    def on_tool_start(
        self,
        serialized,
        input_str,
        *,
        run_id,
        parent_run_id=None,
        inputs=None,
        **kwargs,
    ):
        serialized_name = serialized.get("name") if isinstance(serialized, dict) else None
        name = serialized_name or kwargs.get("name")
        if name not in _ACTIVITY_TOOLS:
            return
        native_run_id = str(run_id)
        with self._lock:
            parent_subagent = self._subagent_names.get(str(parent_run_id))
            self._names[native_run_id] = name
        args = inputs if isinstance(inputs, dict) else {}
        data: dict[str, Any] = {"native_tool": name}
        if name == "task":
            subagent = args.get("subagent_type")
            if isinstance(subagent, str) and subagent.strip():
                data["subagent_type"] = subagent.strip()[:120]
                with self._lock:
                    self._subagent_names[native_run_id] = subagent.strip()[:120]
            description = args.get("description")
            if isinstance(description, str):
                source_path = _SOURCE_PATH_RE.search(description)
                if source_path:
                    data["source_path"] = source_path.group(0)
        elif name in {"read_file", "grep", "glob", "ls"}:
            data["scope"] = "/legal-source"
            if parent_subagent:
                data["subagent_type"] = parent_subagent
            path_value = args.get("file_path") or args.get("path")
            if isinstance(path_value, str):
                source_path = _SOURCE_PATH_RE.search(path_value)
                if source_path:
                    data["source_path"] = source_path.group(0)
        publish_agent_stream_event(
            "SEMANTIC_TOOL_CALL",
            tool_name=name,
            tool_call_id=native_run_id,
            subagent_name=data.get("subagent_type") or parent_subagent,
            status="RUNNING",
            data=data,
        )

    def on_tool_end(self, output, *, run_id, **kwargs):
        """Business purpose: Publish a bounded completion/failure event when a tracked native Preparation tool finishes.

        Business rules:
        - Only names recorded from the allowlisted activity tools are emitted; JSON result content contributes only a string outcome, never arbitrary payload data.

        Execution flow:
        1. Remove the tool and subagent identity from the active-call maps under lock.
        2. Ignore untracked names.
        3. Extract a safe outcome when the result is JSON and publish the corresponding TOOL_RESULT event.

        Failure cases:
        - Non-JSON results omit outcome; stream publication errors propagate to the callback runner.

        Side effects:
        - Mutates active-call tracking maps and publishes a tool-result event.
        """
        with self._lock:
            name = self._names.pop(str(run_id), None)
            subagent = self._subagent_names.pop(str(run_id), None)
        if name not in _ACTIVITY_TOOLS:
            return
        data: dict[str, Any] = {"native_tool": name}
        if subagent:
            data["subagent_type"] = subagent
        content = getattr(output, "content", output)
        if isinstance(content, str):
            try:
                result = json.loads(content)
            except (TypeError, ValueError):
                result = None
            if isinstance(result, dict) and isinstance(result.get("outcome"), str):
                data["outcome"] = result["outcome"]
        publish_agent_stream_event(
            "TOOL_RESULT",
            tool_name=name,
            tool_call_id=str(run_id),
            subagent_name=subagent,
            status="FAILED" if isinstance(output, ToolMessage) and output.status == "error" else "COMPLETED",
            data=data,
        )

    def on_tool_error(self, error, *, run_id, **kwargs):
        with self._lock:
            name = self._names.pop(str(run_id), None)
            subagent = self._subagent_names.pop(str(run_id), None)
        if name not in _ACTIVITY_TOOLS:
            return
        data = {"native_tool": name, "error_type": type(error).__name__}
        if subagent:
            data["subagent_type"] = subagent
        publish_agent_stream_event(
            "TOOL_RESULT",
            tool_name=name,
            tool_call_id=str(run_id),
            subagent_name=subagent,
            status="FAILED",
            data=data,
        )

    def active_tool_names(self) -> list[str]:
        """Business purpose: Provide a bounded unique list of native tools currently active for safe failure diagnostics.

        Business rules:
        - Names are read under the callback lock, deduplicated, sorted and capped at 20.

        Execution flow:
        1. Acquire the callback lock.
        2. Collect and sort active tool names.
        3. Return the bounded list.

        Failure cases:
        - An empty active set returns an empty list; no diagnostic is inferred.

        Side effects:
        - None: reads callback state only.
        """
        with self._lock:
            return sorted(set(self._names.values()))[:20]


def _flush_draft(context) -> None:
    """Whatever ended the run, the authored candidates are saved first so the next process resumes them.

    Business purpose: Preserve the current authoring draft before a run exits so a later process can resume accepted candidate work.

    Business rules:
    - Draft flush is attempted only when a ClaimInventory exists; a flush failure must not mask the primary run outcome.

    Execution flow:
    1. Check for an initialized inventory.
    2. Invoke its durable authoring-draft flush.
    3. Log a warning and suppress any flush exception.

    Failure cases:
    - Flush errors are logged and swallowed to preserve the original cancellation/runtime failure.

    Side effects:
    - May persist the current authoring draft and writes a warning log on failure.
    """
    try:
        if context.inventory is not None:
            context.inventory.flush_authoring_draft()
    except Exception:  # noqa: BLE001 - saving must never mask the failure being reported
        logger.warning("RULE_SET_PREPARATION_DRAFT_FLUSH_FAILED", run_id=context.run_id)


def _resolve_preparation_admission_policies(
    model: Any | None,
    credential_salt: str,
    run_id: str,
) -> tuple[Any, ...]:
    """Business purpose: Build verified provider-bound token policies for all permitted preparation routes.

    Business rules:
    - Include primary preparation route, claim-author route, configured model route and all their fallback routes.
    - Validate provider input and output limits from declared route options or model profile; missing or non-positive bounds fail closed.
    - Include all configured credentials per provider to support credential rotation; fail closed if policy set is empty.

    Execution flow:
    1. Resolve candidate routes from the model, rule set preparation role, claim-author role and their fallback chains.
    2. Extract verified provider context window and max output bounds, rejecting unverified or missing bounds.
    3. Generate token policies for each valid route and configured provider credential slot.
    4. Reject empty policy sets with PaidAdmissionError.

    Failure cases:
    - Unverified or non-positive bounds raise PaidAdmissionError('UNVERIFIED_PROVIDER_BOUNDS').
    - Empty policy set raises PaidAdmissionError('UNVERIFIED_POLICY').

    Side effects:
    - Pure in-memory route inspection and policy construction; makes no provider calls or persistent writes.
    """
    from model_policy import (
        load_model_routes,
        fallback_routes,
        model_route_config,
        attach_model_route,
        provider_init_kwargs,
    )
    from provider_credentials import provider_tokens
    from middleware.paid_admission import (
        TokenPolicy,
        request_identity,
    )

    policies: list[TokenPolicy] = []

    # 1. Scripted mock model with _lcsp_route_identity
    if model is not None and hasattr(model, "_lcsp_route_identity") and isinstance(model._lcsp_route_identity, dict):
        ident = dict(model._lcsp_route_identity)
        prof = getattr(model, "profile", None)
        in_b = (prof.get("max_input_tokens") if isinstance(prof, dict) else getattr(prof, "max_input_tokens", None)) or ident.get("input_upper_bound")
        out_b = (prof.get("max_output_tokens") if isinstance(prof, dict) else getattr(prof, "max_output_tokens", None)) or ident.get("output_upper_bound")
        if not isinstance(in_b, int) or in_b <= 0 or not isinstance(out_b, int) or out_b <= 0:
            raise PaidAdmissionError("UNVERIFIED_PROVIDER_BOUNDS", run_id)
        policies.append(
            TokenPolicy(
                route_id=ident["route_id"],
                route_fingerprint=ident["route_fingerprint"],
                credential_fingerprint=ident["credential_fingerprint"],
                endpoint_fingerprint=ident["endpoint_fingerprint"],
                sdk_fingerprint=ident["sdk_fingerprint"],
                provider=ident["provider"],
                protocol=ident["protocol"],
                model=ident["model"],
                valid_from=1,
                expires_at=2147483647,
                input_upper_bound=in_b,
                output_upper_bound=out_b,
            )
        )
    elif (
        model is not None
        and not hasattr(model, "_lcsp_route_identity")
        and model_route_config(model) is None
    ):
        import hashlib
        from middleware.paid_admission import route_fingerprint
        routes_obj = load_model_routes()
        prep_cfg = routes_obj.config(routes_obj.roles.get(RULE_SET_PREPARATION_ROLE, routes_obj.roles["default"]), RULE_SET_PREPARATION_ROLE)
        prof = getattr(model, "profile", None)
        in_b = (prof.get("max_input_tokens") if isinstance(prof, dict) else getattr(prof, "max_input_tokens", None)) or prep_cfg.options.get("context_window_tokens", 1000000)
        out_b = (prof.get("max_output_tokens") if isinstance(prof, dict) else getattr(prof, "max_output_tokens", None)) or prep_cfg.options.get("max_output_tokens", 65536)
        if not isinstance(in_b, int) or in_b <= 0 or not isinstance(out_b, int) or out_b <= 0:
            raise PaidAdmissionError("UNVERIFIED_PROVIDER_BOUNDS", run_id)
        ident = {
            "route_id": prep_cfg.route_id,
            "route_fingerprint": route_fingerprint(prep_cfg),
            "credential_fingerprint": hashlib.pbkdf2_hmac("sha256", b"scripted-fixture-token", bytes.fromhex(credential_salt), 600000).hex(),
            "endpoint_fingerprint": hashlib.sha256(b"http://localhost").hexdigest(),
            "sdk_fingerprint": "0" * 64,
            "provider": prep_cfg.provider,
            "protocol": prep_cfg.protocol,
            "model": prep_cfg.model,
            "input_upper_bound": in_b,
            "output_upper_bound": out_b,
        }
        model._lcsp_route_identity = ident
        policies.append(
            TokenPolicy(
                route_id=ident["route_id"],
                route_fingerprint=ident["route_fingerprint"],
                credential_fingerprint=ident["credential_fingerprint"],
                endpoint_fingerprint=ident["endpoint_fingerprint"],
                sdk_fingerprint=ident["sdk_fingerprint"],
                provider=ident["provider"],
                protocol=ident["protocol"],
                model=ident["model"],
                valid_from=1,
                expires_at=2147483647,
                input_upper_bound=in_b,
                output_upper_bound=out_b,
            )
        )

    # 2. Production ChatModel with _lcsp_resolved_model_route
    model_cfg = model_route_config(model) if model is not None else None
    if model is not None and model_cfg is not None:
        try:
            ident = request_identity(model, credential_salt)
            prof = getattr(model, "profile", None)
            in_b = model_cfg.options.get("context_window_tokens") or (prof.get("max_input_tokens") if isinstance(prof, dict) else getattr(prof, "max_input_tokens", None))
            out_b = model_cfg.options.get("max_output_tokens") or (prof.get("max_output_tokens") if isinstance(prof, dict) else getattr(prof, "max_output_tokens", None))
            if not isinstance(in_b, int) or in_b <= 0 or not isinstance(out_b, int) or out_b <= 0:
                raise PaidAdmissionError("UNVERIFIED_PROVIDER_BOUNDS", run_id)
            policies.append(
                TokenPolicy(
                    route_id=ident["route_id"],
                    route_fingerprint=ident["route_fingerprint"],
                    credential_fingerprint=ident["credential_fingerprint"],
                    endpoint_fingerprint=ident["endpoint_fingerprint"],
                    sdk_fingerprint=ident["sdk_fingerprint"],
                    provider=ident["provider"],
                    protocol=ident["protocol"],
                    model=ident["model"],
                    valid_from=1,
                    expires_at=2147483647,
                    input_upper_bound=in_b,
                    output_upper_bound=out_b,
                )
            )
        except PaidAdmissionError:
            raise
        except Exception:
            pass

    # 3. Permitted routes from model_routes.yaml
    routes_obj = load_model_routes()
    candidate_configs: list[Any] = []
    prep_cfg = routes_obj.config(routes_obj.roles.get(RULE_SET_PREPARATION_ROLE, routes_obj.roles["default"]), RULE_SET_PREPARATION_ROLE)
    claim_cfg = routes_obj.config(routes_obj.roles.get(CLAIM_AUTHOR_ROLE, routes_obj.roles["default"]), CLAIM_AUTHOR_ROLE)
    candidate_configs.extend([prep_cfg, claim_cfg])
    if model_cfg is not None:
        candidate_configs.append(model_cfg)

    all_configs: list[Any] = []
    seen_route_ids: set[str] = set()
    for cfg in candidate_configs:
        if cfg.route_id not in seen_route_ids:
            seen_route_ids.add(cfg.route_id)
            all_configs.append(cfg)
        for fb_cfg in fallback_routes(cfg.route_id):
            if fb_cfg.route_id not in seen_route_ids:
                seen_route_ids.add(fb_cfg.route_id)
                all_configs.append(fb_cfg)

    for cfg in all_configs:
        in_b = cfg.options.get("context_window_tokens")
        out_b = cfg.options.get("max_output_tokens")
        if model is not None and model_cfg is not None and model_cfg.route_id == cfg.route_id:
            prof = getattr(model, "profile", None)
            if in_b is None:
                in_b = prof.get("max_input_tokens") if isinstance(prof, dict) else getattr(prof, "max_input_tokens", None)
            if out_b is None:
                out_b = prof.get("max_output_tokens") if isinstance(prof, dict) else getattr(prof, "max_output_tokens", None)
        if not isinstance(in_b, int) or in_b <= 0 or not isinstance(out_b, int) or out_b <= 0:
            raise PaidAdmissionError("UNVERIFIED_PROVIDER_BOUNDS", run_id)

        tokens = provider_tokens(cfg.provider)
        for token in tokens:
            try:
                kwargs = provider_init_kwargs(cfg.provider, cfg.protocol)
                base_url = kwargs.get("base_url")
                if cfg.protocol == "openai":
                    from langchain_openai import ChatOpenAI
                    m_inst = ChatOpenAI(model=cfg.model, api_key=token, base_url=base_url, max_retries=0)
                elif cfg.protocol == "anthropic":
                    from langchain_anthropic import ChatAnthropic
                    m_inst = ChatAnthropic(model=cfg.model, api_key=token, base_url=base_url, max_retries=0)
                elif cfg.protocol == "google_genai":
                    from langchain_google_genai import ChatGoogleGenerativeAI
                    m_inst = ChatGoogleGenerativeAI(model=cfg.model, api_key=token, max_retries=1)
                else:
                    m_inst = None
                if m_inst is not None:
                    attach_model_route(m_inst, cfg)
                    ident = request_identity(m_inst, credential_salt)
                    policies.append(
                        TokenPolicy(
                            route_id=ident["route_id"],
                            route_fingerprint=ident["route_fingerprint"],
                            credential_fingerprint=ident["credential_fingerprint"],
                            endpoint_fingerprint=ident["endpoint_fingerprint"],
                            sdk_fingerprint=ident["sdk_fingerprint"],
                            provider=ident["provider"],
                            protocol=ident["protocol"],
                            model=ident["model"],
                            valid_from=1,
                            expires_at=2147483647,
                            input_upper_bound=in_b,
                            output_upper_bound=out_b,
                        )
                    )
            except Exception:
                pass

    deduped: dict[tuple[str, str], TokenPolicy] = {}
    for p in policies:
        key = (p.route_id, p.credential_fingerprint)
        if key not in deduped:
            deduped[key] = p
    result = tuple(deduped.values())
    if not result:
        raise PaidAdmissionError("UNVERIFIED_POLICY", run_id)
    return result


def run_rule_set_preparation(
    api: Any,
    run_id: str,
    *,
    model: Any | None = None,
    work_dir: Path | None = None,
    callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Execute one run and return ``{"state": ..., "submission": ..., "failureReason": ...}``.

    The API owns every state transition: an activated or invalid submission is recorded by
    the submit transaction itself; this function records ``FAILED`` only when the agent
    explicitly reported a blocked source or encountered a model/runtime/legal-source error.

    Business purpose: Claim and execute one governed Rule Set Preparation run, returning its authoritative lifecycle outcome and submission evidence.

    Business rules:
    - The API claim is the single execution gate; extraction gaps stop before model calls, source pins remain fixed, and only API callbacks authorize durable lifecycle transitions.
    - Budget exhaustion pauses the run; cancellation is re-raised; provider/runtime errors are classified without exposing provider payloads.

    Execution flow:
    1. Claim the run and stop on duplicate delivery; classify unavailable source pins as failure.
    2. Build the pinned source graph, reject extraction gaps, materialize source files and restore inventory/draft/frontier state.
    3. Construct and invoke the native Preparation agent with isolated runnable config and stream tracing.
    4. Flush the draft on cancellation, pause on configured budget exhaustion, or record safe failure diagnostics and fail the run.
    5. Return the recorded no-obligation, discovery-ready, no-submission or validated submission outcome.

    Failure cases:
    - Source claim/materialization, extraction, agent construction, model/provider, runtime, callback or submission errors return the specific failed/paused/ready state; an already claimed run performs no duplicate execution.

    Side effects:
    - Claims the run, reads pinned source, materializes local files, restores durable state, runs the model/tool graph, flushes draft state and may call governed fail/submit operations and publish progress events.

    Execute one run and return `{"state": ..., "submission": ..., "failureReason": ...}`.

    The API owns every state transition: an activated or invalid submission is recorded by
    the submit transaction itself; this function records `FAILED` only when the agent
    explicitly reported a blocked source or encountered a model/runtime/legal-source error.
    """
    try:
        bundle = api.claim_rule_set_preparation(run_id)
    except WorkerCallbackError as error:
        if error.status_code == HTTP_CONFLICT:
            # A duplicated or redelivered command: the run is already claimed (or finished). The
            # claim is the single paid-run gate, so this delivery stops here and records nothing.
            logger.info("RULE_SET_PREPARATION_ALREADY_CLAIMED", run_id=run_id)
            return {"state": "ALREADY_CLAIMED", "submission": None, "failureReason": None}
        _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": SOURCE_VERSION_UNAVAILABLE}
    except Exception:  # noqa: BLE001 - unavailable source is a terminal worker outcome
        _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": SOURCE_VERSION_UNAVAILABLE}

    context = RuleSetPreparationContext(run_id=run_id, api=api, direct_draft=bundle.get("executionContract") == "DIRECT_DRAFT_V1", target_date=bundle.get("targetDate"), target_activity_scope=bundle.get("targetActivityScope", "FULL_SOURCE"), response_language=bundle.get("responseLanguage", "vi"), scope_review_requested=bundle.get("scopeReviewRequested", False), approved_scope_digest=bundle.get("approvedScopeDigest"))
    if bundle.get("cumulativeUsage"):
        context.adopt_usage(bundle["cumulativeUsage"])
    with tempfile.TemporaryDirectory(prefix="lcsp-rule-set-preparation-") as scratch:
        root = work_dir or Path(scratch)
        failure_stage = "SOURCE_MATERIALIZATION"
        stream_trace: PreparationStreamTrace | None = None
        try:
            context.source_graph = PinnedSourceGraph(bundle["documentGraph"], [
                {**chunk, "documentId": document["documentId"], "legalSourceVersionId": bundle["legalSourceVersionId"]}
                for document in bundle["documents"] for chunk in document["chunks"]
            ])
            # A partly extracted legal source cannot prove source completeness. Stop
            # before paying for model calls or asking the Producer to invent
            # material from pages or document parts that were not extracted.
            if context.source_graph.extraction_gaps:
                gap_count = len(context.source_graph.extraction_gaps)
                publish_agent_stream_event(
                    "CUSTOM_PROGRESS", status="FAILED", data={
                        "activity_kind": "SOURCE_EXTRACTION_INCOMPLETE",
                        "failure_reason": SOURCE_VERSION_UNAVAILABLE,
                        "extraction_gap_count": gap_count,
                    },
                )
                logger.warning("RULE_SET_PREPARATION_SOURCE_EXTRACTION_INCOMPLETE",
                               run_id=run_id, extraction_gap_count=gap_count)
                _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
                return {
                    "state": "FAILED", "submission": None,
                    "failureReason": SOURCE_VERSION_UNAVAILABLE,
                    "error": {"type": "SourceExtractionIncomplete", "stage": failure_stage,
                              "extractionGapCount": gap_count},
                }
            materialize_legal_source(bundle, root)
            context.source_root = root
            context.restore_usage()
            context.pinned_source_version_id = bundle.get("legalSourceVersionId")
            from rule_set_preparation.claim_inventory import ClaimInventory
            from rule_set_preparation.claim_files import rebuild_claim_files
            context.inventory = ClaimInventory(context, revision=bundle["claimInventoryRevision"], phase=bundle["claimPhase"])
            if bundle.get("operationId"):
                context.inventory.frontier.operation_id = bundle["operationId"]
            if context.direct_draft:
                refused = context.inventory.frontier.restore()
                if refused:
                    raise ValueError("Could not restore persisted source review")
            else:
                rebuild_claim_files(context)
            context.inventory.restore_frozen_inventory(bundle["frozenInventory"])
            if context.direct_draft or context.inventory.frozen:
                context.inventory.restore_authoring_draft()
            publish_agent_stream_event(
                "CUSTOM_PROGRESS",
                status="RUNNING",
                data={
                    "activity_kind": "SOURCE_MATERIALIZED",
                    "source_chunk_count": sum(len(d["chunks"]) for d in bundle["documents"]),
                    "source_node_count": len(bundle["documentGraph"]["nodes"]),
                },
            )
            failure_stage = "AGENT_CONSTRUCTION"
            agent = create_rule_set_preparation_agent(
                context=context, legal_source_root=root, model=model
            )
            stream_trace = PreparationStreamTrace()
            # An independent graph, not a subgraph of the Agent Server run: inheriting that run's
            # runnable config would make the agent and every claim-author child write
            # checkpoints into its Postgres saver, which nothing resumes from (see agent.py).
            workload_limits = resolve_workload_limits(RULE_SET_PREPARATION_SCOPE)
            has_hard_ceiling = any(
                x is not None
                for x in (
                    workload_limits.max_model_calls,
                    workload_limits.max_input_tokens,
                    workload_limits.max_total_tokens,
                )
            )
            current_state = active_agent_run_state()
            if current_state is not None:
                if (current_state.run_id and current_state.run_id != run_id and current_state.preparation_run_id != run_id) or \
                   (current_state.preparation_run_id and current_state.preparation_run_id != run_id):
                    raise PaidAdmissionError("ATTEMPT_IDENTITY", run_id)
                if current_state.admission is not None and current_state.admission.run_id != run_id:
                    raise PaidAdmissionError("ATTEMPT_IDENTITY", run_id)

            admission = None
            if has_hard_ceiling:
                if current_state is not None and current_state.admission is not None:
                    admission = current_state.admission
                else:
                    from middleware.paid_admission import (
                        RunAdmission,
                        TokenRunBudget,
                        parse_run_budget,
                        fingerprint,
                    )
                    from tools.common.capabilities.platform.config import resolve_usage_recovery_store_path
                    from middleware.usage_recovery import _connect
                    from model_policy import DEFAULT_ROUTES_FILE, ROUTES_FILE_ENV
                    import os, hashlib

                    admission_path = resolve_usage_recovery_store_path()
                    budget = None
                    try:
                        with _connect(admission_path) as chk_db:
                            chk_db.execute(
                                "CREATE TABLE IF NOT EXISTS inference_budgets (run_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, envelope TEXT NOT NULL, stopped TEXT)"
                            )
                            existing_row = chk_db.execute(
                                "SELECT envelope FROM inference_budgets WHERE run_id=?", (run_id,)
                            ).fetchone()
                            if existing_row:
                                budget = parse_run_budget(json.loads(existing_row[0]))
                    except Exception:
                        budget = None

                    if budget is None:
                        routes_path = Path(os.environ.get(ROUTES_FILE_ENV) or DEFAULT_ROUTES_FILE)
                        routes_sha = (
                            hashlib.sha256(routes_path.read_bytes()).hexdigest()
                            if routes_path.is_file()
                            else "0" * 64
                        )
                        credential_salt = "0" * 64
                        policies = _resolve_preparation_admission_policies(model, credential_salt, run_id)
                        budget = TokenRunBudget(
                            schema_version=3,
                            run_id=run_id,
                            candidate_sha="0" * 40,
                            model_routes_sha256=routes_sha,
                            credential_salt=credential_salt,
                            valid_from=1,
                            expires_at=None,
                            maximum_calls=workload_limits.max_model_calls,
                            maximum_input_tokens=workload_limits.max_input_tokens,
                            maximum_output_tokens=workload_limits.max_output_tokens,
                            maximum_total_tokens=workload_limits.max_total_tokens,
                            policies=policies,
                        )
                    admission = RunAdmission(
                        admission_path,
                        budget,
                        fingerprint(budget.model_dump(mode="json")),
                    )

            if current_state is None:
                current_state = AgentRunState(
                    run_id=run_id,
                    preparation_run_id=run_id,
                    agent_role="rule_set_preparation_requested",
                    api_client=api if hasattr(api, "post_settled_usage") else None,
                    admission=admission,
                    bounded=has_hard_ceiling,
                )
            else:
                current_state.run_id = run_id
                current_state.preparation_run_id = run_id
                if current_state.api_client is None and hasattr(api, "post_settled_usage"):
                    current_state.api_client = api
                if has_hard_ceiling:
                    current_state.admission = admission
                    current_state.bounded = True

            with activate_agent_run_state(current_state):
                isolated = contextvars.copy_context()
                isolated.run(var_child_runnable_config.set, None)
                failure_stage = "AGENT_GRAPH"
                isolated.run(
                    agent.invoke,
                    {"messages": [{"role": "user", "content": "Prepare the Rule Set Draft directly from the pinned corpus. Resume accepted candidates from PostgreSQL. Get the next bounded legal analysis package, account for its source units, submit requirements and genuine repository rules together, validate and activate through the governed tools." if context.direct_draft else _TASK}]},
                    config=agent_graph_config({"callbacks": [*(callbacks or []), stream_trace]}),
                )
            if context.scope_review_paused:
                return {"state": "PAUSED", "submission": None, "failureReason": None,
                        "scopeReviewRequired": True, "trace": context.trace}
        except ScopeReviewPauseRequired:
            # Server already froze the inventory and atomically put this run
            # into PAUSED; no further model calls or FAILURE callback allowed.
            return {"state": "PAUSED", "submission": None, "failureReason": None,
                    "scopeReviewRequired": True, "trace": context.trace}
        except NodeCancelledError:
            _flush_draft(context)
            raise
        except (AgentRunBudgetExceeded, PaidAdmissionError) as error:
            raw_reason = getattr(error, "reason", None) or "AGENT_BUDGET_REACHED"
            if raw_reason in (
                "DURABILITY",
                "UNVERIFIED_PROVIDER_BOUNDS",
                "ATTEMPT_IDENTITY",
                "UNVERIFIED_POLICY",
                "MISSING_RUN_BUDGET",
                "NO_VALID_TOKEN_POLICIES",
                "BOUNDED_SCOPE_CHANGED",
            ):
                raise
            reason_map = {
                "INPUT_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                "OUTPUT_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                "TOKEN_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                "CALL_LIMIT": "CALL_LIMIT_EXCEEDED",
            }
            pause_reason = reason_map.get(raw_reason, raw_reason)
            context.budget_paused = True
            _flush_draft(context)
            if context.scope_review_paused:
                return {"state": "PAUSED", "submission": None, "failureReason": None,
                        "scopeReviewRequired": True, "trace": context.trace}
            # The API records PAUSED and retains LOAD payloads; no terminal failure callback follows.
            if context.submission is None and context.concluded is None:
                paused = api.fail_rule_set_preparation(run_id, pause_reason)
                if not isinstance(paused, dict) or paused.get("executionState") != "PAUSED":
                    raise RuntimeError("Budget pause callback did not establish PAUSED") from error
                publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                    "durability": DURABLE, "activity_kind": "PREPARATION_PAUSED", "reason": pause_reason})
                return {"state": "PAUSED", "submission": None, "failureReason": None, "trace": context.trace}
        except Exception as error:  # noqa: BLE001 - classify only proven model failures
            if context.scope_review_paused or getattr(context, "budget_paused", False):
                # A concurrent/native completion guard may stop after the API
                # already committed PAUSED; never rewrite it as failed.
                return {"state": "PAUSED", "submission": None, "failureReason": None,
                        "scopeReviewRequired": getattr(context, "scope_review_paused", False), "trace": context.trace}
            budget_err = error if isinstance(error, (AgentRunBudgetExceeded, PaidAdmissionError)) else (error.__cause__ if isinstance(getattr(error, "__cause__", None), (AgentRunBudgetExceeded, PaidAdmissionError)) else None)
            if budget_err is not None:
                raw_reason = getattr(budget_err, "reason", None) or "AGENT_BUDGET_REACHED"
                if raw_reason != "DURABILITY":
                    reason_map = {
                        "INPUT_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                        "OUTPUT_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                        "TOKEN_LIMIT": "TOKEN_LIMIT_EXCEEDED",
                        "CALL_LIMIT": "CALL_LIMIT_EXCEEDED",
                    }
                    pause_reason = reason_map.get(raw_reason, raw_reason)
                    context.budget_paused = True
                    _flush_draft(context)
                    if context.submission is None and context.concluded is None:
                        paused = api.fail_rule_set_preparation(run_id, pause_reason)
                        if not isinstance(paused, dict) or paused.get("executionState") != "PAUSED":
                            raise RuntimeError("Budget pause callback did not establish PAUSED") from budget_err
                        publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={
                            "durability": DURABLE, "activity_kind": "PREPARATION_PAUSED", "reason": pause_reason})
                        return {"state": "PAUSED", "submission": None, "failureReason": None, "trace": context.trace}
            _flush_draft(context)
            # A conclusion the API already recorded is terminal; a later exception cannot turn it into a model/runtime failure.
            if context.submission is None and context.concluded is None:
                active_tool_names = stream_trace.active_tool_names() if stream_trace else []
                session = active_agent_stream.get()
                model_call_diagnostics = session.model_call_diagnostics() if session else {}
                failing_model_call = model_call_diagnostics.get("failing_model_call")
                last_completed_model_call = model_call_diagnostics.get("last_completed_model_call")
                # A concurrent child's success can replace the session's last model diagnostic.
                provider_error = isinstance(error, (OpenAIAPIError, AnthropicAPIError, GoogleAPIError))
                reason = MODEL_ERROR if failing_model_call or provider_error else RUNTIME_ERROR
                category = reason
                if isinstance(error, (GraphRecursionError, AgentRunBudgetExceeded, NoProgressDetected)):
                    reason = RUNTIME_ERROR
                    category = "RUNTIME_ERROR"
                diagnostic = {
                    "durability": DURABLE,
                    "activity_kind": "PREPARATION_FAILURE",
                    "failure_reason": reason,
                    "terminal_stage": failure_stage,
                    "safe_error_category": category,
                    "exception_class": type(error).__name__,
                    "active_tool_names": active_tool_names,
                }
                callback_error = {}
                if isinstance(error, WorkerCallbackError):
                    callback_error["callback_status"] = error.status_code
                    if error.error_code and re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", error.error_code):
                        callback_error["callback_code"] = error.error_code
                diagnostic.update(callback_error)
                if failing_model_call:
                    diagnostic["failing_model_call"] = failing_model_call
                if last_completed_model_call:
                    diagnostic["last_completed_model_call"] = last_completed_model_call
                if model_call_diagnostics.get("active_model_call"):
                    diagnostic["active_model_call"] = model_call_diagnostics["active_model_call"]
                try:
                    publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data=diagnostic)
                except Exception:  # noqa: BLE001 - diagnostics must not mask execution failure
                    pass
                logger.warning("RULE_SET_PREPARATION_AGENT_FAILED", run_id=run_id, **diagnostic)
                _fail(api, run_id, reason)
                safe_error = {"type": type(error).__name__, "stage": failure_stage, **callback_error}
                frames = traceback.extract_tb(error.__traceback__)
                if frames and reason == RUNTIME_ERROR:  # where our own code raised, never its message (provider errors stay opaque)
                    safe_error["where"] = f"{Path(frames[-1].filename).name}:{frames[-1].lineno} {frames[-1].name}"
                if isinstance(error, (GraphRecursionError, AgentRunBudgetExceeded, NoProgressDetected)):
                    safe_error["detail"] = str(error)[:2000]  # our own bounded-failure diagnostics only; provider errors stay opaque
                if isinstance(error, NoProgressDetected):
                    safe_error["message"] = "NO_PROGRESS_DETECTED"
                return {
                    "state": "FAILED",
                    "submission": None,
                    "failureReason": reason,
                    "error": safe_error,
                    "trace": context.trace,
                }

    if context.concluded is not None and context.submission is None:
        # The API recorded the committed inventory and moved the run to FAILED/NO_OPERATIVE_OBLIGATIONS in the same
        # transaction, so there is nothing to report and no Rule Set to submit.
        logger.info("RULE_SET_PREPARATION_CONCLUDED_WITHOUT_OPERATIVE_OBLIGATIONS", run_id=run_id,
                    inventory_fingerprint=context.concluded["fingerprint"], inventory_revision=context.concluded["revision"])
        return {"state": "FAILED", "submission": None, "failureReason": NO_OPERATIVE_OBLIGATIONS, "trace": context.trace}
    if context.discovery_only and context.inventory and context.inventory.frozen:
        return {"state": "CLAIM_INVENTORY_READY", "submission": None, "failureReason": None, "trace": context.trace}
    if context.submission is None:
        reason = NO_SUBMISSION if context.source_blocked is not None else RUNTIME_ERROR
        _fail(api, run_id, reason)
        logger.warning("RULE_SET_PREPARATION_WITHOUT_SUBMISSION", run_id=run_id,
                       failure_reason=reason,
                       source_blocked=context.source_blocked,
                       validation_calls=context.validation_calls,
                       validation_outcome=(context.last_validation or {}).get("outcome"),
                       submission_attempted=any(t.get("tool") == "submit" for t in context.trace))
        return {"state": "FAILED", "submission": None, "failureReason": reason, "trace": context.trace}
    outcome = context.submission.get("validation", {}).get("outcome")
    return {
        "state": "SUCCEEDED" if outcome == "PASSED" else "FAILED",
        "submission": context.submission,
        "failureReason": None if outcome == "PASSED" else "RULE_SET_VALIDATION_FAILED",
    }


def _fail(api: Any, run_id: str, reason: str) -> None:
    try:
        api.fail_rule_set_preparation(run_id, reason)
    except Exception:  # noqa: BLE001,S110 - failure reporting is best effort
        # The run stays RUNNING; the caller's retry/reconciliation sees the same state.
        pass
