"""Development-only unredacted runtime tracing.

This module is intentionally unsafe and must never be enabled in production.
It exists so local developers can inspect values crossing LCSP runtime boundaries
while the normal persistence/callback privacy controls remain intact.

When ``LCSP_DEV_UNSAFE_TRACE=true`` trace records are written as JSON lines to
stderr. Small text payloads remain unredacted. Large strings and collections are
bounded so diagnostic tracing cannot flood a pipe. Binary payloads and oversized
byte buffers are omitted entirely from trace records; repository archives must
never be emitted, hashed, previewed, or hex-encoded in logs. Serialization/write
failures are fail-open by design.
"""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
import sys
from typing import Any, Mapping, Sequence

from lcsp_workers.platform.correlation import get_correlationId


_TRUE_VALUES = {"1", "true", "yes", "on"}
_MAX_INLINE_UTF8_BYTES = 64 * 1024
_MAX_TRACE_COLLECTION_ITEMS = 16
_MAX_INLINE_TRACE_STRING_CHARS = 16 * 1024
_TRACE_STRING_PREVIEW_CHARS = 2048
_OMIT_TRACE_FIELD = object()


def unsafe_dev_trace_enabled() -> bool:
    """Return whether explicitly opted-in raw development tracing is enabled.

    Raises:
        RuntimeError: If raw tracing is requested while ``NODE_ENV=production``.
    """
    enabled = os.getenv("LCSP_DEV_UNSAFE_TRACE", "").strip().lower() in _TRUE_VALUES
    if not enabled:
        return False
    if os.getenv("NODE_ENV", "").strip().lower() == "production":
        raise RuntimeError(
            "LCSP_DEV_UNSAFE_TRACE must never be enabled with NODE_ENV=production"
        )
    return True


def unsafe_dev_unfiltered_enabled() -> bool:
    """Return whether explicitly opted-in raw, unfiltered development tracing is enabled.

    Raises:
        RuntimeError: If unfiltered tracing is requested while ``NODE_ENV=production``.
    """
    enabled = os.getenv("LCSP_DEV_UNSAFE_UNFILTERED", "").strip().lower() in _TRUE_VALUES
    if not enabled:
        return False
    if os.getenv("NODE_ENV", "").strip().lower() == "production":
        raise RuntimeError(
            "LCSP_DEV_UNSAFE_UNFILTERED must never be enabled with NODE_ENV=production"
        )
    return True


def _find_id_recursive(data: Any, keys: set[str], seen: set[int] | None = None) -> Any | None:
    if seen is None:
        seen = set()
    if data is None or isinstance(data, (bool, int, float, bytes, bytearray)):
        return None
    if isinstance(data, str):
        return None
    obj_id = id(data)
    if obj_id in seen:
        return None
    seen.add(obj_id)
    try:
        if isinstance(data, Mapping):
            for k, v in data.items():
                if str(k) in keys and isinstance(v, (str, int)):
                    return v
                res = _find_id_recursive(v, keys, seen)
                if res is not None:
                    return res
        elif isinstance(data, Sequence):
            for item in data:
                res = _find_id_recursive(item, keys, seen)
                if res is not None:
                    return res
        elif hasattr(data, "__dict__"):
            for k, v in vars(data).items():
                if str(k) in keys and isinstance(v, (str, int)):
                    return v
                res = _find_id_recursive(v, keys, seen)
                if res is not None:
                    return res
    except Exception:
        pass
    finally:
        seen.discard(obj_id)
    return None


def _find_count_recursive(data: Any, target_key: str, seen: set[int] | None = None) -> int | None:
    if seen is None:
        seen = set()
    if data is None or isinstance(data, (bool, int, float, bytes, bytearray, str)):
        return None
    obj_id = id(data)
    if obj_id in seen:
        return None
    seen.add(obj_id)
    try:
        if isinstance(data, Mapping):
            for k, v in data.items():
                if str(k) == target_key:
                    if isinstance(v, (Sequence, Mapping)) and not isinstance(v, (str, bytes, bytearray)):
                        return len(v)
                res = _find_count_recursive(v, target_key, seen)
                if res is not None:
                    return res
        elif isinstance(data, Sequence):
            for item in data:
                res = _find_count_recursive(item, target_key, seen)
                if res is not None:
                    return res
        elif hasattr(data, "__dict__"):
            for k, v in vars(data).items():
                if str(k) == target_key:
                    if isinstance(v, (Sequence, Mapping)) and not isinstance(v, (str, bytes, bytearray)):
                        return len(v)
                res = _find_count_recursive(v, target_key, seen)
                if res is not None:
                    return res
    except Exception:
        pass
    finally:
        seen.discard(obj_id)
    return None


