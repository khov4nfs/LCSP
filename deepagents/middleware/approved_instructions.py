"""Final model boundary for approved EN instructions and tool metadata.

Tool execution continues through the original graph tools and validators. Only
model-facing descriptions are projected. Unknown tools fail before inference.
"""
from copy import deepcopy
import json
from types import SimpleNamespace
from hashlib import sha256
from pathlib import Path
import os

from langchain.agents.middleware import AgentMiddleware, ModelCallLimitMiddleware, hook_config
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

import runtime_instruction_bundle
from runtime_instruction_bundle import RuntimeInstructionBundleError


def approved_system_entries(text, bundle):
    """Business purpose: Verify a composed internal system prompt against approved source entries.

    Business rules:
    - Only exact approved entry bytes, newline separators and the structural phase-end marker are allowed.
    Execution flow:
    1. Consume the longest matching approved entry until the entire composition is accounted for.
    Failure cases:
    - Unrecognized or edited instruction bytes reject the internal model operation.
    Side effects:
    - None: returns the identities of actual prompt components without rewriting historical data.
    """
    remaining = (text or "").removesuffix("\n<LCSP_PHASE_END>")
    assets = sorted(((identity, bundle.instruction(identity)) for identity in bundle.entries), key=lambda row: len(row[1]), reverse=True)
    resolved = []
    while remaining:
        matched = next(((identity, content) for identity, content in assets if remaining.startswith(content)), None)
        if matched is None and remaining.startswith("\n"):
            remaining = remaining[1:]
            continue
        if matched is None:
            raise RuntimeInstructionBundleError("UNCONTROLLED_INTERNAL_SYSTEM_INSTRUCTION")
        identity, content = matched
        resolved.append(identity)
        remaining = remaining[len(content):]
    return resolved


class ApprovedSummaryInstructions(AgentMiddleware):
    """Final summary-call guard; the serialized conversation remains runtime data."""

    def __init__(self, system_prompt, *, receipt_context=None, receipt_sink=None):
        self.system_prompt = system_prompt
        self.receipt_context = receipt_context
        self.receipt_sink = receipt_sink

    def _request(self, request):
        """Business purpose: Reject uncontrolled system additions or summary-template drift before inference.

        Business rules:
        - The parent role's exact approved instruction composition governs summaries; history cannot become system authority.
        Execution flow:
        1. Validate system entry bytes and the approved template surrounding serialized history, then record actual hashes.
        Failure cases:
        - Extra system messages, tools, edited templates or unknown system bytes fail closed.
        Side effects:
        - Emit an optional immutable operation receipt; make no provider call in this guard.
        """
        bundle = runtime_instruction_bundle.production_runtime_bundle()
        text = request.system_message.content if request.system_message else ""
        if text != (self.system_prompt or "") or request.tools or any(isinstance(message, SystemMessage) for message in request.messages):
            raise RuntimeInstructionBundleError("UNCONTROLLED_SUMMARY_INSTRUCTION")
        identities = approved_system_entries(text, bundle)
        template = json.loads(bundle.instruction("framework.injected-policy"))["summary_prompt"]
        marker = "LCSP_SUMMARY_HISTORY_BOUNDARY_3bcfe235"
        prefix, suffix = template.format(messages=marker).split(marker)
        if len(request.messages) != 1 or not isinstance(request.messages[0], HumanMessage):
            raise RuntimeInstructionBundleError("UNCONTROLLED_SUMMARY_INSTRUCTION")
        prompt = request.messages[0].content
        if not isinstance(prompt, str) or not prompt.startswith(prefix) or not prompt.endswith(suffix):
            raise RuntimeInstructionBundleError("UNCONTROLLED_SUMMARY_TEMPLATE")
        if self.receipt_context is not None:
            from evals.run_manifest import build_runtime_manifest, stable_hash
            receipt = build_runtime_manifest(**self.receipt_context(), model=request.model,
                prompts={"resolved_system_message": text, "summary_template": template}, tools=[], skill_hashes={})
            receipt["resolvedInstructionEntriesSha256"] = {identity: bundle.entries[identity].english_runtime_sha256 for identity in identities}
            receipt["summaryTemplateSha256"] = sha256(template.encode("utf-8")).hexdigest()
            receipt["manifestSha256"] = stable_hash({key: value for key, value in receipt.items() if key != "manifestSha256"})
            if self.receipt_sink is not None:
                self.receipt_sink(receipt)
        return request

    def wrap_model_call(self, request, handler):
        """Business purpose: Dispatch only a verified synchronous summary request.

        Business rules:
        - No downstream inference precedes verification.
        Execution flow:
        1. Verify the request and call the existing governed handler.
        Failure cases:
        - Integrity and downstream failures propagate.
        Side effects:
        - May invoke the governed summary model once.
        """
        return handler(self._request(request))

    async def awrap_model_call(self, request, handler):
        """Business purpose: Dispatch only a verified asynchronous summary request.

        Business rules:
        - Async uses the same byte and provenance checks as sync.
        Execution flow:
        1. Verify the request before awaiting the existing handler.
        Failure cases:
        - Integrity and downstream failures propagate.
        Side effects:
        - May invoke the governed summary model once.
        """
        return await handler(self._request(request))


