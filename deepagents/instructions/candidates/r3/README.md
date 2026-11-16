# Instruction repair candidate r3

This revision repairs six entries in the 59-entry bundle. It remains PENDING;
session authorization to review is not a claim that the remaining entries have
completed semantic review. Existing r1/r2 English candidates were not overwritten.

Five damaged VI source files were restored in place as explicit source revisions:
response-transform, structured-transform, file-deletion, upstream assessment tool
descriptions and tool-schema guidance. Original source bytes are preserved under
`instructions/revisions/r3/before/`. `repair-evidence.json` binds each old/new source
and candidate digest. The previous pending manifest retains its historical bytes;
its old source hashes intentionally do not describe the newly repaired source files.
Use this revision's manifest for current candidate validation.

The budget candidate now explicitly preserves accepted work and truthful metering,
forbids increasing quota or completing API lifecycle through prompt text, preserves
the grace-call terminal exception, and prohibits repeating the same trimmed call.

The five `preparation.*` schema keys missing from r2 have been translated and retained
for source-key completeness. A source search found no Python access by those literal
keys. The active `approved_tool_specs` projection looks up `owner.field` keys using
the tool's actual schema title; retaining these legacy `preparation.*` entries does
not install new fields, tools or execution permissions. Pagination still comes from
the actual tool schemas and handlers (claim pages capped at 20, authoring pages at 40).
The optional packet guidance cannot override frozen/direct-mode contracts.

The new candidate preserves the VI source key sets for schema guidance, upstream
tools and budget instructions. It also makes previously omitted pagination,
selected-scope and UNKNOWN-answer constraints explicit in the affected EN entries.

Validation must include strict inventory, candidate compilation and the existing
runtime approval/integrity tests. A successful structural check or test fixture
approval must never become a production approval record.
