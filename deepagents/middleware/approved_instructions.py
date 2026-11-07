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

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import SystemMessage, HumanMessage

from runtime_instruction_bundle import production_runtime_bundle, RuntimeInstructionBundleError


def approved_tool_specs(tools, bundle):
    """Preserve JSON-schema constraints while replacing descriptive material."""
    from langchain_core.utils.function_calling import convert_to_openai_tool

    root = json.loads(bundle.instruction("assessment-tools.descriptions"))
    root.update(json.loads(bundle.instruction("assessment-tools.upstream")))
    preparation = json.loads(bundle.instruction("preparation-tools.descriptions"))
    schemas = json.loads(bundle.instruction("tools.schema-guidance"))
    native = json.loads(bundle.instruction("framework.injected-policy"))

    def project(node, owner=""):
        if isinstance(node, list):
            return [project(item, owner) for item in node]
        if not isinstance(node, dict):
            return node
        owner = node.get("title", owner)
        result = {key: deepcopy(value) for key, value in node.items() if key not in {"description", "title"}}
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
        bundle = production_runtime_bundle()
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
        return handler(self._request(request))

    async def awrap_model_call(self, request, handler):
        return await handler(self._request(request))
