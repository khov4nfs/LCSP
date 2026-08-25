from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.python_analysis.python_analyzer import PythonAnalyzer
from tools.common.capabilities.evidence.scanner.dependencies.dependency_fact import is_ai_package


def test_google_genai_dependency_is_ai_relevant() -> None:
    assert is_ai_package("google-genai") is True
    # Legacy dependency stays recognized when LCSP scans customer repositories.
    assert is_ai_package("google-generativeai") is True


def test_google_genai_client_generate_content_is_detected(workspace_dir: Path) -> None:
    source = workspace_dir / "gemini_client.py"
    source.write_text(
        "from google import genai\n"
        "client = genai.Client(api_key='test-key')\n"
        "client.models.generate_content(\n"
        "    model='gemini-2.5-flash',\n"
        "    contents='safe placeholder',\n"
        ")\n",
        encoding="utf-8",
    )

    result = PythonAnalyzer(workspace_dir).analyze()

    site = next(
        site
        for site in result.ai_call_sites
        if site.matched_rule_id == "py-google-genai-client-generate"
    )
    assert site.finding_type == "AI_PROVIDER_USAGE"
    assert site.analysis_level == "L1"
    assert site.kwarg_names == ["model", "contents"]
