from __future__ import annotations

from lcsp_workers.scanner.parsers.python_ast_parser import PythonAstParser


def test_python_ast_parser_does_not_skip_file_only_because_it_exceeds_50kb(tmp_path) -> None:
    source = tmp_path / "large.py"
    body = ["def large_function(value):", "    total = value"]
    body.extend(f"    item_{index} = total + {index}" for index in range(4000))
    body.append("    return total")
    source.write_text("\n".join(body) + "\n", encoding="utf-8")

    assert source.stat().st_size > 50 * 1024
    parsed = PythonAstParser().parse_file(source, tmp_path)

    assert parsed.tree is not None
    assert parsed.coverage_limited is False
    assert parsed.skip_reason is None
