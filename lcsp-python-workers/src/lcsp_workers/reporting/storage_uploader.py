"""Upload generated reporting documents to the configured object-storage boundary."""

import uuid
from lcsp_workers.platform.logging import get_logger

logger = get_logger(__name__)


class StorageUploader:
    """Storage adapter used by reporting consumers.

    The current implementation is a mock placeholder that preserves the object
    storage interface expected by callers without performing a real S3/MinIO write.
    """

    @staticmethod
    def upload_document(document_id: str, content: str) -> str:
        """Upload document content and return its storage URL.

        Args:
            document_id: Stable LCSP document identifier used in the object key.
            content: Generated document body to persist.

        Returns:
            Mock pre-signed/storage URL representing the uploaded document.
        """
        logger.info("UPLOADING_DOCUMENT_TO_STORAGE", document_id=document_id, bytes=len(content))
        # Simulate upload success
        # In a real implementation, this would use boto3 or MinIO client

        mock_url = f"https://mock-storage.local/documents/gap-analysis/{document_id}-{uuid.uuid4().hex[:8]}.md"
        logger.info("UPLOAD_SUCCESSFUL", url=mock_url)
        return mock_url
