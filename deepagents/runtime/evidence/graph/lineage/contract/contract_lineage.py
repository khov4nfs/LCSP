"""Extract HTTP/OpenAPI/GraphQL data contracts into unified graph lineage.

Contract parsing gives LCSP stable protocol/data identities before local variable names.
OpenAPI/Swagger schemas and GraphQL input types become DATA_OBJECT observations that can
later be corroborated by implementation, persistence, AI-processing, or business-flow
behavior. Identifier taxonomy remains only an INFERRED semantic seed.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from .sensitive_data import semantic_types_for_identifier
from .source_roles import is_test_source_path

_HTTP_METHODS = frozenset({"get", "post", "put", "patch", "delete", "options", "head"})
_OPENAPI_NAMES = ("openapi", "swagger")
_GRAPHQL_EXTENSIONS = frozenset({".graphql", ".gql"})
_EXCLUDED = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        "build",
        ".next",
        "coverage",
        "vendor",
        ".venv",
        "venv",
        "__pycache__",
        "target",
        "bin",
        "obj",
    }
)
_GQL_TYPE_RE = re.compile(r"\b(?:input|type)\s+([A-Za-z_][\w]*)\s*\{(.*?)\}", re.S)
_GQL_FIELD_RE = re.compile(
    r"(?m)^\s*([A-Za-z_][\w]*)\s*(?:\((.*?)\))?\s*:\s*([\[\]!A-Za-z_][\[\]!\w]*)"
)
_GQL_ARG_RE = re.compile(r"([A-Za-z_][\w]*)\s*:\s*([\[\]!A-Za-z_][\[\]!\w]*)")


class ContractDataLineageExtractor:
    """Add protocol contract observations without claiming business/legal meaning."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        for path in self._files():
            rel = path.relative_to(self.workspace).as_posix()
            suffix = path.suffix.lower()
            if suffix in _GRAPHQL_EXTENSIONS:
                self._graphql(program, path, rel)
                continue
            lower_name = path.name.lower()
            if suffix not in {".json", ".yaml", ".yml"} or not any(
                token in lower_name for token in _OPENAPI_NAMES
            ):
                continue
            if suffix == ".json":
                self._openapi_json(program, path, rel)
            else:
                self._openapi_yaml_routes(program, path, rel)
        return program

    def _openapi_json(
        self,
        program: SemanticProgram,
        path: Path,
        rel: str,
    ) -> None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            program.coverage_notes.append(f"contract_parse_failed:file={rel}:kind=OPENAPI_JSON")
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("paths"), dict):
            return
        contract_key = self._contract(program, rel, "OPENAPI")
        components = payload.get("components") if isinstance(payload.get("components"), dict) else {}
        schemas = components.get("schemas") if isinstance(components.get("schemas"), dict) else {}
        for route_path, raw_path_item in sorted(payload["paths"].items()):
            if not isinstance(raw_path_item, dict):
                continue
            for method, operation in sorted(raw_path_item.items()):
                if str(method).lower() not in _HTTP_METHODS or not isinstance(operation, dict):
                    continue
                self._openapi_operation(
                    program,
                    contract_key=contract_key,
                    rel=rel,
                    method=str(method).upper(),
                    route_path=str(route_path),
                    operation=operation,
                    schemas=schemas,
                )

    def _openapi_operation(
        self,
        program: SemanticProgram,
        *,
        contract_key: str,
        rel: str,
        method: str,
        route_path: str,
        operation: dict[str, Any],
        schemas: dict[str, Any],
    ) -> None:
        normalized = self._normalize_route(route_path)
        route_key = f"http-route:{method}:{normalized}"
        program.add_node(
            SemanticNodeFact(
                route_key,
                "HTTP_ROUTE",
                f"{method} {normalized}",
                rel,
                attributes={"method": method, "route": normalized, "contract": "OPENAPI"},
                origin="CONTRACT_ANALYSIS",
                resolution_state="OBSERVED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "DECLARES",
                contract_key,
                route_key,
                origin="CONTRACT_ANALYSIS",
            )
        )

        request_key = f"http-request:{method}:{normalized}"
        program.add_node(
            SemanticNodeFact(
                request_key,
                "HTTP_REQUEST",
                f"{method} {normalized} request",
                rel,
                attributes={"method": method, "route": normalized},
                origin="CONTRACT_ANALYSIS",
            )
        )
        program.add_edge(
            SemanticEdgeFact("FLOWS_TO", request_key, route_key, origin="CONTRACT_ANALYSIS")
        )
        for parameter in operation.get("parameters") or []:
            if not isinstance(parameter, dict):
                continue
            name = str(parameter.get("name") or "")
            if not name:
                continue
            self._contract_data_object(
                program,
                owner_key=request_key,
                rel=rel,
                label=f"{method} {normalized} request.{name}",
                field_name=name,
                attributes={"location": str(parameter.get("in") or "UNKNOWN")},
            )

        request_body = operation.get("requestBody")
        if isinstance(request_body, dict):
            for media_type, media in sorted((request_body.get("content") or {}).items()):
                if not isinstance(media, dict):
                    continue
                schema = self._resolve_schema(media.get("schema"), schemas)
                self._schema_objects(
                    program,
                    owner_key=request_key,
                    rel=rel,
                    prefix=f"{method} {normalized} request",
                    schema=schema,
                    schemas=schemas,
                    attributes={"mediaType": str(media_type)},
                )

        responses = operation.get("responses")
        if not isinstance(responses, dict):
            return
        for status, response in sorted(responses.items()):
            if not isinstance(response, dict):
                continue
            response_key = f"http-response:{method}:{normalized}:{status}"
            program.add_node(
                SemanticNodeFact(
                    response_key,
                    "HTTP_RESPONSE",
                    f"{method} {normalized} response {status}",
                    rel,
                    attributes={"method": method, "route": normalized, "status": str(status)},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "FLOWS_TO",
                    route_key,
                    response_key,
                    origin="CONTRACT_ANALYSIS",
                )
            )
            for media_type, media in sorted((response.get("content") or {}).items()):
                if not isinstance(media, dict):
                    continue
                schema = self._resolve_schema(media.get("schema"), schemas)
                self._schema_objects(
                    program,
                    owner_key=response_key,
                    rel=rel,
                    prefix=f"{method} {normalized} response {status}",
                    schema=schema,
                    schemas=schemas,
                    attributes={"mediaType": str(media_type)},
                )

    def _schema_objects(
        self,
        program: SemanticProgram,
        *,
        owner_key: str,
        rel: str,
        prefix: str,
        schema: Any,
        schemas: dict[str, Any],
        attributes: dict[str, str],
        depth: int = 0,
    ) -> None:
        if depth > 4 or not isinstance(schema, dict):
            return
        resolved = self._resolve_schema(schema, schemas)
        if not isinstance(resolved, dict):
            return
        if isinstance(resolved.get("items"), dict):
            self._schema_objects(
                program,
                owner_key=owner_key,
                rel=rel,
                prefix=f"{prefix}[]",
                schema=resolved["items"],
                schemas=schemas,
                attributes=attributes,
                depth=depth + 1,
            )
        properties = resolved.get("properties")
        if not isinstance(properties, dict):
            return
        for field_name, field_schema in sorted(properties.items()):
            label = f"{prefix}.{field_name}"
            key = self._contract_data_object(
                program,
                owner_key=owner_key,
                rel=rel,
                label=label,
                field_name=str(field_name),
                attributes={
                    **attributes,
                    "schemaType": str(
                        field_schema.get("type") if isinstance(field_schema, dict) else ""
                    ),
                    "format": str(
                        field_schema.get("format") if isinstance(field_schema, dict) else ""
                    ),
                },
            )
            if isinstance(field_schema, dict):
                self._schema_objects(
                    program,
                    owner_key=key,
                    rel=rel,
                    prefix=label,
                    schema=field_schema,
                    schemas=schemas,
                    attributes=attributes,
                    depth=depth + 1,
                )

    def _contract_data_object(
        self,
        program: SemanticProgram,
        *,
        owner_key: str,
        rel: str,
        label: str,
        field_name: str,
        attributes: dict[str, str],
    ) -> str:
        key = f"data-object:contract:{_safe(rel)}:{_safe(label)}"
        semantics = semantic_types_for_identifier(field_name)
        program.add_node(
            SemanticNodeFact(
                key,
                "DATA_OBJECT",
                label,
                rel,
                attributes={key: value for key, value in attributes.items() if value},
                semantic_types=semantics,
                origin="CONTRACT_ANALYSIS",
                resolution_state="INFERRED" if semantics else "OBSERVED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "CARRIES_DATA",
                owner_key,
                key,
                origin="CONTRACT_ANALYSIS",
                resolution_state="OBSERVED",
            )
        )
        return key

    def _openapi_yaml_routes(
        self,
        program: SemanticProgram,
        path: Path,
        rel: str,
    ) -> None:
        """Parse only deterministic route/method structure from YAML without a YAML runtime.

        YAML schema shapes can be arbitrarily complex. Instead of a fragile parser, this
        fallback records route/request/response boundaries and leaves field-level schema
        resolution UNKNOWN until source or another contract representation corroborates it.
        """
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            return
        contract_key = self._contract(program, rel, "OPENAPI")
        in_paths = False
        current_path: str | None = None
        paths_indent = 0
        for line_no, line in enumerate(lines, start=1):
            stripped = line.strip()
            indent = len(line) - len(line.lstrip(" "))
            if stripped == "paths:":
                in_paths = True
                paths_indent = indent
                continue
            if not in_paths:
                continue
            if stripped and indent <= paths_indent and stripped != "paths:":
                break
            route_match = re.match(r"^\s*(/[^:]+):\s*$", line)
            if route_match:
                current_path = self._normalize_route(route_match.group(1))
                continue
            method_match = re.match(r"^\s+(get|post|put|patch|delete|options|head):\s*$", line, re.I)
            if not method_match or not current_path:
                continue
            method = method_match.group(1).upper()
            route_key = f"http-route:{method}:{current_path}"
            request_key = f"http-request:{method}:{current_path}"
            program.add_node(
                SemanticNodeFact(
                    route_key,
                    "HTTP_ROUTE",
                    f"{method} {current_path}",
                    rel,
                    line_no,
                    line_no,
                    attributes={"method": method, "route": current_path, "contract": "OPENAPI"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            program.add_node(
                SemanticNodeFact(
                    request_key,
                    "HTTP_REQUEST",
                    f"{method} {current_path} request",
                    rel,
                    line_no,
                    line_no,
                    origin="CONTRACT_ANALYSIS",
                    resolution_state="OBSERVED",
                )
            )
            program.add_edge(
                SemanticEdgeFact("DECLARES", contract_key, route_key, origin="CONTRACT_ANALYSIS")
            )
            program.add_edge(
                SemanticEdgeFact("FLOWS_TO", request_key, route_key, origin="CONTRACT_ANALYSIS")
            )

    def _graphql(self, program: SemanticProgram, path: Path, rel: str) -> None:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        contract_key = self._contract(program, rel, "GRAPHQL")
        type_fields: dict[str, list[tuple[str, str]]] = {}
        blocks = list(_GQL_TYPE_RE.finditer(text))
        for block in blocks:
            type_name, body = block.groups()
            fields = [
                (field.group(1), field.group(3))
                for field in _GQL_FIELD_RE.finditer(body)
            ]
            type_fields[type_name] = fields

        for block in blocks:
            type_name, body = block.groups()
            if type_name not in {"Query", "Mutation", "Subscription"}:
                continue
            for field in _GQL_FIELD_RE.finditer(body):
                operation_name, raw_args, return_type = field.groups()
                operation_key = f"graphql-operation:{type_name}:{operation_name}"
                program.add_node(
                    SemanticNodeFact(
                        operation_key,
                        "GRAPHQL_OPERATION",
                        f"{type_name}.{operation_name}",
                        rel,
                        attributes={"operationType": type_name, "returnType": return_type},
                        origin="CONTRACT_ANALYSIS",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "DECLARES", contract_key, operation_key, origin="CONTRACT_ANALYSIS"
                    )
                )
                for arg in _GQL_ARG_RE.finditer(raw_args or ""):
                    arg_name, arg_type = arg.groups()
                    arg_key = self._contract_data_object(
                        program,
                        owner_key=operation_key,
                        rel=rel,
                        label=f"{type_name}.{operation_name}.{arg_name}",
                        field_name=arg_name,
                        attributes={"graphqlType": arg_type, "direction": "INPUT"},
                    )
                    named_type = _named_graphql_type(arg_type)
                    for child_name, child_type in type_fields.get(named_type, []):
                        self._contract_data_object(
                            program,
                            owner_key=arg_key,
                            rel=rel,
                            label=f"{type_name}.{operation_name}.{arg_name}.{child_name}",
                            field_name=child_name,
                            attributes={"graphqlType": child_type, "direction": "INPUT"},
                        )

    @staticmethod
    def _resolve_schema(value: Any, schemas: dict[str, Any]) -> Any:
        if not isinstance(value, dict):
            return value
        ref = value.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            return schemas.get(ref.rsplit("/", 1)[-1], value)
        return value

    @staticmethod
    def _contract(program: SemanticProgram, rel: str, kind: str) -> str:
        key = f"data-contract:{kind.lower()}:{rel}"
        program.add_node(
            SemanticNodeFact(
                key,
                "DATA_CONTRACT",
                rel,
                rel,
                1,
                1,
                attributes={"protocol": kind},
                origin="CONTRACT_ANALYSIS",
            )
        )
        return key

    @staticmethod
    def _normalize_route(value: str) -> str:
        path = str(value).split("?", 1)[0].strip()
        return "/" + path.strip("/") if path.strip("/") else "/"

    def _files(self) -> tuple[Path, ...]:
        result = []
        for path in self.workspace.rglob("*"):
            if not path.is_file():
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel):
                continue
            suffix = path.suffix.lower()
            if suffix in _GRAPHQL_EXTENSIONS or (
                suffix in {".json", ".yaml", ".yml"}
                and any(token in path.name.lower() for token in _OPENAPI_NAMES)
            ):
                result.append(path)
        return tuple(sorted(result))


def _named_graphql_type(value: str) -> str:
    return re.sub(r"[\[\]!]", "", value or "")


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.:/-]+", "_", value)[:200] or "unknown"
