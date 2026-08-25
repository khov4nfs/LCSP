"""Canonical AI/model lifecycle extraction for the unified evidence graph.

This pass distinguishes repository evidence for building/maintaining models from plain
inference/provider consumption. Framework-specific syntax is normalized into stable
lifecycle nodes/edges; dependency presence alone never creates a lifecycle stage.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

_EXCLUDED = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "bin",
    "obj",
}
_SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}

_FRAMEWORK_HINT = re.compile(
    r"torch|pytorch|tensorflow|keras|sklearn|scikit|xgboost|lightgbm|transformers|huggingface|mlflow|bentoml",
    re.I,
)
_DATASET_PATTERNS = (
    re.compile(r"\bload_dataset\s*\(", re.I),
    re.compile(r"\bread_(?:csv|parquet|json|feather)\s*\(", re.I),
    re.compile(r"\bDataLoader\s*\(", re.I),
    re.compile(r"\btf\.data\.Dataset\b", re.I),
    re.compile(r"\bDataset\.from_", re.I),
)
_TRAIN_PATTERNS = (
    re.compile(r"\b(?:model|estimator|classifier|regressor|clf)\.fit\s*\(", re.I),
    re.compile(r"\btrainer\.train\s*\(", re.I),
    re.compile(r"\bxgb\.train\s*\(", re.I),
    re.compile(r"\blgb\.train\s*\(", re.I),
)
_TORCH_TRAIN_COMPONENTS = (
    re.compile(r"\.backward\s*\(", re.I),
    re.compile(r"optimizer\.step\s*\(", re.I),
)
_FINE_TUNE_PATTERNS = (
    re.compile(r"\bSFTTrainer\b", re.I),
    re.compile(r"\b(?:LoraConfig|LoRA|peft)\b", re.I),
    re.compile(r"fine[_ .-]?tun(?:e|ing)", re.I),
    re.compile(r"fine_tuning\.jobs\.create", re.I),
)
_EVALUATE_PATTERNS = (
    re.compile(r"\btrainer\.evaluate\s*\(", re.I),
    re.compile(r"\bmodel\.evaluate\s*\(", re.I),
    re.compile(r"\b(?:classification_report|roc_auc_score|mean_squared_error|accuracy_score)\s*\(", re.I),
)
_SAVE_PATTERNS = (
    re.compile(r"\bsave_pretrained\s*\(", re.I),
    re.compile(r"\btorch\.save\s*\(", re.I),
    re.compile(r"\b(?:joblib|pickle)\.dump\s*\(", re.I),
    re.compile(r"\bmodel\.save\s*\(", re.I),
    re.compile(r"\b(?:onnx\.export|torch\.onnx\.export)\s*\(", re.I),
)
_REGISTER_PATTERNS = (
    re.compile(r"\bmlflow\.register_model\s*\(", re.I),
    re.compile(r"\bmlflow\.[A-Za-z0-9_]+\.log_model\s*\(", re.I),
    re.compile(r"\bregister_model\s*\(", re.I),
)
_SERVE_PATTERNS = (
    re.compile(r"\bbentoml\.(?:service|serve|models)\b", re.I),
    re.compile(r"\btorchserve\b", re.I),
    re.compile(r"\bmlflow\.models\b", re.I),
    re.compile(r"\b(?:predict|infer|inference)_endpoint\b", re.I),
)
_MONITOR_PATTERNS = (
    re.compile(r"\bevidently\b", re.I),
    re.compile(r"\bmodel[_ .-]?monitor", re.I),
    re.compile(r"\bprediction[_ .-]?monitor", re.I),
)
_DRIFT_PATTERNS = (
    re.compile(r"\b(?:data|model|concept)[_ .-]?drift\b", re.I),
    re.compile(r"\bdrift[_ .-]?(?:detect|score|report)\b", re.I),
)
_RETRAIN_PATTERNS = (
    re.compile(r"\bretrain(?:ing)?\b", re.I),
    re.compile(r"\bre[_ .-]?train[_ .-]?model\b", re.I),
)
_INFER_PATTERNS = (
    re.compile(r"\b(?:model|clf|estimator)\.(?:predict|predict_proba|decision_function)\s*\(", re.I),
    re.compile(r"\bmodel\.generate\s*\(", re.I),
    re.compile(r"\bpipeline\s*\(", re.I),
)


@dataclass(frozen=True)
class _Hit:
    kind: str
    node_type: str
    line: int


class AILifecycleExtractor:
    """Emit model lifecycle evidence only from concrete source behavior."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        for path in self._files():
            rel = path.relative_to(self.workspace).as_posix()
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            hits = self._hits(text)
            if not hits:
                continue
            self._emit_file_lifecycle(program, rel, text, hits)
        return program

    def _emit_file_lifecycle(
        self,
        program: SemanticProgram,
        rel: str,
        text: str,
        hits: tuple[_Hit, ...],
    ) -> None:
        system_key = f"ai-system:{rel}"
        model_key = f"model:{rel}"
        has_training = any(hit.node_type in {"TRAINING_JOB", "FINE_TUNING_JOB", "RETRAINING_JOB"} for hit in hits)
        has_inference = any(hit.kind == "MODEL_INFER" for hit in hits)
        program.add_node(
            SemanticNodeFact(
                system_key,
                "AI_SYSTEM",
                f"AI system evidence in {rel}",
                rel,
                min(hit.line for hit in hits),
                max(hit.line for hit in hits),
                attributes={
                    "repositoryTrainingPresent": has_training,
                    "inferencePresent": has_inference,
                },
                origin="AI_LIFECYCLE_ANALYSIS",
                resolution_state="CORROBORATED",
            )
        )
        program.add_node(
            SemanticNodeFact(
                model_key,
                "MODEL",
                "repository model",
                rel,
                min(hit.line for hit in hits),
                max(hit.line for hit in hits),
                attributes={"ownershipSignal": "REPOSITORY_TRAINING_PRESENT" if has_training else "UNRESOLVED"},
                origin="AI_LIFECYCLE_ANALYSIS",
                resolution_state="CORROBORATED" if has_training else "INFERRED",
            )
        )
        program.add_edge(
            SemanticEdgeFact(
                "CONTAINS",
                system_key,
                model_key,
                origin="AI_LIFECYCLE_ANALYSIS",
                resolution_state="CORROBORATED" if has_training else "INFERRED",
            )
        )

        stage_keys: dict[str, list[str]] = {}
        for ordinal, hit in enumerate(hits):
            if hit.kind == "MODEL_INFER":
                invocation = self._nearest_existing_invocation(program, rel, hit.line)
                endpoint_key = f"model-endpoint:{rel}:{hit.line}:{ordinal}"
                program.add_node(
                    SemanticNodeFact(
                        endpoint_key,
                        "MODEL_ENDPOINT",
                        "model inference",
                        rel,
                        hit.line,
                        hit.line,
                        origin="AI_LIFECYCLE_ANALYSIS",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "SERVES_MODEL",
                        model_key,
                        endpoint_key,
                        origin="AI_LIFECYCLE_ANALYSIS",
                        resolution_state="CORROBORATED",
                    )
                )
                if invocation:
                    program.add_edge(
                        SemanticEdgeFact(
                            "RESOLVES_TO",
                            invocation,
                            endpoint_key,
                            origin="AI_LIFECYCLE_ANALYSIS",
                            resolution_state="CORROBORATED",
                        )
                    )
                stage_keys.setdefault(hit.kind, []).append(endpoint_key)
                continue

            key = f"ai-lifecycle:{rel}:{hit.kind}:{hit.line}:{ordinal}"
            program.add_node(
                SemanticNodeFact(
                    key,
                    hit.node_type,
                    hit.kind.lower().replace("_", " "),
                    rel,
                    hit.line,
                    hit.line,
                    attributes={"lifecycleStage": hit.kind},
                    origin="AI_LIFECYCLE_ANALYSIS",
                    resolution_state="CORROBORATED",
                )
            )
            stage_keys.setdefault(hit.kind, []).append(key)

            edge_type = {
                "MODEL_TRAIN": "TRAINS_MODEL_WITH",
                "MODEL_FINE_TUNE": "FINE_TUNES",
                "MODEL_EVALUATE": "EVALUATES_MODEL",
                "MODEL_MONITOR": "MONITORS_MODEL",
                "MODEL_RETRAIN": "RETRAINS_MODEL",
            }.get(hit.kind)
            if edge_type:
                program.add_edge(
                    SemanticEdgeFact(
                        edge_type,
                        key,
                        model_key,
                        origin="AI_LIFECYCLE_ANALYSIS",
                        resolution_state="CORROBORATED",
                    )
                )

        dataset_keys = stage_keys.get("DATASET_LOAD", [])
        training_keys = [
            *stage_keys.get("MODEL_TRAIN", []),
            *stage_keys.get("MODEL_FINE_TUNE", []),
            *stage_keys.get("MODEL_RETRAIN", []),
        ]
        for dataset_key in dataset_keys:
            for training_key in training_keys:
                program.add_edge(
                    SemanticEdgeFact(
                        "FLOWS_TO",
                        dataset_key,
                        training_key,
                        origin="AI_LIFECYCLE_ANALYSIS",
                        resolution_state="CORROBORATED",
                    )
                )

        artifact_keys = stage_keys.get("MODEL_SAVE", [])
        for artifact_job_key in artifact_keys:
            artifact_key = f"model-artifact:{artifact_job_key}"
            node = next((item for item in program.nodes if item.key == artifact_job_key), None)
            line = node.start_line if node else 1
            program.add_node(
                SemanticNodeFact(
                    artifact_key,
                    "MODEL_ARTIFACT",
                    "model artifact",
                    rel,
                    line,
                    line,
                    origin="AI_LIFECYCLE_ANALYSIS",
                    resolution_state="CORROBORATED",
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "PRODUCES_MODEL_ARTIFACT",
                    model_key,
                    artifact_key,
                    origin="AI_LIFECYCLE_ANALYSIS",
                    resolution_state="CORROBORATED",
                )
            )
            for registry_job in stage_keys.get("MODEL_REGISTER", []):
                registry_key = f"model-registry:{registry_job}"
                registry_node = next((item for item in program.nodes if item.key == registry_job), None)
                registry_line = registry_node.start_line if registry_node else line
                program.add_node(
                    SemanticNodeFact(
                        registry_key,
                        "MODEL_REGISTRY",
                        "model registry",
                        rel,
                        registry_line,
                        registry_line,
                        origin="AI_LIFECYCLE_ANALYSIS",
                        resolution_state="CORROBORATED",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "REGISTERS_MODEL",
                        artifact_key,
                        registry_key,
                        origin="AI_LIFECYCLE_ANALYSIS",
                        resolution_state="CORROBORATED",
                    )
                )

    def _hits(self, text: str) -> tuple[_Hit, ...]:
        framework_present = bool(_FRAMEWORK_HINT.search(text))
        hits: list[_Hit] = []

        for pattern in _DATASET_PATTERNS:
            hits.extend(self._pattern_hits(text, pattern, "DATASET_LOAD", "DATASET"))

        if framework_present:
            for pattern in _TRAIN_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_TRAIN", "TRAINING_JOB"))
            if all(pattern.search(text) for pattern in _TORCH_TRAIN_COMPONENTS):
                line = _first_line(text, _TORCH_TRAIN_COMPONENTS[0])
                hits.append(_Hit("MODEL_TRAIN", "TRAINING_JOB", line))
            for pattern in _FINE_TUNE_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_FINE_TUNE", "FINE_TUNING_JOB"))
            for pattern in _EVALUATE_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_EVALUATE", "EVALUATION_JOB"))
            for pattern in _SAVE_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_SAVE", "MODEL_ARTIFACT"))
            for pattern in _REGISTER_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_REGISTER", "MODEL_REGISTRY"))
            for pattern in _SERVE_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_DEPLOY", "MODEL_DEPLOYMENT"))
            for pattern in _MONITOR_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_MONITOR", "MODEL_MONITORING"))
            for pattern in _DRIFT_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "DRIFT_DETECT", "MODEL_DRIFT_SIGNAL"))
            for pattern in _RETRAIN_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_RETRAIN", "RETRAINING_JOB"))
            for pattern in _INFER_PATTERNS:
                hits.extend(self._pattern_hits(text, pattern, "MODEL_INFER", "MODEL_ENDPOINT"))

        deduped = {(hit.kind, hit.node_type, hit.line): hit for hit in hits}
        return tuple(sorted(deduped.values(), key=lambda item: (item.line, item.kind)))

    @staticmethod
    def _pattern_hits(text: str, pattern: re.Pattern[str], kind: str, node_type: str) -> list[_Hit]:
        return [
            _Hit(kind, node_type, _line(text, match.start()))
            for match in pattern.finditer(text)
        ]

    @staticmethod
    def _nearest_existing_invocation(program: SemanticProgram, rel: str, line: int) -> str | None:
        rows = [
            node
            for node in program.nodes
            if node.node_type == "AI_MODEL_INVOCATION"
            and node.file_path == rel
            and node.start_line is not None
        ]
        if not rows:
            return None
        nearest = min(rows, key=lambda node: abs(int(node.start_line or 0) - line))
        return nearest.key if abs(int(nearest.start_line or 0) - line) <= 3 else None

    def _files(self) -> tuple[Path, ...]:
        result = []
        for path in self.workspace.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in _SOURCE_EXTENSIONS:
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel):
                continue
            result.append(path)
        return tuple(sorted(result))


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1


def _first_line(text: str, pattern: re.Pattern[str]) -> int:
    match = pattern.search(text)
    return _line(text, match.start()) if match else 1
