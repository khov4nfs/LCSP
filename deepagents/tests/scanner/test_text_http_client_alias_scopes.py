"""Scope and ordering rules for text-language HTTP client alias resolution.

These rules decide whether a call site is attributed to a real HTTP client, so
they are asserted directly rather than only through whole-repository scans.
"""

from tools.common.capabilities.evidence.graph.construction.extraction.extractor import (
    _text_http_client_aliases,
)


def test_outer_client_alias_stays_active_inside_a_nested_scope() -> None:
    source = "\n".join(
        [
            "const client = axios.create({});",      # 1
            "function send(payload) {",              # 2
            "  return client.post('/x', payload);",  # 3
            "}",                                     # 4
        ]
    )

    active = _text_http_client_aliases(source)

    assert "client" in active[1]
    assert "client" in active[3]


def test_a_binding_is_not_active_before_its_own_assignment() -> None:
    source = "\n".join(
        [
            "log('start');",                     # 1
            "const client = axios.create({});",  # 2
        ]
    )

    active = _text_http_client_aliases(source)

    assert "client" not in active[1]
    assert "client" in active[2]


def test_inner_non_client_binding_shadows_the_outer_client() -> None:
    source = "\n".join(
        [
            "const client = axios.create({});",  # 1
            "function send() {",                 # 2
            "  const client = makeStub();",      # 3
            "  return client.post('/x');",       # 4
            "}",                                 # 5
            "client.post('/y');",                # 6
        ]
    )

    active = _text_http_client_aliases(source)

    assert "client" not in active[4], "inner binding must shadow the outer client"
    assert "client" in active[6], "the outer client survives the inner scope"


def test_latest_event_at_or_before_the_line_decides_the_state() -> None:
    source = "\n".join(
        [
            "const client = makeStub();",        # 1
            "call(client);",                     # 2
            "const client = axios.create({});",  # 3
            "call(client);",                     # 4
        ]
    )

    active = _text_http_client_aliases(source)

    assert "client" not in active[2]
    assert "client" in active[4]