def _summarize_trace_fields(event: str, fields: Mapping[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    
    # 1. Extract metadata from outer fields or nested structures
    scan_job_id = _find_id_recursive(fields, {"scan_job_id", "scanJobId"})
    snapshot_id = _find_id_recursive(fields, {"snapshot_id", "snapshotId"})
    snapshot_ref = _find_id_recursive(fields, {"snapshot_ref", "snapshotRef"})
    corpus_version_id = _find_id_recursive(fields, {"corpus_version_id", "corpusVersionId"})
    assessment_id = _find_id_recursive(fields, {"assessment_id", "assessmentId"})
    workflow_run_id = _find_id_recursive(fields, {"workflow_run_id", "workflowRunId"})
    
    if scan_job_id is not None:
        summary["scan_job_id"] = scan_job_id
    if snapshot_id is not None:
        summary["snapshot_id"] = snapshot_id
    if snapshot_ref is not None:
        summary["snapshot_ref"] = snapshot_ref
    if corpus_version_id is not None:
        summary["corpus_version_id"] = corpus_version_id
    if assessment_id is not None:
        summary["assessment_id"] = assessment_id
    if workflow_run_id is not None:
        summary["workflow_run_id"] = workflow_run_id

    # 2. Extract counts (node_count, edge_count)
    node_count = _find_count_recursive(fields, "nodes")
    edge_count = _find_count_recursive(fields, "edges")
    
    if "node_count" in fields:
        node_count = fields["node_count"]
    elif "nodeCount" in fields:
        node_count = fields["nodeCount"]
        
    if "edge_count" in fields:
        edge_count = fields["edge_count"]
    elif "edgeCount" in fields:
        edge_count = fields["edgeCount"]
        
    if node_count is not None:
        summary["node_count"] = node_count
    if edge_count is not None:
        summary["edge_count"] = edge_count

    # 3. Process specific fields
    for k, v in fields.items():
        if any(sec_key in k.lower() for sec_key in ("api_key", "secret", "token", "password", "authorization")):
            summary[k] = "[REDACTED]"
            continue
            
        if k in ("payload", "body", "result", "results", "tool_input", "response", "params"):
            payload_size = 0
            if isinstance(v, (str, bytes, bytearray)):
                payload_size = len(v)
            else:
                try:
                    payload_size = len(json.dumps(_json_safe(v)))
                except Exception:
                    payload_size = len(str(v))
                    
            summary[f"{k}_size"] = payload_size
            
            if event in ("DEV_WORKER_HTTP_REQUEST_RAW", "DEV_WORKER_HTTP_RESPONSE_RAW", "DEV_WORKER_HTTP_ERROR_RAW"):
                limit = 52428800
                summary[f"{k}_limit"] = limit
                summary[f"{k}_truncated"] = payload_size > limit
            
            item_count = None
            if isinstance(v, Mapping):
                item_count = len(v)
            elif isinstance(v, Sequence) and not isinstance(v, (str, bytes, bytearray)):
                item_count = len(v)
            elif hasattr(v, "__dict__"):
                item_count = len(vars(v))
                
            if item_count is not None:
                summary[f"{k}_itemCount"] = item_count
            continue
            
        if k in (
            "method", "base_url", "path", "url", "timeout", "max_retries", 
            "error_type", "error", "dispatcher", "tool_name", "runtime_target", 
            "downstream_target", "worker", "queue_name", "routing_key", 
            "attempts", "max_tool_calls", "operation", "provider", "model",
            "duration", "timing", "error_code", "status_code", "status", "outcome"
        ) or isinstance(v, (bool, int, float)) or v is None:
            summary[k] = v
        else:
            if isinstance(v, str) and len(v) < 256:
                summary[k] = v
                
    return summary


def emit_dev_unsafe_trace(event: str, /, **fields: Any) -> None:
    """Emit one bounded development trace record without affecting runtime semantics.

    The production guard is intentionally evaluated before the fail-open block:
    requesting unsafe tracing in production must still fail fast. Once tracing
    is allowed, however, serialization and stderr failures are diagnostic-only
    and must never propagate into scanner/orchestration/queue execution.
    """
    if not unsafe_dev_trace_enabled():
        return

    try:
        if unsafe_dev_unfiltered_enabled():
            safe_fields: dict[str, Any] = {}
            for key, value in fields.items():
                safe_value = _json_safe(value)
                if safe_value is not _OMIT_TRACE_FIELD:
                    safe_fields[key] = safe_value

            record = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "UNSAFE_DEV_TRACE",
                "event": event,
                "correlationId": get_correlationId(),
                **safe_fields,
            }
        else:
            summarized_event = event
            if summarized_event.endswith("_RAW"):
                summarized_event = summarized_event[:-4]
                
            summarized_fields = _summarize_trace_fields(event, fields)
            record = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "UNSAFE_DEV_TRACE",
                "event": summarized_event,
                "correlationId": get_correlationId(),
                **summarized_fields,
            }

        rendered = json.dumps(
            record,
            ensure_ascii=False,
            separators=(",", ":"),
            default=repr,
        )
        print(rendered, file=sys.stderr, flush=True)
    except Exception:
        # Observability is never allowed to change domain/runtime behavior.
        # In particular, stderr may be a non-blocking pipe (for example when
        # running ``pnpm dev:trace 2>&1 | tee ...``) and can raise EAGAIN.
        return


