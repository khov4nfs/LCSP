"""Consume audit-export requests and report READY/FAILED generation outcomes."""

import os
import boto3
from structlog import get_logger

from tools.common.capabilities.managed.boundary import AgentBoundaryBase
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.common.capabilities.platform.config import load_config
from tools.common.capabilities.platform.callback_schemas import AuditExportCallbackPayload
from tools.common.capabilities.reporting.report.audit_export.audit_export_generator import AuditExportGenerator

logger = get_logger(__name__)

# Load config once for the module or inside init. Let's do it lazily or just at init.


class AuditExportBoundary(AgentBoundaryBase):
    """Orchestrate audit export generation for system-originated invocation payloads."""

    boundary_source = "reporting.audit-export-requested"
    source_event = "audit.export-requested"
    requires_rbac = False

    def __init__(self):
        """Load worker configuration and construct the S3-backed generator.

        Raises:
            ValueError: If the destination S3 bucket is not configured.
        """
        config = load_config()
        super().__init__(config)
        self.api_client = WorkerApiClient(config.nestjs_api_base_url, config.worker_api_key)

        # Configure S3 client from environment
        bucket_name = os.environ.get("AWS_S3_BUCKET_NAME")
        if not bucket_name:
            raise ValueError("AWS_S3_BUCKET_NAME is not set in environment")

        s3_client = boto3.client("s3")
        self.generator = AuditExportGenerator(self.api_client, s3_client, bucket_name)

    def handle(self, message: dict, correlationId: str) -> None:
        """Generate the requested export and callback its terminal status.

        Args:
            message: Audit export request containing request/date range IDs.
            correlationId: End-to-end trace identifier for the delivery.

        Missing request fields are logged and ignored. Generation/upload failures
        are converted to a FAILED callback; callback failure itself is logged so
        the original exception is not hidden by a second reporting error.
        """
        export_request_id = message.get("exportRequestId")
        from_date = message.get("fromDate")
        to_date = message.get("toDate")

        if not all([export_request_id, from_date, to_date]):
            logger.error("Missing required fields in audit.export-requested message", message=message)
            return

        try:
            export_url = self.generator.generate_export(
                export_request_id=export_request_id,
                from_date=from_date,
                to_date=to_date
            )

            payload = AuditExportCallbackPayload(
                status="READY",
                export_url=export_url
            )
            self.api_client.post_audit_export_callback(export_request_id, payload)

        except Exception as e:
            logger.error("Failed to generate or upload audit export", exc_info=e)

            payload = AuditExportCallbackPayload(
                status="FAILED",
                error_message=str(e)
            )
            try:
                self.api_client.post_audit_export_callback(export_request_id, payload)
            except Exception as callback_err:
                logger.error("Failed to send FAILED callback to NestJS", exc_info=callback_err)
