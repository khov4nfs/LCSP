from __future__ import annotations
from collections import defaultdict
from dataclasses import replace
from tools.graph.scanner.tools.syft_tool import SBOMEntry
from .dependency_fact import DependencyUsageFact, PackageDependency, USAGE_DECLARED, USAGE_MISSING, USAGE_TRANSITIVE, USAGE_USED, is_ai_package, normalize_package_name

class DependencyNormalizer:
    """Merge inventory, license and actual-usage signals without equating declaration with use."""
    def normalize(self, *, sbom_entries: list[SBOMEntry], usage_facts: list[DependencyUsageFact]) -> list[PackageDependency]:
        facts_by_package: dict[str, list[DependencyUsageFact]] = defaultdict(list)
        for fact in usage_facts: facts_by_package[normalize_package_name(fact.package_name)].append(fact)
        packages: dict[str, PackageDependency] = {}
        for entry in sbom_entries:
            key = normalize_package_name(entry.name); facts = list(facts_by_package.pop(key, []))
            if not facts:
                facts.append(DependencyUsageFact(entry.name, entry.version or None, entry.ecosystem, self._sbom_only_state(entry), "syft", [entry.location] if entry.location else [], is_ai_package(entry.name)))
            packages[key] = PackageDependency(entry.name, entry.version or None, entry.ecosystem, entry.purl or None, self._normalize_ai_flags(facts), self._confidence_boost(facts), is_ai_package(entry.name), entry.license or None)
        for key, facts in facts_by_package.items():
            first = facts[0]; packages[key] = PackageDependency(first.package_name, first.version, first.ecosystem, None, self._normalize_ai_flags(facts), self._confidence_boost(facts), is_ai_package(first.package_name), None)
        return [packages[key] for key in sorted(packages)]
    @staticmethod
    def _sbom_only_state(entry: SBOMEntry) -> str:
        location = entry.location.lower(); return USAGE_TRANSITIVE if any(name in location for name in ("lock", "node_modules", "site-packages")) else USAGE_DECLARED
    @staticmethod
    def _confidence_boost(facts: list[DependencyUsageFact]) -> float:
        tools = {f.source_tool for f in facts if f.usage_state in {USAGE_USED, USAGE_MISSING}}; return min(0.15, round(0.05 * len(tools), 2))
    @staticmethod
    def _normalize_ai_flags(facts: list[DependencyUsageFact]) -> list[DependencyUsageFact]: return [replace(f, is_ai_relevant=is_ai_package(f.package_name)) for f in facts]
