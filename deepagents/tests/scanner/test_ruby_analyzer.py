from pathlib import Path

from tools.common.capabilities.evidence.scanner.analyzers.adapters import RubyLanguageAdapter
from tools.common.capabilities.evidence.scanner.analyzers.ruby_analysis.ruby_analyzer import RubyAnalyzer


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_ruby_symbols_requires_calls_and_dynamic_dispatch(tmp_path: Path) -> None:
    _write(
        tmp_path / "Gemfile",
        'gem "ruby-openai", "~> 7"\ngem "anthropic"\n',
    )
    _write(
        tmp_path / "app.rb",
        '''module Payments
  class Client
    def self.build
      OpenAI::Client.new
    end

    def charge(value)
      client.chat(value)
      public_send(value)
    end
  end
end
require "openai"
require_relative "services/client"
''',
    )

    result = RubyAnalyzer(tmp_path).analyze(["app.rb"])
    labels = {node.label for node in result.semantic_program.nodes}
    assert "Payments" in labels
    assert "Client" in labels
    assert any("Payments::Client" in label for label in labels)
    assert {dependency.name for dependency in result.package_dependencies} >= {
        "ruby-openai",
        "anthropic",
        "openai",
    }
    assert result.unsupported_dynamic_flows
    assert any(finding.finding_type == "AI_MODEL_INVOCATION" for finding in result.findings)
    assert all(node.file_path == "app.rb" for node in result.semantic_program.nodes)


def test_ruby_dependency_only_does_not_create_ai_finding(tmp_path: Path) -> None:
    _write(tmp_path / "Gemfile", 'gem "ruby-openai"\n')
    _write(tmp_path / "app.rb", "class Service; def generate; end; end\n")

    result = RubyLanguageAdapter().analyze(tmp_path, ["app.rb"])

    assert result.findings == ()
    assert result.dependencies
    assert result.status == "SUCCESS"


def test_malformed_ruby_is_partial_not_repository_failure(tmp_path: Path) -> None:
    _write(tmp_path / "bad.rb", "class Broken\n  def missing(\n")

    result = RubyLanguageAdapter().analyze(tmp_path, ["bad.rb"])

    assert result.status == "PARTIAL"
    assert result.coverage_limitations


def test_ruby_semantic_keys_are_deterministic(tmp_path: Path) -> None:
    _write(tmp_path / "app.rb", "module A\n class B\n  def run; end\n end\nend\n")

    first = RubyAnalyzer(tmp_path).analyze(["app.rb"])
    second = RubyAnalyzer(tmp_path).analyze(["app.rb"])

    assert [node.key for node in first.semantic_program.nodes] == [
        node.key for node in second.semantic_program.nodes
    ]
    assert [
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in first.semantic_program.edges
    ] == [
        (edge.edge_type, edge.source_key, edge.target_key)
        for edge in second.semantic_program.edges
    ]
