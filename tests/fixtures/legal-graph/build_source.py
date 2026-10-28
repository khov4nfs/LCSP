"""Render truthful synthetic pages with the already installed PDF ingestion dependency."""
import json
from pathlib import Path
import textwrap

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

ROOT = Path(__file__).resolve().parent


def build(path: Path) -> None:
    source = json.loads((ROOT / "source.json").read_text())
    writer = PdfWriter()
    writer.add_metadata({"/Title": source["title"], "/Subject": source["provenance"]})
    font = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    }))
    for text in source["pages"]:
        lines = [line for paragraph in text.splitlines() for line in textwrap.wrap(paragraph, 105, break_long_words=False, break_on_hyphens=False)]
        assert len(lines) <= 66, "Fixture page overflow"
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        commands = ["BT /F1 9 Tf 11 TL 42 756 Td"]
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(f"({escaped}) Tj T*")
        commands.append("ET")
        stream = DecodedStreamObject()
        stream.set_data("\n".join(commands).encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(stream)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as output:
        writer.write(output)
    extracted = PdfReader(path)
    assert len(extracted.pages) == len(source["pages"])
    for actual, expected in zip(extracted.pages, source["pages"]):
        assert " ".join(actual.extract_text().split()) == " ".join(expected.split())


if __name__ == "__main__":
    import sys
    build(Path(sys.argv[1]))