class ApprovedModelCallLimitMiddleware(ModelCallLimitMiddleware):
    """Preserve native counters and stop routing; govern only the generated end message."""

    @hook_config(can_jump_to=["end"])
    def before_model(self, state, runtime):
        """Business purpose: Return approved budget termination text without changing native limits.

        Business rules:
        - The framework's counters and end/error behavior remain authoritative; no limit is extended.
        Execution flow:
        1. Run native limit validation and replace only its generated terminal message content.
        Failure cases:
        - Native exceptions or missing approved instructions propagate before another model call.
        Side effects:
        - May terminate the child graph; makes no inference or domain decision.
        """
        result = super().before_model(state, runtime)
        if result and result.get("messages"):
            text = json.loads(runtime_instruction_bundle.production_runtime_bundle().instruction("runtime.budget-finalization"))["HARD_STOP"]
            result = {**result, "messages": [AIMessage(content=text)]}
        return result


def approved_tool_specs(tools, bundle):
    """Business purpose: Project the model-facing tool catalog through the verified English bundle.

    Business rules:
    - Tool names and schema constraints remain unchanged; unknown descriptions fail closed.
    Execution flow:
    1. Convert tool specs, replace approved descriptions and recursively project schema guidance.
    Failure cases:
    - Missing instruction entries or unsupported tool specs reject inference.
    Side effects:
    - Create request-local tool specs without modifying registered execution tools.
    """
    from langchain_core.utils.function_calling import convert_to_openai_tool

    root = json.loads(bundle.instruction("assessment-tools.descriptions"))
    root.update(json.loads(bundle.instruction("assessment-tools.upstream")))
    preparation = json.loads(bundle.instruction("preparation-tools.descriptions"))
    schemas = json.loads(bundle.instruction("tools.schema-guidance"))
    native = json.loads(bundle.instruction("framework.injected-policy"))

    def project(node, owner=""):
        """Business purpose: Preserve schema validation while replacing descriptive tool metadata.

        Business rules:
        - Structural constraints remain intact; legacy titles and descriptions cannot select runtime instructions.
        Execution flow:
        1. Walk properties, definitions and composition nodes, adding approved field guidance where declared.
        Failure cases:
        - Invalid schema structures propagate rather than broadening tool permissions.
        Side effects:
        - None: returns a copied schema tree.
        """
        if isinstance(node, list):
            return [project(item, owner) for item in node]
        if not isinstance(node, dict):
            return node
        owner = node.get("title", owner)
        result = {key: deepcopy(value) for key, value in node.items() if key not in {"description", "title", "examples", "example"}}
        if "properties" in result:
            for name, field in result["properties"].items():
                result["properties"][name] = project(field, owner)
                description = schemas.get(f"{owner}.{name}") or native.get("schema." + name)
                if description:
                    result["properties"][name]["description"] = description
        for key in ("$defs", "definitions"):
            if key in result:
                result[key] = {name: project(value, name) for name, value in result[key].items()}
        for key in ("items", "anyOf", "allOf", "oneOf"):
            if key in result:
                result[key] = project(result[key], owner)
        return result

    result = []
    for tool in tools:
        spec = deepcopy(convert_to_openai_tool(tool))
        function = spec.get("function")
        if not function:
            raise RuntimeInstructionBundleError("UNREGISTERED_MODEL_TOOL")
        name = function["name"]
        description = root.get(name) or preparation.get(name) or native.get("tool." + name)
        if name == "delete":
            description = bundle.instruction("framework.file-deletion")
        if not description:
            raise RuntimeInstructionBundleError("INSTRUCTION_ENTRY_MISSING:tool:" + name)
        function["description"] = description
        function["parameters"] = project(function.get("parameters", {}))
        result.append(spec)
    return result


