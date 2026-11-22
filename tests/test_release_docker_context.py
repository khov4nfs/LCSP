"""Verify the release Docker context with Docker's actual ignore rules."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ReleaseDockerContextTest(unittest.TestCase):
    def test_excludes_agent_instructions_at_all_depths(self):
        # A scratch build exercises COPY and the shared ignore rules without
        # pulling a base image or installing the release image dependencies.
        with tempfile.TemporaryDirectory(prefix="lcsp-docker-context-") as temporary:
            work = Path(temporary)
            context = work / "context"
            nested = context / "apps" / "web"
            nested.mkdir(parents=True)
            shutil.copyfile(ROOT / ".dockerignore", context / ".dockerignore")
            (context / "Dockerfile").write_text("FROM scratch\nCOPY . /app\n", encoding="utf-8")
            (context / "CLAUDE.md").touch()
            (nested / "CLAUDE.md").touch()
            (nested / "package.json").write_text("{}", encoding="utf-8")

            # Keep the export outside the context so it cannot influence COPY.
            output = work / "rootfs"
            subprocess.run(
                ["docker", "buildx", "build", "--output", f"type=local,dest={output}", str(context)],
                check=True,
            )

            self.assertTrue((output / "app/apps/web/package.json").is_file())
            self.assertEqual(list((output / "app").rglob("CLAUDE.md")), [])


if __name__ == "__main__":
    unittest.main()
