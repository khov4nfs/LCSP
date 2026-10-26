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
    """Business purpose: Provide the structured-output guard with normalized argument contracts for the tools in a model request.

    Business rules:
    - Prefer the original tool declarations published by provider-compatibility middleware; otherwise use request.tools.
    - Include only tool forms this module can validate and key accepted contracts by tool name.

    Execution flow:
    1. Read original tools from context when published, otherwise read the request's current tools.
    2. Normalize each tool through _contract_of and store supported contracts by name.
    3. Return the contract map to the caller.

    Failure cases:
    - Unsupported or malformed tool declarations are omitted so this pre-check does not replace the authoritative tool boundary.

    Side effects:
    - Reads request/context data and constructs an in-memory mapping; it does not inspect argument values or execute tools.
    """
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
    """Business purpose: Convert one native or provider-dialect tool declaration into a validator contract when its argument schema is supported.

    Business rules:
    - For Pydantic BaseTool schemas, preserve the full input schema when its field names match the tool-call schema so model validators and configuration remain effective.
    - Respect handle_validation_error because the tool itself may return correction feedback.
    - Plain-schema native tools and malformed/unsupported declarations are left to the authoritative tool node.

    Execution flow:
    1. For a native BaseTool, inspect tool_call_schema and build a Pydantic contract when it supports model_validate.
    2. Select the full input schema when its fields match, then bind the tool name and validation-error behavior.
    3. For dictionary tools, extract the name/schema and build a JSON Schema contract when valid.
    4. Return None when no supported contract can be derived.

    Failure cases:
    - Unsupported schema forms return None instead of causing the pre-check to reject a sample on its own.

    Side effects:
    - Reads tool metadata and constructs an in-memory validator; it does not execute the tool or inspect submitted argument values.
    """
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
    """Business purpose: Normalize supported dictionary tool declarations to a name and JSON Schema pair.

    Business rules:
    - Accept an OpenAI-style nested function declaration or a flat provider declaration.
    - Require a nonempty string name and a dictionary schema from parameters or input_schema.

    Execution flow:
    1. Select the nested function object when present, otherwise use the outer dictionary.
    2. Read its name and the supported schema field, including the outer input_schema fallback.
    3. Return the pair only when both values have the required shapes.

    Failure cases:
    - Missing names, empty names, and non-dictionary schemas return None.

    Side effects:
    - Pure normalization; it does not mutate the declaration or validate arguments.
    """
    function = tool.get("function") if isinstance(tool.get("function"), dict) else tool
    name = function.get("name")
    schema = function.get("parameters") or function.get("input_schema") or tool.get("input_schema")
    if isinstance(name, str) and name and isinstance(schema, dict):
        return name, schema
    return None


def _pydantic_problems(schema: Any) -> Callable[[Any], list[str]]:
    """Business purpose: Build a reusable argument validator that reports concise Pydantic contract failures without exposing submitted values.

    Business rules:
    - Validate with the supplied schema's model_validate method.
    - Return at most MAX_REPORTED_PROBLEMS entries, each containing only a field path and Pydantic error type.

    Execution flow:
    1. Create a closure bound to the supplied schema.
    2. On validation, return the bounded error-path/type list or an empty list when arguments are valid.

    Failure cases:
    - ValidationError becomes problem entries; unrelated exceptions from schema validation propagate to the caller.

    Side effects:
    - Constructs an in-memory validator closure; validation does not mutate tool arguments or log their values.
    """
    def problems(args: Any) -> list[str]:
        """Business purpose: Check one tool argument payload against its Pydantic schema for the structured-output pre-check.

        Business rules:
        - Use model_validate as the authority and report no more than MAX_REPORTED_PROBLEMS.
        - Include field locations and error types only, never rejected argument values.

        Execution flow:
        1. Validate the supplied arguments with the captured schema.
        2. Convert ValidationError details into bounded path/type strings, or return an empty list on success.

        Failure cases:
        - Pydantic validation failures become problem strings; unexpected validator exceptions propagate.

        Side effects:
        - Pure validation closure; it does not mutate the arguments or emit logs.
        """
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
    """Business purpose: Restore JSON Schema null types after provider compatibility conversion so contracts can be checked with the standard validator.

    Business rules:
    - Recursively copy dictionaries and lists while changing only a value of NULL under the type key to the standard null value.
    - Preserve all other schema keys and values.

    Execution flow:
    1. Rebuild dictionaries while recursively converting their values.
    2. Rebuild lists while recursively converting their items.
    3. Return scalar values unchanged.

    Failure cases:
    - Inputs outside dictionary/list shapes pass through unchanged; no schema error is raised here.

    Side effects:
    - Produces a normalized in-memory copy for container inputs and does not mutate the source schema.
    """
    if isinstance(schema, dict):
        return {
            key: "null" if key == "type" and value == "NULL" else _provider_neutral(value)
            for key, value in schema.items()
        }
    if isinstance(schema, list):
        return [_provider_neutral(value) for value in schema]
    return schema


def _json_schema_contract(name: str, schema: dict[str, Any], answers: bool) -> ToolContract | None:
    """Business purpose: Build an argument-validation contract from a provider-dialect JSON Schema when the schema is valid and readable.

    Business rules:
    - Normalize provider null types before Draft 2020-12 schema validation.
    - An unreadable schema is omitted from pre-validation so this helper does not substitute for the authoritative tool boundary.
    - Carry the caller's answers-invalid-arguments policy into the resulting ToolContract.

    Execution flow:
    1. Normalize the schema and check it with Draft202012Validator.check_schema.
    2. Return None on SchemaError; otherwise construct a validator and a problem-reporting closure.
    3. Return a ToolContract with the supplied tool name and answer policy.

    Failure cases:
    - Invalid schema shape returns None; other validator construction errors propagate.

    Side effects:
    - Constructs an in-memory JSON Schema validator without changing the input schema or invoking the tool.
    """
    neutral = _provider_neutral(schema)
    try:
        Draft202012Validator.check_schema(neutral)
    except SchemaError:
        # A contract that cannot be read is not a reason to discard a sample: the tool node still
        # validates the arguments authoritatively, so this stays fail-closed.
        return None
    validator = Draft202012Validator(neutral)

    def problems(args: Any) -> list[str]:
        """Business purpose: Check one argument payload against the captured JSON Schema and report bounded, value-free validation problems.

        Business rules:
        - Sort errors by absolute field path and report at most MAX_REPORTED_PROBLEMS.
        - Report missing required fields by their field path; report other failures by path and JSON Schema validator name.
        - Never include argument values in problem strings.

        Execution flow:
        1. Collect and sort validator errors for the supplied arguments.
        2. Expand missing required-field errors into individual missing-field paths.
        3. Format other errors by absolute path, using <root> when no path exists, then return the bounded list.

        Failure cases:
        - Valid arguments produce an empty list; unexpected validator exceptions propagate.

        Side effects:
        - Pure validation closure; it does not mutate arguments, log, or execute the tool.
        """
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