def _json_safe(value: Any, seen: set[int] | None = None) -> Any:
    """Convert arbitrary runtime objects into bounded JSON-compatible data."""
    if seen is None:
        seen = set()

    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _string_trace_value(value)
    if isinstance(value, bytes):
        return _bytes_trace_value(value)
    if isinstance(value, bytearray):
        return _bytes_trace_value(bytes(value))

    obj_id = id(value)
    if obj_id in seen:
        return "<cycle>"

    if hasattr(value, "model_dump") and callable(value.model_dump):
        try:
            return _json_safe(value.model_dump(), seen)
        except Exception:
            pass
    if is_dataclass(value) and not isinstance(value, type):
        try:
            return _json_safe(asdict(value), seen)
        except Exception:
            pass
    if isinstance(value, Mapping):
        return _mapping_trace_value(value, seen)
    if isinstance(value, tuple):
        return _sequence_trace_value(value, "tuple", seen)
    if isinstance(value, list):
        return _sequence_trace_value(value, "list", seen)
    if isinstance(value, Sequence) and not isinstance(value, str):
        return _sequence_trace_value(value, type(value).__name__, seen)

    if hasattr(value, "__dict__"):
        seen.add(obj_id)
        try:
            attributes = list(vars(value).items())
            payload: dict[str, Any] = {"__type__": type(value).__name__}
            selected = (
                attributes
                if len(attributes) <= _MAX_TRACE_COLLECTION_ITEMS
                else attributes[:_MAX_TRACE_COLLECTION_ITEMS]
            )
            safe_attributes: dict[str, Any] = {}
            for key, entry in selected:
                safe_entry = _json_safe(entry, seen)
                if safe_entry is not _OMIT_TRACE_FIELD:
                    safe_attributes[str(key)] = safe_entry

            if len(attributes) <= _MAX_TRACE_COLLECTION_ITEMS:
                payload.update(safe_attributes)
                return payload

            payload.update(
                {
                    "encoding": "object-metadata",
                    "attributeCount": len(attributes),
                    "attributes": safe_attributes,
                    "truncated": True,
                }
            )
            return payload
        except Exception:
            pass
        finally:
            seen.discard(obj_id)

    return _string_trace_value(repr(value))


def _mapping_trace_value(value: Mapping[Any, Any], seen: set[int]) -> Any:
    """Render mappings while dropping binary-valued fields completely."""
    obj_id = id(value)
    seen.add(obj_id)
    try:
        entries = list(value.items())
        selected = (
            entries
            if len(entries) <= _MAX_TRACE_COLLECTION_ITEMS
            else entries[:_MAX_TRACE_COLLECTION_ITEMS]
        )
        safe_items: dict[str, Any] = {}
        for key, entry in selected:
            safe_entry = _json_safe(entry, seen)
            if safe_entry is not _OMIT_TRACE_FIELD:
                safe_items[str(key)] = safe_entry

        if len(entries) <= _MAX_TRACE_COLLECTION_ITEMS:
            return safe_items
        return {
            "encoding": "collection-metadata",
            "collectionType": "mapping",
            "itemCount": len(entries),
            "items": safe_items,
            "truncated": True,
        }
    finally:
        seen.remove(obj_id)


def _sequence_trace_value(
    value: Sequence[Any],
    collection_type: str,
    seen: set[int],
) -> Any:
    """Keep small sequences verbatim and summarize large result collections."""
    obj_id = id(value)
    seen.add(obj_id)
    try:
        selected = (
            value
            if len(value) <= _MAX_TRACE_COLLECTION_ITEMS
            else value[:_MAX_TRACE_COLLECTION_ITEMS]
        )
        safe_items = []
        for entry in selected:
            safe_entry = _json_safe(entry, seen)
            if safe_entry is not _OMIT_TRACE_FIELD:
                safe_items.append(safe_entry)

        if len(value) <= _MAX_TRACE_COLLECTION_ITEMS:
            return safe_items
        return {
            "encoding": "collection-metadata",
            "collectionType": collection_type,
            "itemCount": len(value),
            "items": safe_items,
            "truncated": True,
        }
    finally:
        seen.remove(obj_id)


def _string_trace_value(value: str) -> Any:
    """Keep normal text raw but summarize unusually large strings."""
    if len(value) <= _MAX_INLINE_TRACE_STRING_CHARS:
        return value
    encoded = value.encode("utf-8", errors="replace")
    return {
        "encoding": "text-metadata",
        "charLength": len(value),
        "byteLength": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "preview": value[:_TRACE_STRING_PREVIEW_CHARS],
        "truncated": True,
    }


def _bytes_trace_value(value: bytes) -> Any:
    """Keep only small UTF-8 text bytes; omit binary or oversized bytes entirely."""
    if len(value) <= _MAX_INLINE_UTF8_BYTES:
        try:
            return _string_trace_value(value.decode("utf-8"))
        except UnicodeDecodeError:
            return _OMIT_TRACE_FIELD

    return _OMIT_TRACE_FIELD
