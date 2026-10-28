from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("staging_stack_under_test", ROOT / "tests/staging-stack.py")
assert SPEC and SPEC.loader
staging = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(staging)


class StagingStackTests(unittest.TestCase):
    def test_provider_pool_is_forwarded_whole_with_process_environment_precedence(self) -> None:
        credentials = staging.provider_credentials(
            {"APX_API_KEY": "apx-first,apx-second"},
            {"APX_API_KEY": "unused-file-key"},
        )
        self.assertEqual(credentials["APX_API_KEY"], "apx-first,apx-second")

    def test_value_error_writes_safe_operation_and_readiness_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)

            def fail_start(stack, image_ids, provider, image_evidence):
                stack.set_operation(
                    "WAIT_API",
                    resource_kind="service",
                    safe_resource_id=f"{stack.prefix}-api",
                    service="api",
                    readiness_target="/health",
                )
                stack.update_readiness("PROBE_ERROR", 0, ValueError("private database URL and bearer secret"))
                raise ValueError("postgresql://user:password@private.invalid Authorization: Bearer canary-secret")

            with (
                patch.object(staging, "ROOT", temporary_root),
                patch.object(staging, "uuid4", return_value=UUID("01234567-89ab-cdef-0123-456789abcdef")),
                patch.object(staging, "accepted_images", return_value={
                    "api": "sha256:" + "a" * 64,
                    "web": "sha256:" + "b" * 64,
                    "worker": "sha256:" + "c" * 64,
                    "server": "sha256:" + "d" * 64,
                }),
                patch.object(staging, "provider_credentials", return_value={"APX_API_KEY": "private-test-key"}),
                patch.object(staging, "dotenv_values", return_value={}),
                patch.object(staging.Stack, "start", fail_start),
                patch.object(sys, "argv", [
                    "staging-stack.py",
                    "--image-evidence",
                    "reports/release-images/test-receipt",
                ]),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(staging.main(), 1)

            report_path = temporary_root / "reports/staging/0123456789abcdef/report.json"
            report_bytes = report_path.read_bytes()
            report = json.loads(report_bytes)
            self.assertEqual(report["failedStage"], "isolated launch and readiness")
            self.assertEqual(report["operation"], "WAIT_API")
            self.assertEqual(report["resourceKind"], "service")
            self.assertEqual(report["safeResourceId"], "lcsp-release-staging-0123456789abcdef-api")
            self.assertEqual(report["serviceName"], "api")
            self.assertEqual(report["containerName"], "lcsp-release-staging-0123456789abcdef-api")
            self.assertEqual(report["exceptionClass"], "ValueError")
            self.assertEqual(report["boundedSafeErrorCode"], "INVALID_VALUE")
            self.assertEqual(report["safeReason"], staging.SAFE_FAILURE_REASONS["INVALID_VALUE"])
            self.assertEqual(report["readinessTarget"], "/health")
            self.assertEqual(report["lastReadinessState"], "PROBE_ERROR")
            self.assertEqual(report["lastReadinessExceptionClass"], "ValueError")
            self.assertIsInstance(report["elapsedReadinessMs"], int)
            for sensitive in (b"postgresql://", b"password@", b"Authorization", b"canary-secret", b"private database URL"):
                self.assertNotIn(sensitive, report_bytes)

    def test_wait_records_target_state_and_elapsed_time_for_unexpected_probe_error(self) -> None:
        stack = staging.Stack("0123456789abcdef")
        with (
            patch.object(stack, "inspect", return_value={"State": {"Running": True}}),
            patch.object(staging.time, "sleep"),
            self.assertRaisesRegex(ValueError, "private probe detail"),
        ):
            stack.wait(
                "api",
                lambda: (_ for _ in ()).throw(ValueError("private probe detail")),
                target="/health",
                seconds=5,
            )

        report = staging.safe_failure_report(stack, "isolated launch and readiness", ValueError("private probe detail"))
        self.assertEqual(report["operation"], "WAIT_API")
        self.assertEqual(report["boundedSafeErrorCode"], "INVALID_VALUE")
        self.assertEqual(report["readinessTarget"], "/health")
        self.assertEqual(report["lastReadinessState"], "PROBE_ERROR")
        self.assertGreaterEqual(report["elapsedReadinessMs"], 0)
        self.assertNotIn("private probe detail", json.dumps(report))

    def test_docker_failure_persists_exit_code_without_raw_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            stack = staging.Stack("0123456789abcdef")
            stack.private = Path(temporary)
            (stack.private / "commands.log").touch(mode=0o600)
            failed = subprocess.CompletedProcess(
                args=[],
                returncode=17,
                stdout="private output",
                stderr="postgresql://private:secret@host",
            )
            with patch.object(staging.subprocess, "run", return_value=failed):
                with self.assertRaises(RuntimeError):
                    stack.docker("exec", f"{stack.prefix}-api", "healthcheck")

            log = (stack.private / "commands.log").read_text()
            report = staging.safe_failure_report(stack, "isolated launch and readiness", RuntimeError("private detail"))
            self.assertEqual(report["operation"], "EXECUTE_CONTAINER_CHECK")
            self.assertEqual(report["serviceName"], "api")
            self.assertEqual(report["exitCode"], 17)
            self.assertEqual(report["boundedSafeErrorCode"], "COMMAND_FAILED")
            self.assertNotIn("private:secret", json.dumps(report))
            self.assertNotIn("private output", json.dumps(report))
            self.assertIn('"operation": "EXECUTE_CONTAINER_CHECK"', log)
            self.assertIn('"exitCode": 17', log)
            self.assertNotIn("private:secret", log)
            self.assertNotIn("private output", log)

    def test_invalid_host_port_reports_endpoint_resolution(self) -> None:
        stack = staging.Stack("0123456789abcdef")
        with patch.object(
            stack,
            "docker",
            return_value=json.dumps([{"NetworkSettings": {"Ports": {"8080/tcp": [
                {"HostIp": "127.0.0.1", "HostPort": ""}
            ]}}}]),
        ):
            with self.assertRaises(ValueError):
                stack.url("api", 8080)

        report = staging.safe_failure_report(stack, "isolated launch and readiness", ValueError("private"))
        self.assertEqual(report["operation"], "RESOLVE_SERVICE_ENDPOINT")
        self.assertEqual(report["boundedSafeErrorCode"], "INVALID_HOST_PORT")
        self.assertEqual(report["containerName"], "lcsp-release-staging-0123456789abcdef-api")
        self.assertNotIn("private", json.dumps(report))

    def test_api_config_check_runs_inside_read_only_networkless_release_image(self) -> None:
        image_id = "sha256:" + "e" * 64
        completed = subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")
        with patch.object(staging.subprocess, "run", return_value=completed) as run:
            staging.validate_api_image_config(image_id, {"NODE_ENV": "production"})

        args = run.call_args.args[0]
        self.assertEqual(args[:2], ["docker", "run"])
        self.assertIn("-i", args)
        self.assertIn("--network", args)
        self.assertEqual(args[args.index("--network") + 1], "none")
        self.assertIn("--read-only", args)
        self.assertEqual(args[args.index("--workdir") + 1], "/app")
        self.assertEqual(args[args.index("--entrypoint") + 1], "node")
        self.assertIn(image_id, args)
        self.assertIn("./apps/api/dist/src/config/config.js", args[-1])
        self.assertEqual(json.loads(run.call_args.kwargs["input"]), {"NODE_ENV": "production"})

    def test_expected_invocation_boundary_set_is_exactly_fifteen(self) -> None:
        self.assertEqual(staging.queue_names(), staging.EXPECTED_QUEUE_BOUNDARIES)
        self.assertEqual(len(staging.queue_names()), 15)

    def test_image_evidence_path_rejects_absolute_and_parent_paths(self) -> None:
        with self.assertRaises(RuntimeError):
            staging.image_evidence_path("/tmp/receipt")
        with self.assertRaises(RuntimeError):
            staging.image_evidence_path("../receipt")

    def test_image_evidence_path_accepts_only_validated_internal_absolute_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(staging, "ROOT", Path(temporary)):
                resolved = staging.image_evidence_path("reports/release-images/test-receipt")
                self.assertEqual(staging.image_evidence_path(resolved), resolved)
                with self.assertRaises(RuntimeError):
                    staging.image_evidence_path(str(resolved))


if __name__ == "__main__":
    unittest.main()
