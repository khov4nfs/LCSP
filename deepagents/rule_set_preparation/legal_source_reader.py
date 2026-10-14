"""Native read-only subagent specification for one pinned legal-source document."""

from __future__ import annotations

from typing import Any

from deepagents.backends.protocol import BackendProtocol
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from pydantic import BaseModel, ConfigDict, Field

from rule_set_preparation.legal_source_files import LEGAL_SOURCE_ROOT

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


class LegalSourceReaderResult(BaseModel):
    """Structured, source-grounded result for one assigned document."""

    model_config = ConfigDict(extra="forbid")

    documentId: str
    findings: list[LegalSourceReaderFinding] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)


LEGAL_SOURCE_READER_PROMPT = """You are the read-only legal-source-reader subagent.

The parent assigns exactly one document from the pinned `/legal-source` tree and gives you its
exact document directory. Read and interpret only that assigned document. Use only `ls`, `glob`,
`grep`, and `read_file`; never write files or access repository, assessment, customer, or runtime
data. Return the required structured result with candidate findings and exact
`documentId`/`locator`/`contentSha256` references from the files you actually read.

Your findings are candidates for the Preparation Root. Do not reconcile documents, decide the
complete rule set, validate a packet, submit a packet, activate anything, or call another agent.
Report gaps when the assigned source cannot be read or a required cross-reference leaves this
document's scope. The parent alone resolves cross-document meaning and owns validation/submission.
"""


def legal_source_reader_subagent(
    *, model: Any, backend: BackendProtocol, observation_middleware: Any | None = None
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
        "tools": [],
        # Deep Agents compiles inline subagents from their own middleware spec.
        "middleware": [
            FilesystemMiddleware(
                backend=backend,
                tools=READ_ONLY_TOOLS,
                _permissions=permissions,
            ),
            *([observation_middleware] if observation_middleware is not None else []),
            *MODEL_GOVERNANCE_MIDDLEWARE,
        ],
        "permissions": permissions,
        "system_prompt": LEGAL_SOURCE_READER_PROMPT,
        "response_format": LegalSourceReaderResult,
    }
