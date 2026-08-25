"""
AC-031: Scanner analysis never executes source code, installs dependencies, or runs builds.
AC-032: Scanner finding records include correct confidence and evidence fields.
"""
import os
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.mark.p0
def test_analyzer_does_not_execute_source_code(sample_python_repo: Path) -> None:
    """
    AC-031: Python AST analyzer must never exec() or eval() source code.
    The analyzer must work purely on AST/CST nodes.
    """
    # RED: Analyzer not yet implemented.
    try:
        from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_ast import PythonAstAnalyzer

        # Inject a canary — if source is executed, this will raise
        canary = sample_python_repo / "src" / "canary.py"
        canary.write_text(
            "import os\nos.environ['CANARY_EXECUTED'] = 'YES'\n"
        )
        os.environ.pop("CANARY_EXECUTED", None)

        analyzer = PythonAstAnalyzer(workspace=str(sample_python_repo))
        analyzer.analyze()

        assert os.environ.get("CANARY_EXECUTED") != "YES", (
            "AC-031 FAIL: PythonAstAnalyzer executed source code (canary triggered)"
        )
    except ImportError:
        pytest.skip("AC-031 RED: PythonAstAnalyzer not yet implemented")


@pytest.mark.p0
def test_analyzer_does_not_install_dependencies(sample_python_repo: Path) -> None:
    """
    AC-031: Scanner must NOT run pip install, npm install, poetry install, or any
    dependency installation command during analysis.
    """
    # RED: Analyzer not yet implemented.
    try:
        from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_ast import PythonAstAnalyzer

        with patch("subprocess.run") as mock_run, patch("subprocess.Popen") as mock_popen:
            analyzer = PythonAstAnalyzer(workspace=str(sample_python_repo))
            analyzer.analyze()

            for call in mock_run.call_args_list + mock_popen.call_args_list:
                args = call[0][0] if call[0] else call[1].get("args", [])
                cmd = " ".join(str(a) for a in args) if isinstance(args, list) else str(args)
                assert "install" not in cmd or "list" in cmd, (
                    f"AC-031 FAIL: analyzer called dependency install: {cmd}"
                )
    except ImportError:
        pytest.skip("AC-031 RED: PythonAstAnalyzer not yet implemented")


@pytest.mark.p0
def test_analyzer_does_not_run_npm_install(sample_ts_repo: Path) -> None:
    """AC-031: TS/JS bridge subprocess must not invoke npm install."""
    try:
        from tools.common.capabilities.evidence.scanner.ts_js_bridge.bridge import TsJsBridge

        with patch("asyncio.create_subprocess_exec") as mock_exec:
            # Capture the command that would be run
            mock_exec.return_value.__aenter__ = None
            import asyncio
            bridge = TsJsBridge(workspace=str(sample_ts_repo))
            # Would run: asyncio.create_subprocess_exec(node, cli.js, ...)
            # Ensure 'npm' or 'install' not in args
            for call in mock_exec.call_args_list:
                args = call[0]
                cmd_str = " ".join(str(a) for a in args)
                assert "npm install" not in cmd_str
                assert "npm i " not in cmd_str
    except ImportError:
        pytest.skip("AC-031 RED: TsJsBridge not yet implemented")


@pytest.mark.p0
def test_finding_has_required_fields(sample_python_repo: Path) -> None:
    """
    AC-032: Each TechnicalFinding must include:
    - finding_type (one of 21 canonical types)
    - confidence (float 0.00-1.00, rounded to 2 decimals)
    - evidence (list of evidence items)
    - file_path (relative to workspace)
    - analysis_level (L0-L3, never L4 with actual data)
    """
    VALID_FINDING_TYPES = {
        "AI_PROVIDER_USAGE", "AI_FRAMEWORK_USAGE", "AI_MODEL_INVOCATION",
        "AI_INPUT_SIGNAL", "AI_OUTPUT_SIGNAL", "AI_DECISION_FLOW_SIGNAL",
        "AUTOMATED_DECISION_SIGNAL", "HUMAN_REVIEW_SIGNAL",
        "RANKING_SIGNAL", "RECOMMENDATION_SIGNAL", "STATUS_UPDATE_SIGNAL",
        "USER_IMPACT_SIGNAL", "SENSITIVE_DATA_SIGNAL", "DOMAIN_CONTEXT_SIGNAL",
        "HARM_POTENTIAL_SIGNAL", "SYSTEM_PROMPT_DETECTED",
        "DYNAMIC_SYSTEM_PROMPT_REFERENCE", "RAG_USAGE_SIGNAL",
        "MODEL_OUTPUT_PARSER_SIGNAL", "SCAN_COVERAGE_LIMITATION",
        "UNSUPPORTED_DYNAMIC_FLOW",
    }

    try:
        from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_ast import PythonAstAnalyzer

        analyzer = PythonAstAnalyzer(workspace=str(sample_python_repo))
        result = analyzer.analyze()

        for finding in result.findings:
            assert finding.finding_type in VALID_FINDING_TYPES, (
                f"AC-032 FAIL: unknown finding_type '{finding.finding_type}'"
            )
            assert isinstance(finding.confidence, float)
            assert 0.00 <= finding.confidence <= 1.00
            # Verify 2-decimal precision
            assert round(finding.confidence, 2) == finding.confidence, (
                f"AC-032 FAIL: confidence {finding.confidence} not rounded to 2 decimals"
            )
            assert isinstance(finding.evidence, list)
            assert finding.file_path, "finding_type must include file_path"
            assert finding.analysis_level in ("L0", "L1", "L2", "L3"), (
                f"AC-032 FAIL: analysis_level must be L0-L3, got {finding.analysis_level}"
            )
    except ImportError:
        pytest.skip("AC-032 RED: PythonAstAnalyzer not yet implemented")


