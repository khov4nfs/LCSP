from pathlib import Path
from typing import Sequence
from tools.common.capabilities.evidence.scanner.analyzers.systems_analysis import SystemsAnalyzer
from tools.common.capabilities.evidence.scanner.analyzers.protocol import ANALYZER_PARTIAL, ANALYZER_SUCCESS, AnalyzerCapability, CanonicalAnalyzerResult
class _SystemsAdapter:
    language=""
    def supports(self,language): return language==self.language
    def capabilities(self): return AnalyzerCapability(symbols=True,imports=True,calls=True,dependencies=True,dynamic_resolution=False,ai_invocations=True)
    def analyze(self,workspace:Path,include_files:Sequence[str]|None):
        native=SystemsAnalyzer(workspace,self.language).analyze(include_files); status=ANALYZER_PARTIAL if native.files_skipped or native.coverage_limitations or native.unsupported_dynamic_flows else ANALYZER_SUCCESS
        return CanonicalAnalyzerResult(language=self.language,status=status,capabilities=self.capabilities(),native_result=native,files_analyzed=native.files_analyzed,files_skipped=native.files_skipped,coverage_limitations=native.coverage_limitations,unsupported_dynamic_flows=native.unsupported_dynamic_flows,semantic_facts=tuple(native.semantic_program.nodes),dependencies=native.package_dependencies)
class GoLanguageAdapter(_SystemsAdapter): language="go"
class RustLanguageAdapter(_SystemsAdapter): language="rust"