class ApprovedInstructionMiddleware(AgentMiddleware):
    """Innermost guard: framework/profile defaults cannot override bundle text."""

    def __init__(self, source_ids, *, receipt_context=None, receipt_sink=None, presentation_context=None):
        self.source_ids = source_ids
        self.receipt_context = receipt_context
        self.receipt_sink = receipt_sink
        self.presentation_context = presentation_context

    def _request(self, request):
        """Business purpose: Construct the final approved English model request and its actual instruction receipt.

        Business rules:
        - Approval and source integrity precede inference; response language is trusted presentation metadata only.
        Execution flow:
        1. Resolve role entries and tools, add trusted metadata, fingerprint the final configuration and override the request.
        Failure cases:
        - Bundle, language, pin or receipt integrity failures stop dispatch.
        Side effects:
        - Publish the receipt to the run sink and optionally immutable evaluation storage.
        """
        bundle = runtime_instruction_bundle.production_runtime_bundle()
        if any(isinstance(message, SystemMessage) for message in request.messages):
            raise RuntimeInstructionBundleError("UNCONTROLLED_SYSTEM_INSTRUCTION")
        source_ids = self.source_ids() if callable(self.source_ids) else self.source_ids
        text = "\n\n".join(bundle.instruction(identity) for identity in source_ids)
        context = getattr(getattr(request, "runtime", None), "context", None)
        metadata = {key: context.get(key) if isinstance(context, dict) else getattr(context, key, None) for key in ("response_language", "assessment_id", "execution_id", "preparation_run_id")}
        if self.presentation_context is not None:
            metadata.update(self.presentation_context())
        if metadata.get("response_language") not in {"en", "vi"}:
            raise RuntimeInstructionBundleError("TRUSTED_RESPONSE_LANGUAGE_MISSING")
        messages = [*request.messages, HumanMessage(content=json.dumps({"lcspTrustedRuntimeMetadata": metadata}, sort_keys=True))]
        tools = approved_tool_specs(request.tools or [], bundle)
        todo_instruction = None
        if any(item["function"]["name"] == "write_todos" for item in tools):
            todo_instruction = json.loads(bundle.instruction("framework.injected-policy"))["todo_system"]
            text += "\n\n" + todo_instruction
        if self.receipt_context is not None:
            from evals.run_manifest import build_runtime_manifest, settle_runtime_manifest
            metadata = self.receipt_context()
            names = metadata.pop("skill_names", ())
            selected = metadata.pop("selected_skills", {})
            manifest = build_runtime_manifest(**metadata, model=request.model, prompts={"resolved_system_message": text},
                tools=[SimpleNamespace(name=item["function"]["name"], description=item["function"]["description"]) for item in tools],
                skill_hashes={name: sha256(bundle.instruction("skill." + name).encode("utf-8")).hexdigest() for name in names})
            manifest = settle_runtime_manifest(manifest, selected_skill_hashes=selected)
            manifest["toolSchemasSha256"] = {item["function"]["name"]: sha256(json.dumps(item["function"]["parameters"], sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest() for item in tools}
            manifest["resolvedInstructionEntriesSha256"] = {identity: bundle.entries[identity].english_runtime_sha256 for identity in source_ids}
            if todo_instruction is not None:
                manifest["resolvedInstructionEntriesSha256"]["framework.injected-policy:todo_system"] = sha256(todo_instruction.encode("utf-8")).hexdigest()
            from evals.run_manifest import stable_hash
            manifest["manifestSha256"] = stable_hash({key: value for key, value in manifest.items() if key != "manifestSha256"})
            if self.receipt_sink is not None:
                self.receipt_sink(manifest)
            receipt_dir = os.environ.get("LCSP_EVAL_MANIFEST_DIR")
            if receipt_dir:
                from evals.run_manifest import save_runtime_manifest
                save_runtime_manifest(Path(receipt_dir) / f"{manifest['runId']}.{manifest['manifestSha256']}.json", manifest)
        return request.override(system_message=SystemMessage(content=text), tools=tools, messages=messages)

    def wrap_model_call(self, request, handler):
        """Business purpose: Dispatch one synchronous request through the final instruction boundary.

        Business rules:
        - Only the approved request may reach the supplied downstream handler.
        Execution flow:
        1. Resolve the guarded request and invoke the handler.
        Failure cases:
        - Validation or downstream model failures propagate without legacy fallback.
        Side effects:
        - May perform model inference through the governed handler.
        """
        return handler(self._request(request))

    async def awrap_model_call(self, request, handler):
        """Business purpose: Dispatch one asynchronous request through the final instruction boundary.

        Business rules:
        - Async dispatch uses the same approved bytes and integrity rules as synchronous dispatch.
        Execution flow:
        1. Resolve the guarded request and await its downstream handler.
        Failure cases:
        - Bundle, receipt or provider errors propagate without alternate instructions.
        Side effects:
        - May perform asynchronous governed model inference.
        """
        return await handler(self._request(request))
