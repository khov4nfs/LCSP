#!/usr/bin/env python3
import shutil, subprocess, sys, tempfile
from pathlib import Path

src=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as td:
    dst=Path(td)/"pack"
    shutil.copytree(src,dst,ignore=shutil.ignore_patterns("__pycache__"))
    target=dst/"vi/deepagents/skills/interview-context/references/question-strategy.md"
    target.unlink()
    p=subprocess.run([sys.executable,"-S",str(dst/"lint_pack.py")],capture_output=True,text=True)
    if p.returncode==0:
        print("PACK MUTATION TEST FAILED: file parity regression survived")
        sys.exit(1)
print("PACK MUTATION TEST OK: bilingual file-parity regression rejected")
