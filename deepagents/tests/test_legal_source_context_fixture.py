from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "legal_portfolio_context"
PARSER_PATH = (
    Path(__file__).parents[1]
    / "tools"
    / "legal"
    / "sources"
    / "scripts"
    / "build_reviewed_legal_corpus.py"
)


def load_parser():
    spec = importlib.util.spec_from_file_location("legal_source_parser", PARSER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load legal source parser: {PARSER_PATH}")
    parser = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parser)
    return parser


class LegalSourceContextFixtureTest(unittest.TestCase):
    def test_pinned_sources_preserve_bytes_hashes_locators_and_context(self) -> None:
        parser = load_parser()
        pins = json.loads((FIXTURE_DIR / "pins.json").read_text(encoding="utf-8"))
        parsed_by_version: dict[str, dict[str, dict[str, object]]] = {}

        for source in pins["sources"]:
            source_path = FIXTURE_DIR / source["sourceFile"]
            source_text = source_path.read_text(encoding="utf-8")
            self.assertEqual(len(source_path.read_bytes()), source["byteLength"])
            self.assertEqual(parser.file_sha256(source_path), source["sourceSha256"])
            self.assertEqual(
                parser.normalize_source_effect_status(
                    source["documentId"], source["sourceEffectStatus"]
                ),
                next(
                    item["normalized"]
                    for item in pins["effectStatusCases"]
                    if item["sourceText"] == source["sourceEffectStatus"]
                ),
            )

            chunks = parser.parse_chunks(source["documentId"], source_text)
            locators = [chunk["locator"] for chunk in chunks]
            self.assertEqual(locators, list(source["chunkSha256"]))
            self.assertEqual(set(locators), set(pins["chunkLineRanges"]))

            by_locator = {chunk["locator"]: chunk for chunk in chunks}
            for locator, chunk in by_locator.items():
                self.assertEqual(chunk["id"], f'{source["documentId"]}::{locator}')
                self.assertEqual(chunk["contentSha256"], source["chunkSha256"][locator])
                self.assertEqual(chunk["contentSha256"], parser.sha256(chunk["content"]))

            self.assertEqual(
                by_locator["art-5::cl-1"]["hierarchy"]["parentChunkId"],
                f'{source["documentId"]}::art-5',
            )
            self.assertEqual(
                by_locator["art-5::cl-1::pt-a"]["hierarchy"]["parentChunkId"],
                f'{source["documentId"]}::art-5::cl-1',
            )
            self.assertEqual(
                by_locator["art-4::cl-1::pt-a"]["hierarchy"]["parentChunkId"],
                f'{source["documentId"]}::art-4::cl-1',
            )

            days = "7" if source["sourceFile"].endswith("v1.txt") else "14"
            expected_context = {
                "art-1::cl-1": ("record", "receipt timestamp"),
                "art-2::cl-1": ("applies only to operators", "Private household use"),
                "art-3::cl-1": ("does not apply to a temporary test record", "Article 6"),
                "art-4::cl-1": ("read “record” as defined in Article 1", "Article 2"),
                "art-4::cl-1::pt-a": ("receipt timestamp begins the retention period",),
                "art-5::cl-1": (f"retain each record for {days} days", "subject to Article 3"),
                "art-5::cl-1::pt-a": ("Keep the notice text with its receipt timestamp",),
                "art-5::cl-1::pt-b": ("without removing its limiting language",),
                "art-6::cl-1": ("appoint a person to attend", "in person"),
            }
            for locator, snippets in expected_context.items():
                for snippet in snippets:
                    self.assertIn(snippet, by_locator[locator]["content"])

            parsed_by_version[source["corpusVersion"]] = by_locator

        version_one = parsed_by_version["SYNTHETIC-CORPUS-V1"]
        version_two = parsed_by_version["SYNTHETIC-CORPUS-V2"]
        self.assertNotEqual(
            pins["sources"][0]["sourceSha256"], pins["sources"][1]["sourceSha256"]
        )
        self.assertEqual(
            pins["hashVariant"]["declaredSha256"], pins["sources"][0]["sourceSha256"]
        )
        self.assertNotEqual(
            pins["hashVariant"]["declaredSha256"], pins["sources"][1]["sourceSha256"]
        )
        changed_locators = {
            locator
            for locator in version_one
            if version_one[locator]["contentSha256"]
            != version_two[locator]["contentSha256"]
        }
        self.assertEqual(changed_locators, {"art-5::cl-1"})

        for effect_status in pins["effectStatusCases"]:
            self.assertEqual(
                parser.normalize_source_effect_status(
                    "synthetic-status", effect_status["sourceText"]
                ),
                effect_status["normalized"],
            )
        with self.assertRaises(RuntimeError):
            parser.normalize_source_effect_status(
                "synthetic-status", pins["unsupportedEffectStatus"]
            )


if __name__ == "__main__":
    unittest.main()
