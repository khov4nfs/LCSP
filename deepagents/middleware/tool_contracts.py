"""Read the argument contract of every tool a model request carries, whatever form it takes.

A model request lists its tools as native ``BaseTool`` objects, as OpenAI-style function dicts, as
Anthropic ``input_schema`` dicts, or as the provider-dialect dicts a compatibility middleware
produced (the Gemini rewrite replaces every ``BaseTool`` with a dict). The governance pre-check must
judge a sample the same way in all of those forms, so it reads the contract through this module and
never inspects the tool objects itself.

Nothing here reads an argument *value* into its output: a problem is ``<field path>:<error kind>``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from langchain_core.tools import BaseTool
from pydantic import ValidationError

MAX_REPORTED_PROBLEMS = 8

# A provider compatibility middleware may replace ``request.tools`` with provider-dialect dicts. It
# publishes the tools it received here, so a check running inside it still reads the real contracts.
ORIGINAL_REQUEST_TOOLS: ContextVar[tuple[Any, ...] | None] = ContextVar(
    "lcsp_original_request_tools", default=None
)


@dataclass(frozen=True)
class ToolContract:
    name: str
    # ``<field path>:<error kind>`` for each way the arguments break the contract; empty when valid.
    problems: Callable[[Any], list[str]]
    # The tool answers invalid arguments itself (``BaseTool.handle_validation_error``), so the model
    # receives correction feedback from it and the sample must not be discarded beforehand.
    answers_invalid_arguments: bool = False


def request_tool_contracts(request: Any) -> dict[str, ToolContract]:
    """Argument contracts of the request's tools, keyed by tool name."""
    tools: Iterable[Any] | None = ORIGINAL_REQUEST_TOOLS.get()
    if tools is None:
        tools = getattr(request, "tools", None) or ()
    contracts: dict[str, ToolContract] = {}
    for tool in tools:
        contract = _contract_of(tool)
        if contract is not None:
            contracts[contract.name] = contract
    return contracts


def _contract_of(tool: Any) -> ToolContract | None:
    if isinstance(tool, BaseTool):
        schema = tool.tool_call_schema
        # The pre-check mirrors what the tool node enforces. A native tool declared with a plain
        # JSON schema is not validated by the node (its body answers a bad argument itself), so
        # discarding its sample here would only change that tool's established behaviour.
        if hasattr(schema, "model_validate"):
            full_schema = tool.get_input_schema()
            # LangChain's subset drops model validators/config, including extra="forbid".
            if schema.model_fields.keys() == full_schema.model_fields.keys():
                schema = full_schema
            return ToolContract(
                tool.name, _pydantic_problems(schema), bool(tool.handle_validation_error)
            )
        return None
    if isinstance(tool, dict):
        parts = _dict_tool_parts(tool)
        if parts is not None:
            return _json_schema_contract(parts[0], parts[1], False)
    return None


def _dict_tool_parts(tool: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """Name and argument JSON Schema of an OpenAI function dict, an Anthropic tool or a flat declaration."""
    function = tool.get("function") if isinstance(tool.get("function"), dict) else tool
    name = function.get("name")
    schema = function.get("parameters") or function.get("input_schema") or tool.get("input_schema")
    if isinstance(name, str) and name and isinstance(schema, dict):
        return name, schema
    return None


def _pydantic_problems(schema: Any) -> Callable[[Any], list[str]]:
    def problems(args: Any) -> list[str]:
        try:
            schema.model_validate(args)
        except ValidationError as error:
            return [
                f"{'.'.join(str(part) for part in item['loc'])}:{item['type']}"
                for item in error.errors()[:MAX_REPORTED_PROBLEMS]
            ]
        return []

    return problems


def _provider_neutral(schema: Any) -> Any:
    """Undo the Gemini dialect (``"type": "NULL"``) so the schema is plain JSON Schema again."""
    if isinstance(schema, dict):
        return {
            key: "null" if key == "type" and value == "NULL" else _provider_neutral(value)
            for key, value in schema.items()
        }
    if isinstance(schema, list):
        return [_provider_neutral(value) for value in schema]
    return schema


def _json_schema_contract(name: str, schema: dict[str, Any], answers: bool) -> ToolContract | None:
    neutral = _provider_neutral(schema)
    try:
        Draft202012Validator.check_schema(neutral)
    except SchemaError:
        # A contract that cannot be read is not a reason to discard a sample: the tool node still
        # validates the arguments authoritatively, so this stays fail-closed.
        return None
    validator = Draft202012Validator(neutral)

    def problems(args: Any) -> list[str]:
        found: list[str] = []
        for error in sorted(validator.iter_errors(args), key=lambda item: [str(p) for p in item.absolute_path]):
            path = [str(part) for part in error.absolute_path]
            if error.validator == "required" and isinstance(error.instance, dict):
                found.extend(
                    ".".join([*path, str(field)]) + ":missing"
                    for field in error.validator_value
                    if field not in error.instance
                )
            else:
                found.append((".".join(path) or "<root>") + f":{error.validator}")
        return found[:MAX_REPORTED_PROBLEMS]

    return ToolContract(name, problems, answers)
