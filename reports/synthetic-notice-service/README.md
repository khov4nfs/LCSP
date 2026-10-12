# Notice Service

This synthetic service stores notices received by an operator and retains them
for the configured statutory retention period.

The service stores:
- notice text;
- receipt timestamp;
- draft timestamp;
- whether the record is a temporary test record.

Temporary test records are excluded from normal retention processing.

Deployment exposure (publicly reachable vs private/internal only) is an
operator/environment decision and is intentionally not stored in this repository.
