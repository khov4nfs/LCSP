"""Native read-only subagent specification for one pinned legal-source document."""

from __future__ import annotations

from typing import Any

from deepagents.backends.protocol import BackendProtocol
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE, governed_summarization_middleware
from middleware.usage_metering import AgentRoleMiddleware
from pydantic import BaseModel, ConfigDict, Field

from rule_set_preparation.legal_source_files import LEGAL_SOURCE_ROOT
from rule_set_preparation.source_graph import PinnedSourceGraph, build_source_graph_tools

LEGAL_SOURCE_READER_NAME = "legal-source-reader"
READ_ONLY_TOOLS = ["ls", "glob", "grep", "read_file"]


class LegalSourceReaderSourceRef(BaseModel):
    """Exact pinned identity for a source passage cited by a child finding."""

    model_config = ConfigDict(extra="forbid")

    documentId: str
    locator: str
    contentSha256: str


class LegalSourceReaderFinding(BaseModel):
    """Candidate legal observation returned to the preparation parent."""

    model_config = ConfigDict(extra="forbid")

    statement: str
    sourceRefs: list[LegalSourceReaderSourceRef] = Field(default_factory=list)
    sourceNodeIds: list[str] = Field(default_factory=list)


class LegalSourceReaderResult(BaseModel):
    """Structured, source-grounded result for one assigned document."""

    model_config = ConfigDict(extra="forbid")

    documentId: str
    findings: list[LegalSourceReaderFinding] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    unresolvedReferenceIds: list[str] = Field(default_factory=list)


LEGAL_SOURCE_READER_PROMPT = """You are the read-only legal-source-reader subagent.

The parent assigns one document from the pinned Legal Document AST and `/legal-source` tree.
Read and interpret the assigned document using the bounded structural tools and read-only files.
Use parent/child/ancestor/sibling and explicit reference traversal to preserve source context.
Never write files or access repository, assessment, customer or runtime data. Return every distinct
candidate semantic finding with sourceNodeIds and exact documentId/locator/contentSha256 provenance
from the nodes and derived/legacy chunks you inspected. A node may contain several distinct claims;
context does not erase an operative duty, and temporal facts remain distinct candidates.

Your findings are candidates for the Preparation Root. Do not reconcile documents, decide the
complete rule set, validate a packet, submit a packet, activate anything, or call another agent.
Report gaps when the assigned source cannot be read or a required cross-reference leaves this
document's scope. The parent alone resolves cross-document meaning and owns validation/submission.
"""


def legal_source_reader_subagent(
    *, model: Any, backend: BackendProtocol, observation_middleware: Any | None = None,
    source_graph: PinnedSourceGraph | None = None,
) -> dict[str, Any]:
    """Return the native ``SubAgent`` declaration used by the Preparation Root."""

    permissions = [
        FilesystemPermission(
            ["read"], [LEGAL_SOURCE_ROOT, f"{LEGAL_SOURCE_ROOT}/**"], mode="allow"
        ),
        FilesystemPermission(["read"], ["/**"], mode="deny"),
        FilesystemPermission(["write"], ["/**"], mode="deny"),
    ]
    # Native SubAgentMiddleware/ToolNode owns task execution and same-turn concurrency.
    return {
        "name": LEGAL_SOURCE_READER_NAME,
        "description": (
            "Read and interpret one assigned document under /legal-source, returning candidate "
            "findings with exact pinned source references. It cannot validate or submit."
        ),
        "model": model,
        "tools": build_source_graph_tools(source_graph) if source_graph else [],
        # Deep Agents compiles inline subagents from their own middleware spec.
        "middleware": [
            FilesystemMiddleware(
                backend=backend,
                tools=READ_ONLY_TOOLS,
                _permissions=permissions,
            ),
            *([observation_middleware] if observation_middleware is not None else []),
            governed_summarization_middleware(
                model, backend=backend, role="rule-set-preparation"
            ),
            AgentRoleMiddleware("rule-set-preparation"),
            *MODEL_GOVERNANCE_MIDDLEWARE,
        ],
        "permissions": permissions,
        "system_prompt": LEGAL_SOURCE_READER_PROMPT,
        "response_format": LegalSourceReaderResult,
    }
