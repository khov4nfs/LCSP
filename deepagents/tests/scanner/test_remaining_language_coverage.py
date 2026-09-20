from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.registry import LanguageAnalyzerRegistry
from tools.common.capabilities.evidence.scanner.inventory.language.language_classifier import LanguageClassifier


EXTENSIONS = {
    "scala": ".scala", "elixir": ".ex", "clojure": ".clj", "c": ".c", "cpp": ".cpp",
    "shell": ".sh", "powershell": ".ps1", "sql": ".sql", "lua": ".lua", "r": ".R",
    "haskell": ".hs", "solidity": ".sol",
}


def test_remaining_extensions_are_classified_deterministically(tmp_path: Path) -> None:
    for language, extension in EXTENSIONS.items():
        (tmp_path / f"sample{extension}").write_text("// sample\n", encoding="utf-8")
    first = LanguageClassifier().classify_workspace(tmp_path)
    second = LanguageClassifier().classify_workspace(tmp_path)
    assert [(item.file_path, item.language, item.support_level) for item in first] == [
        (item.file_path, item.language, item.support_level) for item in second
    ]
    assert {item.language for item in first} == set(EXTENSIONS)


def test_recognized_only_languages_are_explicitly_unsupported(tmp_path: Path) -> None:
    for language in ("scala", "elixir", "clojure", "lua", "r", "haskell"):
        extension = EXTENSIONS[language]
        (tmp_path / f"sample{extension}").write_text("definitely_not_executed()\n", encoding="utf-8")
    registry = LanguageAnalyzerRegistry.default()
    for language in ("scala", "elixir", "clojure", "lua", "r", "haskell"):
        result = registry.analyze(language, tmp_path, [f"sample{EXTENSIONS[language]}"])
        assert result.status == "UNSUPPORTED"
        assert result.coverage_limitations


def test_structural_adapters_emit_canonical_facts_without_toolchains(tmp_path: Path) -> None:
    (tmp_path / "main.c").write_text('#include "users.h"\nint main() { return 0; }\n', encoding="utf-8")
    (tmp_path / "deploy.sh").write_text("deploy() { curl https://api.example.test; }\n", encoding="utf-8")
    (tmp_path / "migration.sql").write_text("CREATE TABLE users (id INT);\nSELECT id FROM users;\n", encoding="utf-8")
    (tmp_path / "Vault.sol").write_text("contract Vault { event Deposited(); function deposit() public {} }\n", encoding="utf-8")
    registry = LanguageAnalyzerRegistry.default()
    c_result = registry.analyze("c", tmp_path, ["main.c"])
    shell_result = registry.analyze("shell", tmp_path, ["deploy.sh"])
    sql_result = registry.analyze("sql", tmp_path, ["migration.sql"])
    sol_result = registry.analyze("solidity", tmp_path, ["Vault.sol"])
    assert all(result.status == "PARTIAL" for result in (c_result, shell_result, sql_result, sol_result))
    assert any(fact.node_type == "FUNCTION" for fact in c_result.structural_facts)
    assert any(fact.node_type == "CALL_SITE" for fact in shell_result.structural_facts)
    assert any(fact.node_type == "TABLE" for fact in sql_result.structural_facts)
    assert any(fact.node_type in {"CLASS", "FUNCTION", "EVENT"} for fact in sol_result.structural_facts)
    assert all(fact.file_path for result in (c_result, shell_result, sql_result, sol_result) for fact in result.structural_facts)


def test_dynamic_structural_execution_is_explicitly_limited(tmp_path: Path) -> None:
    (tmp_path / "unsafe.sh").write_text('eval "$COMMAND"\n', encoding="utf-8")
    result = LanguageAnalyzerRegistry.default().analyze("shell", tmp_path, ["unsafe.sh"])
    assert any("dynamic_execution_unresolved" in limitation for limitation in result.coverage_limitations)
