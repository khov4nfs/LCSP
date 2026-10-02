from orchestration.context import (
    LCSPRunContext,
    RepositoryRelationContext,
    coerce_run_context,
)


def test_relation_context_is_immutable_and_keeps_snapshot_provenance() -> None:
    relation = RepositoryRelationContext(
        from_snapshot_id="snapshot-a",
        to_snapshot_id="snapshot-b",
        relation_type="RUNTIME_API_INTERACTION",
    )
    context = coerce_run_context({
        "assessment_id": "assessment-1",
        "snapshot_id": "snapshot-a",
        "repository_relations": (relation,),
    })

    assert isinstance(context, LCSPRunContext)
    assert context.repository_relations == (relation,)
    assert context.repository_relations[0].from_snapshot_id == "snapshot-a"
    assert context.repository_relations[0].to_snapshot_id == "snapshot-b"


def test_scan_event_decodes_only_directed_confirmed_relations() -> None:
    context = coerce_run_context(
        {
            "system_event": {
                "repositoryRelations": [
                    {
                        "fromSnapshotId": "snapshot-a",
                        "toSnapshotId": "snapshot-b",
                        "relationType": "RUNTIME_API_INTERACTION",
                    },
                    {
                        "fromSnapshotId": "snapshot-a",
                        "toSnapshotId": "snapshot-a",
                        "relationType": "SHARED_LIBRARY",
                    },
                ]
            }
        }
    )

    assert context is not None
    assert context.repository_relations == (
        RepositoryRelationContext(
            from_snapshot_id="snapshot-a",
            to_snapshot_id="snapshot-b",
            relation_type="RUNTIME_API_INTERACTION",
        ),
    )
