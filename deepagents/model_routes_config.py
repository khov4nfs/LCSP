"""Safe YAML loading and validation of the model route file (see ``model_policy``)."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

import yaml

TOP_LEVEL_KEYS = frozenset({"version", "routes", "roles", "fallbacks"})
ROUTE_KEYS = frozenset({"provider", "model", "options"})
# Option keys are normalised (lowercase, strip every char outside [a-z0-9]) and rejected when the
# result is "auth" or contains one of these parts: credentials, base URLs/endpoints, headers, proxy,
# client objects and transports are trusted adapter config, never route options.
PROTECTED_PARTS = (
    "apikey", "secret", "password", "authorization", "credential", "baseurl", "apibase", "apiurl",
    "endpoint", "header", "proxy", "client", "transport", "accesstoken", "bearer", "privatekey",
)
_WS = " \t\r\n\f\v"  # "blank"/"padded" = ASCII whitespace only, identical in model-routes.ts
_INT = re.compile(r"[-+]?[0-9]+\Z|0o[0-7]+\Z|0x[0-9a-fA-F]+\Z")
_FLOAT = re.compile(
    r"(?:[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))\Z"
)


def _to_int(loader, node):
    text = loader.construct_scalar(node)
    return int(text[2:], 8 if text[1:2] == "o" else 16) if text[:2] in ("0o", "0x") else int(text)


def _to_float(loader, node):
    text = loader.construct_scalar(node)
    return float(text.lower().replace(".inf", "inf").replace(".nan", "nan"))


class _UniqueKeyLoader(yaml.SafeLoader):
    """YAML 1.2 core-schema SafeLoader: no custom tags, anchors/aliases, merge keys or timestamps;
    duplicate mapping keys rejected. Mirrors the js-yaml schema in model-routes.ts."""

    yaml_implicit_resolvers: dict = {}  # drop PyYAML's YAML 1.1 resolvers (yes/no, 1_000, 1:30, dates, <<)

    def flatten_mapping(self, node):  # `<<` is a plain key
        return None

    def compose_node(self, parent, index):
        event = self.peek_event()
        if isinstance(event, yaml.AliasEvent) or event.anchor is not None:
            raise yaml.composer.ComposerError(None, None, "anchors and aliases are not allowed", event.start_mark)
        if getattr(event, "tag", None) is not None:
            raise yaml.composer.ComposerError(None, None, "explicit tags are not allowed", event.start_mark)
        return super().compose_node(parent, index)

    def construct_mapping(self, node, deep=False):  # type: ignore[override]
        seen: set[Any] = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=True)
            if isinstance(key, (dict, list, set)):
                raise yaml.constructor.ConstructorError(None, None, "unhashable mapping key", key_node.start_mark)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark
                )
            seen.add(key)
        return super().construct_mapping(node, deep)


for _tag, _regexp, _first in (
    ("tag:yaml.org,2002:null", re.compile(r"(?:~|null|Null|NULL|)\Z"), ["~", "n", "N", ""]),
    ("tag:yaml.org,2002:bool", re.compile(r"(?:true|True|TRUE|false|False|FALSE)\Z"), list("tTfF")),
    ("tag:yaml.org,2002:int", _INT, list("-+0123456789")),
    ("tag:yaml.org,2002:float", _FLOAT, list("-+0123456789.")),
):
    _UniqueKeyLoader.add_implicit_resolver(_tag, _regexp, _first)
_UniqueKeyLoader.add_constructor("tag:yaml.org,2002:int", _to_int)
_UniqueKeyLoader.add_constructor("tag:yaml.org,2002:float", _to_float)
_UniqueKeyLoader.add_constructor("tag:yaml.org,2002:bool", lambda l, n: l.construct_scalar(n)[0] in "tT")


def _blank(text: str) -> bool:
    return not text.strip(_WS)


def _protected(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    return normalized == "auth" or any(part in normalized for part in PROTECTED_PARTS)


def _check_options(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if not isinstance(key, str) or _blank(key):
                raise ValueError(f"{path} option keys must be non-blank strings")
            if _protected(key):
                raise ValueError(f"{path}.{key} is a protected option key (credentials/transport are not route options)")
            _check_options(nested, f"{path}.{key}")
    elif isinstance(value, list):
        for item in value:
            _check_options(item, path)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"{path} option values must be finite numbers")
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        raise ValueError(f"{path} option values must be JSON values")


def parse_model_routes(text: str, providers: tuple[str, ...]) -> tuple[dict, dict, dict]:
    """Validate YAML text; return ``(routes, roles, fallbacks)``. Raises ``ValueError``."""
    if "\t" in text:  # PyYAML and js-yaml disagree on tab handling; forbid tabs outright
        raise ValueError("invalid YAML: tab characters are not allowed (indent with spaces)")
    try:
        data = yaml.load(text, Loader=_UniqueKeyLoader)  # noqa: S506 - SafeLoader subclass
    except yaml.YAMLError as error:
        raise ValueError(f"invalid YAML: {error}") from error
    if not isinstance(data, dict):
        raise ValueError("top-level must be a mapping")
    if unknown := sorted(map(str, set(data) - TOP_LEVEL_KEYS)):
        raise ValueError(f"unknown top-level key {unknown}; allowed: version, routes, roles, fallbacks")
    version = data.get("version")
    if isinstance(version, bool) or version != 1 or not isinstance(version, int):
        raise ValueError("version must be integer 1")
    raw_routes, raw_roles, raw_fallbacks = data.get("routes"), data.get("roles"), data.get("fallbacks", {})  # present-but-null is rejected below
    if not isinstance(raw_routes, dict) or not raw_routes:
        raise ValueError("routes must be a non-empty mapping")
    if not isinstance(raw_roles, dict):
        raise ValueError("roles must be a mapping")
    if not isinstance(raw_fallbacks, dict):
        raise ValueError("fallbacks must be a mapping")
    routes: dict[str, dict[str, Any]] = {}
    for route_id, route in raw_routes.items():
        if not isinstance(route_id, str) or _blank(route_id):
            raise ValueError(f"route id must be a non-blank string, got {route_id!r}")
        where = f"routes.{route_id}"
        if not isinstance(route, dict):
            raise ValueError(f"{where} must be a mapping")
        if unknown := sorted(map(str, set(route) - ROUTE_KEYS)):
            raise ValueError(f"{where}: unknown key {unknown}; allowed: provider, model, options")
        provider, model = route.get("provider"), route.get("model")
        if not isinstance(provider, str) or provider not in providers:
            raise ValueError(f"{where}.provider must be exactly one of: {', '.join(providers)} (got {provider!r})")
        if not isinstance(model, str) or _blank(model) or model != model.strip(_WS):
            raise ValueError(f"{where}.model must be a non-blank string without leading/trailing whitespace (quote it in YAML)")
        options = route.get("options", {})
        if not isinstance(options, dict):
            raise ValueError(f"{where}.options must be a mapping")
        _check_options(options, f"{where}.options")
        routes[route_id] = {"provider": provider, "model": model, "options": options}
    for name, route_id in raw_roles.items():
        if not isinstance(name, str) or _blank(name):
            raise ValueError(f"role names must be non-blank strings, got {name!r}")
        if not isinstance(route_id, str) or route_id not in routes:
            raise ValueError(f"roles.{name} references unknown route {route_id!r}")
    if "default" not in raw_roles:
        raise ValueError("roles.default is required")
    fallbacks: dict[str, tuple[str, ...]] = {}
    for route_id, chain in raw_fallbacks.items():
        if route_id not in routes:
            raise ValueError(f"fallbacks.{route_id} references unknown route")
        if not isinstance(chain, list) or not all(isinstance(item, str) for item in chain):
            raise ValueError(f"fallbacks.{route_id} must be a list of route id strings")
        if unknown := [item for item in chain if item not in routes]:
            raise ValueError(f"fallbacks.{route_id} references unknown route {unknown}")
        fallbacks[route_id] = tuple(chain)

    def visit(node: str, stack: tuple[str, ...]) -> None:
        if node in stack:
            raise ValueError(f"fallback cycle: {' -> '.join((*stack, node))}")
        for nxt in fallbacks.get(node, ()):
            visit(nxt, (*stack, node))

    for route_id in fallbacks:
        visit(route_id, ())
    return routes, dict(raw_roles), fallbacks


def read_model_routes(path: Path, providers: tuple[str, ...], override_env: str) -> tuple[dict, dict, dict]:
    """Read + validate one file; every failure names the path (and the override env when unreadable)."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise RuntimeError(
            f"model routes file {path} is missing or unreadable ({error.strerror}); "
            f"create it or point {override_env} at a valid YAML file"
        ) from error
    try:
        return parse_model_routes(text, providers)
    except ValueError as error:
        raise RuntimeError(f"model routes file {path}: {error}") from error
