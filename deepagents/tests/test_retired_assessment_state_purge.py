"""The release-only eraser rejects ambiguous ownership before destructive work."""

import hashlib
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest

spec = importlib.util.spec_from_file_location(
    "release_purge_v1", Path(__file__).resolve().parents[2] / "scripts/purge-retired-assessment-state.py"
)
purge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(purge)


def test_only_archived_thread_and_its_nested_namespaces_are_targets():
    assert purge.classify_threads({"old", "old:run:hash", "root"}, {"old"}, {"root"}) == {
        "old", "old:run:hash"
    }


@pytest.mark.parametrize("canonical", [{"old"}, {"old:run:hash"}, {"old-parent"}])
def test_overlap_or_unclassified_identity_blocks_all_erasure(canonical):
    with pytest.raises(ValueError):
        purge.classify_threads({"old", "old:run:hash", "unclassified"}, {"old"}, canonical)


@pytest.mark.parametrize("relative", ["../other", "/other", "nested/../../other"])
def test_traversal_is_refused(tmp_path, relative):
    with pytest.raises(ValueError):
        purge.safe_path(tmp_path, relative)


def test_symlink_is_refused_even_if_it_points_inside_the_root(tmp_path):
    (tmp_path / "safe").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "safe")
    with pytest.raises(ValueError):
        purge.safe_path(tmp_path, "link/file")


def test_file_hash_size_and_restart_absence(tmp_path):
    path = tmp_path / "historical"
    path.write_bytes(b"synthetic V1 bytes")
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    purge.verify_file(path, sha, path.stat().st_size)
    with pytest.raises(ValueError):
        purge.verify_file(path, "0" * 64, path.stat().st_size)
    with pytest.raises(ValueError):
        purge.verify_file(path, sha, 1)
    path.unlink()
    purge.verify_file(path, sha, 18)


def container(thread):
    identity = hashlib.sha256(thread.encode()).hexdigest()
    return {"Id": thread, "Name": "/lcsp-repository-sandbox-" + identity[:24], "Mounts": [],
            "Config": {"Labels": {"lcsp.repository-sandbox": "true", "lcsp.thread-id": identity}}}


def test_container_name_and_labels_are_required_and_root_is_protected():
    assert purge.sandbox_targets([container("old"), container("root")], {"old"}, {"root"}) == ["old"]
    broken = container("old")
    broken["Name"] = "/unrelated"
    with pytest.raises(ValueError):
        purge.sandbox_targets([broken], {"old"}, {"root"})


def test_unknown_container_or_persistent_mount_blocks_erasure():
    with pytest.raises(ValueError):
        purge.sandbox_targets([container("unknown")], {"old"}, {"root"})
    mounted = container("old")
    mounted["Mounts"] = [{"Type": "volume", "Name": "mixed"}]
    with pytest.raises(ValueError):
        purge.sandbox_targets([mounted], {"old"}, {"root"})


def test_default_sandbox_discovery_stays_fail_closed_and_fixture_scope_requires_matching_identity():
    identity = str(uuid4())
    run = {"id": identity, "toolVersion": "SYNTHETIC_POST_CUTOVER_FIXTURE", "phaseResults": {"fixtureOnly": True}}
    assert purge.sandbox_filters(None, "release", "release_checkpoints", None) == (
        "--filter", "label=lcsp.repository-sandbox=true")
    assert purge.sandbox_filters(identity, "retirement_upgrade", "retirement_checkpoints", run)[-1] == (
        "label=lcsp.release-fixture-run=" + identity)
    for invalid in (
        None, {**run, "id": str(uuid4())}, {**run, "toolVersion": "cutover-production"},
        {**run, "phaseResults": {}}, {**run, "phaseResults": {"fixtureOnly": "true"}},
    ):
        with pytest.raises(ValueError):
            purge.sandbox_filters(identity, "retirement_upgrade", "retirement_checkpoints", invalid)
    for database, checkpoints in (("release", "retirement_checkpoints"), ("retirement_upgrade", "release_checkpoints")):
        with pytest.raises(ValueError):
            purge.sandbox_filters(identity, database, checkpoints, run)


def test_database_url_removes_only_prisma_schema_parameter():
    assert purge.connection_url("postgresql://user:secret@host/db?schema=public&sslmode=require") == (
        "postgresql://user:secret@host/db?sslmode=require"
    )
    with pytest.raises(ValueError):
        purge.connection_url("sqlite:///db")


def test_canonical_manifest_protects_actual_content_addressed_bytes(tmp_path):
    sha = "a" * 64
    manifest = {"artifact_id": str(uuid4()), "total_size": 5, "hash": sha, "chunks": [sha + ".chunk"]}
    assert purge.canonical_artifact_paths(tmp_path, [json.dumps(manifest)]) == {tmp_path / "chunks" / (sha + ".chunk")}
    with pytest.raises(ValueError):
        purge.canonical_artifact_paths(tmp_path, [json.dumps({**manifest, "chunks": ["../other"]})])


