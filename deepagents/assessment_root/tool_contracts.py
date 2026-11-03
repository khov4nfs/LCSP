"""Governed tool usage guidance; legal sources and API schemas remain authoritative."""
from __future__ import annotations

from orchestration.context import resolve_response_language

CONTRACTS: dict[str, str] = {
    "get_assessment_context": "Use at start/resume and after case changes. API owns selected scope, pinned source, accepted facts, coverage and blockers; coverage is not legal proof.",
    "get_pinned_rule_set": "Paginate the authorized request's rules only; SELECTED_RULES does not authorize the unselected catalog.",
    "get_assessment_rule": "Read one selected rule's legal requirements, criteria, elements and source addresses before investigating it.",
    "get_rule_decision": "Inspect accepted prior reasoning and references; structural acceptance is not semantic correctness.",
    "read_legal_source": "Read the pinned operative text and legal effect before interpreting obligations; skill guidance has no legal authority.",
    "search_legal_source": "Find pinned definitions and exceptions; search hits are leads, not legal conclusions.",
    "start_rule_investigation": "Start only pending/invalidated selected rule work; reuse still-current decisions.",
    "cite_repository_source": "Mint verified evidence only for exact pinned lines read; code cannot prove operator identity or real-world operations.",
    "record_search_coverage": "Authenticate bounded searches; missing hits and truncated results cannot prove global absence.",
    "accept_case_fact": "Record narrowly supported source claims, not assumed customer practices or deployment facts.",
    "submit_rule_decision": "Submit only supported current applicability and every criterion; unresolved material facts require investigation/HITL.",
    "open_human_request": "Ask fact not legal verdict; material selected-rule anchor, attempts and impact required; native interrupt.",
    "report_human_fact_unresolvable": "Require affirmative accepted evidence of permanent unavailability, not merely an unanswered question.",
    "request_finalization": "Only when selected decisions are current; API gate controls lifecycle, selected audit is not a full final report.",
    "submit_final_report": "FULL_RULE_SET only after FINALIZING; use frozen accepted decisions, no invented facts or artifacts.",
    "list_assessment_skills": "After reconnaissance, discover generic optional investigation methods; this does not establish capabilities.",
    "load_assessment_skill": "Load one allowlisted relevant method; cannot create legal duties, expand scope or accept evidence.",
}
GRAPH_CONTRACTS: dict[str, str] = {
    "search_code_graph": "Use as a symbol/path lead only; graph coverage may be incomplete, verify pinned source.",
    "trace_call_path": "Discover possible paths and verify actual reachability and effects in pinned source.",
    "search_code_text": "Narrow search and inspect actual source; no-hit or truncation is not proof of absence.",
    "get_repository_architecture": "Find candidate modules and entrypoints, not runtime deployment or legal status.",
}


CONTRACTS_VI: dict[str, str] = {
    "get_assessment_context": "Dùng lúc bắt đầu/resume và sau thay đổi case. API nắm scope được chọn, pin, fact/evidence và blocker; coverage không chứng minh kết luận pháp lý.",
    "get_pinned_rule_set": "Duyệt đủ các rule của request được phép, kể cả khi SELECTED_RULES chỉ là một phần catalog; không audit rule chưa chọn.",
    "get_assessment_rule": "Đọc đúng một rule được chọn, legal requirement, criterion, phần tử applicability và nguồn pháp luật trước khi phân tích.",
    "get_rule_decision": "Xem decision trước đây và reference; API chấp nhận cấu trúc không chứng minh nội dung suy luận đúng.",
    "read_legal_source": "Đọc provision đã pin và tình trạng hiệu lực; nghĩa vụ đến từ luật, không từ skill hay kiến thức mô hình.",
    "search_legal_source": "Tìm định nghĩa và ngoại lệ từ nguồn đã pin; kết quả search chỉ là đầu mối, không phải kết luận pháp luật.",
    "start_rule_investigation": "Chỉ khởi động rule PENDING/INVALIDATED trong scope được chọn; tận dụng decision còn hợp lệ.",
    "cite_repository_source": "Cấp evidence cho đúng dòng source đã đọc; code không tự xác minh pháp nhân hay hoạt động bên ngoài repository.",
    "record_search_coverage": "Ghi tìm kiếm có giới hạn; zero hit hoặc truncated không chứng minh không tồn tại toàn bộ.",
    "accept_case_fact": "Chỉ ghi fact hẹp có nguồn hỗ trợ, không suy ra thực tế vận hành hay chính sách khách hàng.",
    "submit_rule_decision": "Chỉ nộp khi applicability và toàn bộ criterion trọng yếu có căn cứ; fact còn thiếu phải điều tra/HITL.",
    "open_human_request": "Hỏi fact, không hỏi verdict; phải gắn criterion hoặc condition của rule, các lần xác minh và tác động; native interrupt.",
    "report_human_fact_unresolvable": "Chỉ dùng khi evidence được chấp nhận chứng minh fact vĩnh viễn không thể thu thập, không phải chỉ vì chưa trả lời.",
    "request_finalization": "Chỉ gọi khi selected decisions hiện hành đầy đủ; API điều khiển lifecycle; selected audit không tự tạo full report.",
    "submit_final_report": "Chỉ FULL_RULE_SET ở trạng thái FINALIZING; dùng kết quả đã được chấp nhận, không tạo fact hoặc artifact giả.",
    "list_assessment_skills": "Sau khảo sát, xem những phương pháp điều tra tùy chọn; tên skill không chứng minh chức năng tồn tại.",
    "load_assessment_skill": "Nạp một skill được phép khi phù hợp source và rule; skill không tạo nghĩa vụ, mở rộng scope hay chấp nhận evidence.",
}
GRAPH_CONTRACTS_VI: dict[str, str] = {
    "search_code_graph": "Tìm symbol/caller tiềm năng; graph có thể thiếu, cần kiểm bằng source đã pin.",
    "trace_call_path": "Khám phá đường gọi có thể có; xác minh thực sự reachable và có hiệu quả trong source.",
    "search_code_text": "Tìm kiếm có giới hạn rồi đọc source thật; không có hit hoặc truncated không chứng minh vắng mặt.",
    "get_repository_architecture": "Xác định module/entrypoint để khảo sát, không xác nhận deployment hoặc tình trạng pháp lý.",
}


def describe_tool(name: str, original: str, locale: str = "en") -> str:
    """Business purpose:
    Append bounded authority guidance to a known Assessment or source-search tool.

    Business rules:
    - Preserve the original tool schema, name, permissions and server authority.

    Execution flow:
    1. Look up static guidance and combine it with the original description.

    Failure cases:
    - Unregistered tools retain their original descriptions without new assumptions.

    Side effects:
    - Pure description construction; no tool invocation or domain mutation.
    """
    normalized = resolve_response_language(locale)
    if normalized == "vi":
        guidance = CONTRACTS_VI.get(name) or GRAPH_CONTRACTS_VI.get(name)
    else:
        guidance = CONTRACTS.get(name) or GRAPH_CONTRACTS.get(name)
    return original.strip() + ("\n\nASSESSMENT TOOL CONTRACT: " + guidance if guidance else "")
