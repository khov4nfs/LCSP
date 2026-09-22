"""Python HTTP-client indexing must survive lambda scopes.

A lambda body is a single expression rather than a statement list. Reading it as
a sequence aborted the whole evidence-graph build for any repository containing
a lambda, so the shape is asserted directly.
"""

import ast

import pytest

from tools.common.capabilities.evidence.graph.construction.extraction.extractor import (
    _python_http_client_aliases,
)

IMPORTS = {"requests": ("requests", None)}


@pytest.mark.parametrize(
    "source",
    [
        "handler = lambda event: event.context.session\n",
        "identity = lambda value: value\n",
        "handlers = [lambda a: a.b, lambda c: c.d]\n",
        "nested = lambda outer: (lambda inner: inner.value)(outer)\n",
    ],
)
def test_lambda_scopes_do_not_abort_indexing(source: str) -> None:
    _python_http_client_aliases(ast.parse(f"import requests\n{source}"), IMPORTS)


def test_http_client_bound_inside_a_lambda_scope_is_still_indexed() -> None:
    source = "import requests\nbuild = lambda: requests.Session()\nclient = requests.Session()\n"

    scopes = _python_http_client_aliases(ast.parse(source), IMPORTS)

    bindings = [
        (name, events)
        for scope in scopes.values()
        for name, events in scope.items()
    ]
    assert any(
        name == "client" and any(is_http for _, is_http in events)
        for name, events in bindings
    ), "a module-level session must still be recognised alongside lambda scopes"