def test_mixed_transport_history_is_separated_without_deleting_canonical_root_data():
    old = {"checkpoint_id": "old", "checkpoint": {"ts": "2026-10-07T00:00:00+00:00"}, "metadata": {}}
    canonical = {"checkpoint_id": "current", "checkpoint": {"ts": "2026-10-09T00:00:00+00:00"},
                 "metadata": {"lcsp_boundary_name": "assessment_root_requested", "assessment_id": "owned"}}
    boundary = datetime(2026, 10, 8, tzinfo=UTC)
    assert purge.mixed_checkpoint_targets([old, canonical], boundary, "owned") == [old]
    with pytest.raises(ValueError):
        purge.mixed_checkpoint_targets([{**canonical, "metadata": {}}], boundary, "owned")
    with pytest.raises(ValueError):
        purge.mixed_checkpoint_targets([canonical], boundary, "another")


def test_drop_requires_receipt_bound_to_current_archive_and_all_external_absence():
    migration = (Path(__file__).resolve().parents[2] / "apps/api/prisma/migrations/"
                 "20261008160000_w7_drop_v1_authority/migration.sql").read_text()
    assert "W7_V1_PURGE" in migration
    assert '"checkpoints":0,"sandboxes":0,"files":0,"workspaces":0' in migration
    assert "identity-bound external V1 purge proof" in migration
    assert 'count(*)::text FROM "LegacyArchiveRecord"' in migration
    assert "CASCADE;" not in migration


def test_mixed_private_logs_remove_only_v1_records_and_their_continuations():
    before = datetime(2026, 10, 8, tzinfo=UTC)
    old = b"[2026-10-07T00:00:00.000Z] V1 customer content\nstack continuation\n"
    current = b'{"timestamp":"2026-10-09T00:00:00+00:00","event":"canonical V2"}\n'
    assert purge.retained_log_bytes(old + current, before) == current
    assert purge.retained_log_bytes(current, before) == current
    assert purge.retained_log_bytes(old, before) == b""
    with pytest.raises(ValueError):
        purge.retained_log_bytes(b"unclassified customer content\n", before)


def test_drop_references_only_existing_archive_source_values():
    import re, subprocess
    root = Path(__file__).resolve().parents[2]
    schema = subprocess.check_output(["git", "show", "HEAD:apps/api/prisma/schema.prisma"], cwd=root, text=True)
    members = set(re.search(r"enum LegacyArchiveSource \{(.*?)\}", schema, re.S).group(1).split())
    migration = (root / "apps/api/prisma/migrations/20261008160000_w7_drop_v1_authority/migration.sql").read_text()
    referenced = set(re.findall(r'"sourceTable"\s*=\s*\x27([^\x27]+)\x27', migration))
    assert referenced <= members


def test_drop_keeps_all_destructive_statements_in_one_transaction():
    migration = (Path(__file__).resolve().parents[2] / "apps/api/prisma/migrations/"
                 "20261008160000_w7_drop_v1_authority/migration.sql").read_text()
    assert migration.count("BEGIN;") == 1
    assert migration.count("COMMIT;") == 1
    assert migration.rstrip().endswith("COMMIT;")


def test_drop_constraint_targets_are_created_by_historical_migrations():
    import re
    root = Path(__file__).resolve().parents[2] / "apps/api/prisma/migrations"
    drop = root / "20261008160000_w7_drop_v1_authority/migration.sql"
    history = "\n".join(path.read_text() for path in sorted(root.glob("*/migration.sql"))
                        if path.parent.name < drop.parent.name)
    created = set(re.findall(r'CONSTRAINT "([^"]+)"', history))
    removed = set(re.findall(r'DROP CONSTRAINT "([^"]+)"', drop.read_text()))
    assert removed <= created, "RELEASE must target the migrated schema, not unapplied Prisma relations"


def test_fixture_failure_diagnostics_exclude_sql_payloads():
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("release_migration_check", root / "tests/retired-authority-migration-check.py")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    output = ("2026-10-09 00:00:00.000 UTC [1] ERROR: constraint does not exist\n"
              "2026-10-09 00:00:00.000 UTC [1] DETAIL: dependency metadata\n"
              "2026-10-09 00:00:00.000 UTC [1] HINT: inspect the migration\n"
              "2026-10-09 00:00:00.000 UTC [1] STATEMENT: INSERT INTO customer VALUES ('private ERROR: content');\n"
              "    continued private SQL payload\n")
    assert runner.postgres_errors(output) == (
        "2026-10-09 00:00:00.000 UTC [1] ERROR: constraint does not exist\n"
        "2026-10-09 00:00:00.000 UTC [1] DETAIL: dependency metadata\n"
        "2026-10-09 00:00:00.000 UTC [1] HINT: inspect the migration")
