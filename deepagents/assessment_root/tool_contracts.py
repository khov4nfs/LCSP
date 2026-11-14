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
    "open_human_requests_batch": "Ask multiple facts in one batch; validate rule anchors, attempts and impact; atomic native interrupt.",
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
    "open_human_requests_batch": "Hỏi nhiều fact trong một đợt; kiểm tra anchor, nỗ lực xác minh và tác động; ngắt native nguyên tử.",
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


# Operational use instructions: identical tool identities and safety boundaries across
# locales. These are *usage* playbooks, not new legal norms or tool permissions.
TOOL_PLAYBOOKS_EN = {
    "get_assessment_context": (
        "WHEN: First call and every resume, or after accepted case change. "
        "READ: server pins, selected rules, accepted facts, open human blockers and decision revisions. "
        "NEXT: reload rule before making any evidence claim. "
        "FAILURE: stale/missing context stops decisions; never substitute checkpoint memory."
    ),
    "get_assessment_rule": (
        "WHEN: Before investigating the selected rule. READ: criterion/condition IDs and inherited legal predicates. "
        "NEXT: read pinned operative legal source, then inspect relevant repository evidence. "
        "FAILURE: absent/unselected rule is not authority to invent a criterion."
    ),
    "read_legal_source": (
        "WHEN: source and legal effect must be established. READ: the pinned provision, actor, exception, "
        "transition, commencement and dependencies. NEXT: compare source against criterion. "
        "FAILURE: incomplete/repealed/draft source is not an effective legal duty without verification."
    ),
    "cite_repository_source": (
        "WHEN: bounded exact lines have been read in pinned snapshot. READ: path:start-end and observed behavior. "
        "NEXT: cite returned evidence ID, never fabricated IDs. "
        "FAILURE: README, unused code, search hits or a code index alone do not prove actual execution."
    ),
    "record_search_coverage": (
        "WHEN: documenting negative code searches. READ: inspected entrypoints and direct source fallbacks. "
        "NEXT: retain uncovered paths, truncation and negative controls. "
        "FAILURE: zero hits cannot establish global absence or external organizational behavior."
    ),
    "submit_rule_decision": (
        "WHEN: every material applicability element and criterion has current supported evidence. "
        "READ: API-accepted facts, actual legal predicate, source references and contrary evidence. "
        "NEXT: submit typed applicability/criterion results, preserve references. "
        "FAILURE: unknown material fact requires investigation/HITL, not NOT_APPLICABLE or COMPLIANT."
    ),
    "open_human_request": (
        "WHEN: off-repository fact changes applicability, outcome or needed evidence. "
        "READ: related selected rule, why code could not answer, exact fact, owner and decision impact. "
        "NEXT: invoke native interrupt; resume on same pinned case revision. "
        "FAILURE: do not ask the human to make the legal verdict or repeat an answered question."
    ),
    "open_human_requests_batch": (
        "WHEN: multiple off-repository facts are needed across rules or criteria. "
        "READ: related selected rules, why code could not answer, exact facts, owner and decision impacts. "
        "NEXT: invoke atomic native interrupt; resume on same pinned case revision. "
        "FAILURE: do not ask the human to make legal verdicts or repeat answered questions."
    ),
    "request_finalization": (
        "WHEN: accepted decisions cover the authorized scope with no unresolved material blockers. "
        "READ: API current coverage and request status. NEXT: API completion is authoritative. "
        "FAILURE: selected-only completion must not fabricate a full-rule-set report."
    ),
}
TOOL_PLAYBOOKS_VI = {
    "get_assessment_context": (
        "KHI DÙNG: lần gọi đầu tiên, resume, hoặc sau khi case thay đổi. "
        "ĐỌC: pin từ server, các rule được chọn, fact đã chấp nhận, blocker và revision. "
        "TIẾP: nạp lại rule trước khi kết luận. "
        "LỖI: thiếu/stale context phải dừng, không lấy checkpoint memory thay API."
    ),
    "get_assessment_rule": (
        "KHI DÙNG: trước khi điều tra rule được chọn. ĐỌC: ID criterion/condition và phạm vi pháp lý kế thừa. "
        "TIẾP: đọc nguồn luật pin trước khi xem code. "
        "LỖI: rule thiếu/không được chọn không cho phép tạo criterion mới."
    ),
    "read_legal_source": (
        "KHI DÙNG: cần xác minh hiệu lực và nghĩa vụ. ĐỌC: provision đã pin, actor, ngoại lệ, mốc thời gian "
        "và dependency. TIẾP: đối chiếu criterion theo nguồn. "
        "LỖI: văn bản thiếu/bị bãi bỏ/dự thảo không mặc định là nghĩa vụ đang áp dụng."
    ),
    "cite_repository_source": (
        "KHI DÙNG: đã thực sự đọc đúng dòng trong source snapshot. ĐỌC: path:start-end và hành vi quan sát. "
        "TIẾP: dùng evidence ID do tool trả về. "
        "LỖI: README, code không chạy, search hit hoặc code graph không tự chứng minh execution."
    ),
    "record_search_coverage": (
        "KHI DÙNG: phải mô tả cuộc tìm kiếm negative. ĐỌC: entrypoint đã kiểm và direct source fallback. "
        "TIẾP: lưu rõ gap, truncated và negative control. "
        "LỖI: zero hit không chứng minh không tồn tại toàn cục hoặc thực tiễn bên ngoài repo."
    ),
    "submit_rule_decision": (
        "KHI DÙNG: applicability và toàn bộ criterion trọng yếu có chứng cứ hiện hành. "
        "ĐỌC: accepted facts, phạm vi luật, citation và phản chứng. "
        "TIẾP: submit trạng thái typed và nguồn tham chiếu. "
        "LỖI: fact trọng yếu chưa rõ phải điều tra/HITL, không ép NOT_APPLICABLE hay COMPLIANT."
    ),
    "open_human_request": (
        "KHI DÙNG: fact ngoài repository làm thay đổi applicability, outcome hoặc evidence. "
        "ĐỌC: selected rule, lý do code không trả lời, câu hỏi fact, owner và tác động. "
        "TIẾP: native interrupt, resume cùng case pin. "
        "LỖI: không hỏi người dùng phán quyết pháp lý hoặc lặp câu đã được trả lời."
    ),
    "open_human_requests_batch": (
        "KHI DÙNG: nhiều fact ngoài repository cần thu thập qua nhiều rule hoặc criterion. "
        "ĐỌC: các selected rule, lý do code không trả lời, từng câu hỏi fact, owner và tác động. "
        "TIẾP: native interrupt nguyên tử cho cả đợt, resume cùng case pin. "
        "LỖI: không hỏi người dùng phán quyết pháp lý hoặc lặp câu đã được trả lời."
    ),
    "request_finalization": (
        "KHI DÙNG: các decision trong phạm vi đã chấp nhận đủ, không còn blocker trọng yếu. "
        "ĐỌC: API coverage và request status. TIẾP: chỉ API xác nhận hoàn tất. "
        "LỖI: selected-only không được tự tạo báo cáo full-rule-set."
    ),
}


