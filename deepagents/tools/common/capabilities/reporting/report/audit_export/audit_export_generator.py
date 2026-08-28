"""Generate redacted JSONL audit exports and upload them to object storage."""

import os
import json
import tempfile
from typing import Any
from structlog import get_logger

from tools.common.capabilities.platform.api_client import WorkerApiClient
from middleware.redaction import redact_dict

logger = get_logger(__name__)


class AuditExportGenerator:
    """Fetch, redact, serialize, and upload audit events."""

    def __init__(self, api_client: WorkerApiClient, s3_client: Any, bucket_name: str):
        """Create an audit export generator.

        Args:
            api_client: Internal API client used to fetch audit events.
            s3_client: S3-compatible client exposing ``upload_file``.
            bucket_name: Destination object-storage bucket.
        """
        self.api_client = api_client
        self.s3_client = s3_client
        self.bucket_name = bucket_name

    def generate_export(
        self,
        export_request_id: str,
        from_date: str,
        to_date: str,
    ) -> str:
        """Generate one redacted audit export for a date range.

        Audit payloads are redacted before they are written to the temporary
        JSONL file, and the temporary file is removed in ``finally`` regardless
        of upload success.

        Args:
            export_request_id: Stable request identifier used in the file name.
            from_date: Inclusive export range start expected by the API.
            to_date: Inclusive export range end expected by the API.

        Returns:
            S3 URI of the uploaded JSONL artifact.

        Raises:
            Exception: Propagates storage/API/file failures to the boundary so it
                can publish a FAILED callback.
        """
        logger.info(
            "Generating audit export",
            export_request_id=export_request_id,
            from_date=from_date,
            to_date=to_date
        )

        # 1. Fetch events
        events = self.api_client.get_audit_events(
            from_date=from_date,
            to_date=to_date
        )

        if not isinstance(events, list):
            logger.error("Invalid response from audit events API, expected list", response_type=type(events).__name__)
            events = []

        # 2. Redact & Write to temp JSONL
        temp_file_name = f"audit_export_{export_request_id}.jsonl"
        temp_file_path = os.path.join(tempfile.gettempdir(), temp_file_name)

        try:
            with open(temp_file_path, "w", encoding="utf-8") as f:
                for event in events:
                    # Apply redact_dict to payload if it exists
                    if "payload" in event and isinstance(event["payload"], dict):
                        event["payload"] = redact_dict(event["payload"])
                    else:
                        event = redact_dict(event)

                    f.write(json.dumps(event) + "\n")

            # 3. Upload to S3
            s3_key = f"exports/{export_request_id}/{temp_file_name}"
            self.s3_client.upload_file(temp_file_path, self.bucket_name, s3_key)

            # Return s3 URI. NestJS can generate presigned URLs using this.
            export_url = f"s3://{self.bucket_name}/{s3_key}"

            logger.info("Audit export uploaded successfully", export_url=export_url)
            return export_url

        finally:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
