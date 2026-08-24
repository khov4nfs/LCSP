import os
import json
import pytest
from unittest.mock import MagicMock, patch

from tools.reports.reporting.audit_export_generator import AuditExportGenerator
from tools.common.platform.callback_schemas import AuditExportCallbackPayload

@pytest.fixture
def mock_api_client():
    client = MagicMock()
    return client

@pytest.fixture
def mock_s3_client():
    client = MagicMock()
    return client

@pytest.fixture
def generator(mock_api_client, mock_s3_client):
    return AuditExportGenerator(
        api_client=mock_api_client,
        s3_client=mock_s3_client,
        bucket_name="test-bucket"
    )

def test_t01_valid_date_range_export_generated(generator, mock_api_client, mock_s3_client):
    """T01: Valid date range -> Export generated and uploaded"""
    mock_events = [
        {"id": "event_1", "action": "login"},
        {"id": "event_2", "action": "logout"}
    ]
    mock_api_client.get_audit_events.return_value = mock_events

    with patch("builtins.open", new_callable=MagicMock) as mock_open:
        # Mock file handle
        file_handle = MagicMock()
        mock_open.return_value.__enter__.return_value = file_handle

        with patch("os.remove") as mock_remove:
            export_url = generator.generate_export("req_123", "org_1", "2023-01-01", "2023-01-31")

    # API was called
    mock_api_client.get_audit_events.assert_called_once_with(
        organization_id="org_1",
        from_date="2023-01-01",
        to_date="2023-01-31"
    )

    # S3 was called
    mock_s3_client.upload_file.assert_called_once()
    assert mock_s3_client.upload_file.call_args[0][1] == "test-bucket"
    assert mock_s3_client.upload_file.call_args[0][2] == "exports/org_1/audit_export_req_123.jsonl"
    assert export_url == "s3://test-bucket/exports/org_1/audit_export_req_123.jsonl"

def test_t02_all_event_payloads_redacted(generator, mock_api_client, mock_s3_client):
    """T02: All event payloads redacted -> Sensitive fields removed"""
    mock_events = [
        {"id": "event_1", "payload": {"token": "ghp_123456789012345678901234567890123456"}},
    ]
    mock_api_client.get_audit_events.return_value = mock_events

    with patch("builtins.open", new_callable=MagicMock) as mock_open:
        file_handle = MagicMock()
        mock_open.return_value.__enter__.return_value = file_handle

        with patch("os.remove"):
            generator.generate_export("req_123", "org_1", "2023-01-01", "2023-01-31")

    # Verify write was called with stripped secret values
    write_call_args = file_handle.write.call_args_list
    assert len(write_call_args) == 1
    written_data = json.loads(write_call_args[0][0][0])
    
    assert written_data["payload"]["token"] == ""

def test_t03_json_lines_format(generator, mock_api_client, mock_s3_client):
    """T03: JSON Lines format -> One event per line, valid JSON"""
    mock_events = [
        {"id": "event_1", "payload": {"data": "test1"}},
        {"id": "event_2", "payload": {"data": "test2"}},
    ]
    mock_api_client.get_audit_events.return_value = mock_events

    with patch("builtins.open", new_callable=MagicMock) as mock_open:
        file_handle = MagicMock()
        mock_open.return_value.__enter__.return_value = file_handle

        with patch("os.remove"):
            generator.generate_export("req_123", "org_1", "2023-01-01", "2023-01-31")

    write_call_args = file_handle.write.call_args_list
    assert len(write_call_args) == 2
    
    # Must end with newline
    assert write_call_args[0][0][0].endswith("\n")
    assert write_call_args[1][0][0].endswith("\n")

def test_t04_upload_fails_consumer_behavior():
    """T04: Upload fails -> status = FAILED, logged"""
    from tools.reports.reporting.audit_export_boundary import AuditExportBoundary
    
    with patch("tools.reports.reporting.audit_export_boundary.boto3.client") as mock_boto:
        with patch.dict(os.environ, {
            "AWS_S3_BUCKET_NAME": "test-bucket", 
            "NESTJS_API_BASE_URL": "http://localhost", 
            "WORKER_API_KEY": "test",
        }):
            boundary = AuditExportBoundary()
            
            # Setup mock generator to raise exception
            boundary.generator = MagicMock()
            boundary.generator.generate_export.side_effect = Exception("S3 Upload Failed")
            
            # Setup mock api_client
            boundary.api_client = MagicMock()
            
            message = {
                "exportRequestId": "req_123",
                "organizationId": "org_1",
                "fromDate": "2023-01-01",
                "toDate": "2023-01-31"
            }
            
            boundary.handle(message, "corr_123")
            
            # Should call callback with FAILED
            boundary.api_client.post_audit_export_callback.assert_called_once()
            called_payload = boundary.api_client.post_audit_export_callback.call_args[0][1]
            assert called_payload.status == "FAILED"
            assert "S3 Upload Failed" in called_payload.error_message