@pytest.mark.p0
def test_finding_confidence_never_exceeds_1_00(sample_python_repo: Path) -> None:
    """AC-032: Confidence must be clamped to [0.00, 1.00]."""
    try:
        from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_ast import PythonAstAnalyzer

        analyzer = PythonAstAnalyzer(workspace=str(sample_python_repo))
        result = analyzer.analyze()

        for finding in result.findings:
            assert finding.confidence <= 1.00, (
                f"AC-032 FAIL: confidence {finding.confidence} exceeds 1.00"
            )
            assert finding.confidence >= 0.00, (
                f"AC-032 FAIL: confidence {finding.confidence} below 0.00"
            )
    except ImportError:
        pytest.skip("AC-032 RED: PythonAstAnalyzer not yet implemented")


@pytest.mark.p0
def test_finding_does_not_include_source_code(sample_python_repo: Path) -> None:
    """
    AC-032 + AC-022: TechnicalFinding fields must never contain raw source code.
    Only AST-derived metadata (function names, line numbers, argument names) is permitted.
    """
    CODE_HEURISTICS = ["def ", "import ", "function ", "class ", "const ", "let "]

    try:
        from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_ast import PythonAstAnalyzer

        analyzer = PythonAstAnalyzer(workspace=str(sample_python_repo))
        result = analyzer.analyze()

        for finding in result.findings:
            for field_name, field_value in vars(finding).items():
                if isinstance(field_value, str) and len(field_value) > 50:
                    for heuristic in CODE_HEURISTICS:
                        assert heuristic not in field_value, (
                            f"AC-032 FAIL: finding.{field_name} contains source code snippet"
                        )
    except ImportError:
        pytest.skip("AC-032 RED: PythonAstAnalyzer not yet implemented")