TOOL_PLAYBOOKS_EN.update({
    "get_pinned_rule_set": "WHEN: After get_assessment_context and on scope revision. READ: only authorized selected rules, page via nextOffset. NEXT: get_assessment_rule for one selected ID. FAILURE: missing pages cannot be silently treated as complete coverage.",
    "get_rule_decision": "WHEN: A prior rule is RESOLVED or a decision must be corrected. READ: latest accepted packet, revision, references and invalidation. NEXT: reuse if still current; reopen only material contradiction. FAILURE: old acceptance is not proof of semantic correctness.",
    "search_legal_source": "WHEN: A source term, exception or cross-reference needs resolution. READ: pinned results and effect metadata. NEXT: read_legal_source exact provision, not search snippet. FAILURE: empty search cannot establish absence of a legal condition.",
    "start_rule_investigation": "WHEN: Selected rule is pending/invalidated and requires evidence. READ: current state and original decision if any. NEXT: bounded source inspection with counterevidence. FAILURE: do not restart still-current accepted work.",
    "accept_case_fact": "WHEN: A narrow fact is directly supported. READ: authentic customer/source reference and exact claim extent. NEXT: bind it to affected rule predicates. FAILURE: README, code or speculation cannot establish deployment/legal identity.",
    "report_human_fact_unresolvable": "WHEN: Authenticated accepted evidence proves the fact can NEVER be obtained. READ: specific unresolved fact and permanent barrier. NEXT: submit supported unresolvable report. FAILURE: timeout/unanswered request is not permanent impossibility.",
    "submit_final_report": "WHEN: FULL_RULE_SET is FINALIZING and all rules have current accepted decisions. READ: frozen accepted IDs, rule coverage and evidence. NEXT: submit exactly supported findings. FAILURE: SELECTED_RULES cannot publish a full report.",
    "list_assessment_skills": "WHEN: Reconnaissance identifies a bounded investigation problem. READ: methodology catalog only. NEXT: choose minimal relevant skill or none. FAILURE: listing a skill never proves a technology or duty.",
    "load_assessment_skill": "WHEN: Selected source evidence justifies one catalog skill. READ: allowed method and non-authority marker. NEXT: apply as investigation technique only. FAILURE: bad locale/name or unavailable skill means no fallback to fabricated instructions."
})
TOOL_PLAYBOOKS_VI.update({
    "get_pinned_rule_set": "KHI DÙNG: sau get_assessment_context và khi đổi scope. ĐỌC: chỉ các rule được chọn, phân trang đến nextOffset hết. TIẾP: get_assessment_rule cho một ID hợp lệ. LỖI: thiếu trang không được coi là đủ coverage.",
    "get_rule_decision": "KHI DÙNG: rule RESOLVED hoặc cần sửa decision. ĐỌC: packet, revision, reference, trạng thái mất hiệu lực. TIẾP: tái sử dụng nếu còn đúng; mở lại khi có phản chứng trọng yếu. LỖI: API từng nhận không chứng minh nghĩa đúng.",
    "search_legal_source": "KHI DÙNG: cần làm rõ định nghĩa, ngoại lệ, dẫn chiếu. ĐỌC: kết quả có pin và hiệu lực. TIẾP: read_legal_source vào điều khoản chính xác. LỖI: không tìm thấy không chứng minh điều kiện pháp lý vắng mặt.",
    "start_rule_investigation": "KHI DÙNG: rule được chọn còn PENDING hoặc INVALIDATED. ĐỌC: trạng thái và decision trước đó. TIẾP: đọc source theo phạm vi, tìm phản chứng. LỖI: không khởi động lại decision còn hiệu lực.",
    "accept_case_fact": "KHI DÙNG: có fact hẹp được chứng cứ thật hỗ trợ. ĐỌC: nguồn và giới hạn của fact. TIẾP: gắn vào predicate của từng rule liên quan. LỖI: README, code hay giả định không xác minh deployment hoặc pháp nhân.",
    "report_human_fact_unresolvable": "KHI DÙNG: accepted evidence chứng minh fact vĩnh viễn không thể có. ĐỌC: fact cụ thể và rào cản không thể khắc phục. TIẾP: ghi nhận lý do có nguồn. LỖI: chưa trả lời hoặc timeout không phải không thể thu thập.",
    "submit_final_report": "KHI DÙNG: FULL_RULE_SET đang FINALIZING và quyết định đủ. ĐỌC: decision ID đã chấp nhận, coverage và evidence. TIẾP: chỉ báo cáo finding có chứng cứ. LỖI: SELECTED_RULES không được tạo full report.",
    "list_assessment_skills": "KHI DÙNG: đã khảo sát hệ thống và có bài toán điều tra cụ thể. ĐỌC: catalog phương pháp, không phải luật. TIẾP: chọn tối thiểu skill phù hợp hoặc không chọn. LỖI: skill tồn tại không chứng minh repo có công nghệ đó.",
    "load_assessment_skill": "KHI DÙNG: nguồn đã đọc xác nhận một phương pháp phù hợp. ĐỌC: skill được phép và ranh giới non-authoritative. TIẾP: áp dụng cho điều tra, không tạo duty. LỖI: tên/locale sai hay skill lỗi không cho phép tự bịa fallback."
})


