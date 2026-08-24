from __future__ import annotations

from tools.legal.legal.normative_chunk_filter import (
    CHUNK_NORMATIVE_CLASSES,
    is_engineering_rule_source_chunk,
    is_legal_database_chunk,
    legal_chunk_normative_class,
)


def _chunk(content: str, *, title: str = "", locator: str = "art-1") -> dict:
    return {
        "id": f"LAW-134-2025-QH15::{locator}",
        "locator": locator,
        "content": content,
        "hierarchy": {"articleTitle": title},
    }


def test_formal_header_and_preamble_are_not_database_chunks() -> None:
    chunk = _chunk(
        "QUỐC HỘI\n"
        "Luật số: 134/2025/QH15\n"
        "Độc lập - Tự do - Hạnh phúc\n\n"
        "Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;\n"
        "Quốc hội ban hành Luật Trí tuệ nhân tạo.",
        locator="preamble",
    )

    assert legal_chunk_normative_class(chunk) == (
        CHUNK_NORMATIVE_CLASSES["exclude_from_database"]
    )
    assert is_legal_database_chunk(chunk) is False
    assert is_engineering_rule_source_chunk(chunk) is False


def test_scope_definitions_principles_and_state_policy_are_context_only() -> None:
    context_chunks = [
        _chunk(
            "Điều 1. Phạm vi điều chỉnh\n"
            "1. Luật này quy định về nghiên cứu, phát triển, cung cấp, triển khai "
            "và sử dụng hệ thống trí tuệ nhân tạo.",
            title="Phạm vi điều chỉnh",
            locator="art-1",
        ),
        _chunk(
            "Điều 3. Giải thích từ ngữ\n"
            "1. Hệ thống trí tuệ nhân tạo là hệ thống dựa trên máy.",
            title="Giải thích từ ngữ",
            locator="art-3",
        ),
        _chunk(
            "Điều 4. Nguyên tắc cơ bản trong hoạt động trí tuệ nhân tạo\n"
            "2. Bảo đảm duy trì sự kiểm soát và khả năng can thiệp của con người.",
            title="Nguyên tắc cơ bản trong hoạt động trí tuệ nhân tạo",
            locator="art-4",
        ),
        _chunk(
            "Điều 5. Chính sách của Nhà nước đối với hoạt động trí tuệ nhân tạo\n"
            "1. Có chính sách phát triển trí tuệ nhân tạo.",
            title="Chính sách của Nhà nước đối với hoạt động trí tuệ nhân tạo",
            locator="art-5",
        ),
    ]

    for chunk in context_chunks:
        assert legal_chunk_normative_class(chunk) == (
            CHUNK_NORMATIVE_CLASSES["context_only"]
        )
        assert is_legal_database_chunk(chunk) is True
        assert is_engineering_rule_source_chunk(chunk) is False


def test_operational_obligation_chunk_can_source_engineering_rule() -> None:
    chunk = _chunk(
        "1. Nhà cung cấp hệ thống trí tuệ nhân tạo phải thiết lập, duy trì "
        "biện pháp quản lý rủi ro, giám sát, ghi nhận và cho phép con người "
        "can thiệp khi hệ thống tạo ra quyết định ảnh hưởng đến người sử dụng.",
        title="Nghĩa vụ của nhà cung cấp",
        locator="art-14::cl-1",
    )

    assert legal_chunk_normative_class(chunk) == (
        CHUNK_NORMATIVE_CLASSES["engineering_rule_candidate"]
    )
    assert is_legal_database_chunk(chunk) is True
    assert is_engineering_rule_source_chunk(chunk) is True