@pytest.mark.p0
def test_t01_openai_chat_completion_call_site(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    src = workspace_dir / "src"
    src.mkdir()
    (src / "app.py").write_text(
        "import openai\n"
        "client = openai.OpenAI()\n"
        "client.chat.completions.create(model='gpt-4o', messages=[])\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    site = next(site for site in result.ai_call_sites if site.matched_rule_id == "py-openai-chat-completions")
    assert site.finding_type == "AI_PROVIDER_USAGE"
    assert site.analysis_level == "L1"
    assert site.kwarg_names == ["model", "messages"]


@pytest.mark.p0
def test_t02_langchain_prompt_template_detected(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    src = workspace_dir / "src"
    src.mkdir()
    (src / "prompt.py").write_text(
        "from langchain.prompts import ChatPromptTemplate\n"
        "template = ChatPromptTemplate.from_template('safe placeholder')\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    assert any(
        site.matched_rule_id == "py-langchain-prompt"
        and site.finding_type == "SYSTEM_PROMPT_DETECTED"
        for site in result.ai_call_sites
    )


@pytest.mark.p0
def test_t03_getattr_dynamic_flow_is_unsupported(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "dynamic.py").write_text(
        "method = 'predict'\ngetattr(model, method)(payload)\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    assert result.unsupported_dynamic_flows
    assert result.ai_call_sites[0].has_dynamic_call is True
    assert result.ai_call_sites[0].finding_type == "UNSUPPORTED_DYNAMIC_FLOW"


@pytest.mark.p0
def test_t04_dynamic_system_prompt_reference(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "prompt.py").write_text(
        "SYSTEM_PROMPT = 'policy'\n"
        "message = f'system: {SYSTEM_PROMPT}'\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    assert any(site.finding_type == "DYNAMIC_SYSTEM_PROMPT_REFERENCE" for site in result.ai_call_sites)


@pytest.mark.p0
def test_t05_large_python_file_is_parsed_without_arbitrary_50kb_skip(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "large.py").write_text("x = 1\n" * 40000, encoding="utf-8")

    result = PythonAnalyzer(workspace_dir).analyze()

    assert result.files_analyzed == 1
    assert result.files_skipped == 0
    assert all(
        "file exceeds 50KB analysis limit" not in value
        for value in result.coverage_limitations
    )


@pytest.mark.p0
def test_t06_call_args_schema_contains_names_only(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "app.py").write_text(
        "import openai\n"
        "client = openai.OpenAI()\n"
        "client.responses.create('secret prompt', model='gpt-4o')\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()
    site = next(site for site in result.ai_call_sites if site.matched_rule_id == "py-openai-responses")

    assert site.call_args_schema == ["position_0", "model"]
    assert "secret prompt" not in str(site)


@pytest.mark.p0
def test_t07_venv_folder_not_traversed(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    venv = workspace_dir / "venv"
    venv.mkdir()
    (venv / "ignored.py").write_text("import openai\nopenai.chat.completions.create()\n", encoding="utf-8")

    result = PythonAnalyzer(workspace_dir).analyze()

    assert result.files_analyzed == 0
    assert result.ai_call_sites == []


@pytest.mark.p0
def test_t08_l3_cross_file_direct_import_chain(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "main.py").write_text("from helper import ask\nask()\n", encoding="utf-8")
    (workspace_dir / "helper.py").write_text(
        "import openai\n"
        "client = openai.OpenAI()\n"
        "def ask():\n"
        "    return client.chat.completions.create(model='gpt-4o')\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    assert any(
        site.analysis_level == "L3"
        and site.matched_rule_id == "py-openai-chat-completions"
        for site in result.ai_call_sites
    )


@pytest.mark.p0
def test_t09_sklearn_predict_detected(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "ml.py").write_text(
        "from sklearn.linear_model import LogisticRegression\n"
        "model = LogisticRegression()\n"
        "model.predict(X)\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    site = next(site for site in result.ai_call_sites if site.matched_rule_id == "py-sklearn-predict")
    assert site.finding_type == "AI_PROVIDER_USAGE"
    assert site.confidence == 0.65


@pytest.mark.p0
def test_t10_llamaindex_query_engine_detected(workspace_dir: Path) -> None:
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    (workspace_dir / "rag.py").write_text(
        "from llama_index.core import VectorStoreIndex\n"
        "index = VectorStoreIndex([])\n"
        "index.as_query_engine().query(question)\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    assert any(
        site.matched_rule_id == "py-llamaindex-query"
        and site.finding_type == "RAG_USAGE_SIGNAL"
        for site in result.ai_call_sites
    )


@pytest.mark.p0
def test_t11_python_cst_parser_executes_the_pinned_libcst_backend(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tools.common.capabilities.evidence.scanner.parsers.python.python_cst_parser as parser_module

    source_file = workspace_dir / "app.py"
    source_file.write_text(
        "client.responses.create(model='gpt-4o', messages=[])\n",
        encoding="utf-8",
    )
    calls = 0
    real_parse_module = parser_module.cst.parse_module

    def tracking_parse_module(source: str):
        nonlocal calls
        calls += 1
        return real_parse_module(source)

    monkeypatch.setattr(parser_module.cst, "parse_module", tracking_parse_module)

    names = parser_module.PythonCstParser().kwarg_names_for_calls(
        source_file,
        workspace_dir,
    )

    assert calls == 1
    assert names == {1: ["model", "messages"]}
    assert parser_module.PythonCstParser.tool_version() != "not-installed"


@pytest.mark.p0
def test_t12_python_cst_parse_error_records_coverage_limitation(
    workspace_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import tools.common.capabilities.evidence.scanner.parsers.python.python_cst_parser as parser_module
    from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer

    source_file = workspace_dir / "app.py"
    source_file.write_text(
        "client.responses.create(model='gpt-4o', messages=[])\n",
        encoding="utf-8",
    )

    def fail_parse_module(source: str):
        raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid")

    monkeypatch.setattr(parser_module.cst, "parse_module", fail_parse_module)

    result = PythonAnalyzer(workspace_dir).analyze()

    assert result.files_analyzed == 1
    assert result.files_skipped == 0
    assert result.coverage_limitation is True
    assert result.coverage_limitations == [
        "python_libcst_parse_failed: file=app.py reason=UnicodeDecodeError"
    ]