TOOL_PLAYBOOKS_EN.update({
    "search_code_graph": "WHEN: Symbol or call-site discovery needs narrowing. READ: indexed candidate paths and graph coverage warnings. NEXT: inspect pinned source lines. FAILURE: missing graph nodes never prove absent behavior.",
    "trace_call_path": "WHEN: A reachable path matters to one selected criterion. READ: entrypoint, branches, side effects and coverage gaps. NEXT: verify exact implementation and negative paths. FAILURE: a possible indexed edge is not runtime proof.",
    "search_code_text": "WHEN: Search for bounded implementation clues. READ: pattern, paths, result limit and truncation. NEXT: inspect exact files and broaden only when justified. FAILURE: a zero-hit or truncated response is not universal absence.",
    "get_repository_architecture": "WHEN: First map input, effect and deployment boundary. READ: candidate entrypoints and excluded source. NEXT: trace actual code in pinned snapshot. FAILURE: architecture summary cannot establish operator practice."
})
TOOL_PLAYBOOKS_VI.update({
    "search_code_graph": "KHI DÙNG: cần khoanh vùng symbol hoặc caller. ĐỌC: path gợi ý và coverage gap của graph. TIẾP: kiểm chứng đúng dòng source pin. LỖI: graph không có node không chứng minh code không tồn tại.",
    "trace_call_path": "KHI DÙNG: cần chứng minh luồng liên quan criterion được chọn. ĐỌC: entrypoint, nhánh, side effect, coverage gap. TIẾP: kiểm nguồn và nhánh phản chứng. LỖI: cạnh index không phải bằng chứng runtime.",
    "search_code_text": "KHI DÙNG: tìm manh mối implementation có giới hạn. ĐỌC: pattern, paths, giới hạn và truncated. TIẾP: đọc file đúng, mở rộng khi có căn cứ. LỖI: zero hit hoặc truncated không chứng minh vắng mặt toàn cục.",
    "get_repository_architecture": "KHI DÙNG: lập bản đồ đầu vào, hậu quả và ranh giới vận hành. ĐỌC: entrypoints tiềm năng, nguồn bị loại trừ. TIẾP: truy đến implementation trong snapshot pin. LỖI: tóm tắt kiến trúc không chứng minh hành vi của operator."
})


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
    playbook = (TOOL_PLAYBOOKS_VI if normalized == "vi" else TOOL_PLAYBOOKS_EN).get(name)
    contract = ("\n\nASSESSMENT TOOL CONTRACT: " + guidance) if guidance else ""
    method = ("\nTOOL WORKFLOW (non-normative): " + playbook) if playbook else ""
    return original.strip() + contract + method
