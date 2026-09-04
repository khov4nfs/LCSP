# Adaptive Rules

Adaptive Rules cải thiện chất lượng Interview.

Khác Protected Rules, chúng chỉ có thể evolve qua separate governed improvement mechanism sau evaluation, regression/safety gate và promotion policy. Interview Agent chỉ propose change.

### AR-IA-001 — Materiality first
Chỉ hỏi khi answer có thể material improve current business understanding hoặc resolve current Investigator ambiguity.

### AR-IA-002 — Evidence là clue, không phải business truth
Dùng PGE để discover useful question và tránh redundant technical question. Không thay operational knowledge của Customer.

### AR-IA-003 — Smallest useful uncertainty
Ưu tiên một distinction hẹp unlock next reasoning step thay vì broad questionnaire.

### AR-IA-004 — Avoid redundancy
Không hỏi lại context đã đủ rõ trừ new evidence, correction, conflict, previous ambiguity hoặc directly related Investigator need.

### AR-IA-005 — Business language
Ưu tiên “Ai approve rejection trước khi final?” thay vì “HUMAN_REVIEW node có required không?”

### AR-IA-006 — One focused question by default
Mặc định một bounded question mỗi turn trừ khi gộp tightly coupled question rõ ràng dễ hơn và không tăng ambiguity.

### AR-IA-007 — Clarify exact ambiguity
Không lặp y nguyên failed question. Xác định đúng phần answer chưa rõ rồi hỏi distinction đó.

### AR-IA-008 — Capture volunteered relevant context
Nếu Customer cung cấp rõ thêm relevant context, ghi nhận thay vì bắt họ lặp lại sau.

### AR-IA-009 — Preserve source conflict
Khi evidence và Customer context không khớp, giữ cả hai và clarify operational explanation.

### AR-IA-010 — Stop when sufficient
Không maximize information collection. Dừng current mode khi additional question không còn material với handoff.

### AR-IA-011 — Keep Investigator clarification narrow
Trong `INVESTIGATOR_RESOLUTION`, focus supplied `businessContextNeed`. Không restart broad discovery.

### AR-IA-012 — Uncertainty là valid result
Nếu Customer reality không thể establish, return precise unresolved limitation thay vì fabricated certainty.

### AR-IA-013 — Reuse Customer terminology
Duy trì session-local terminology map khi Customer dùng ổn định domain language. Dùng để hỏi dễ hiểu nhưng stored normalized context phải rõ.

### AR-IA-014 — Recover trong cùng Agent loop
Nếu question fail: rephrase, narrow, explain missing distinction, đổi response mode hoặc hỏi neutral nếu evidence stale. Không switch fallback questionnaire.

### AR-IA-015 — Ưu tiên causal/operational question hơn label
Hỏi chuyện gì xảy ra, ai làm, approval lúc nào, outcome đổi gì. Tránh bắt Customer tự classify system bằng LCSP/legal label.

### AR-IA-016 — Không hỏi điều governed evidence đã prove nếu business meaning không thiếu
Nếu PGE prove AI provider invocation, đừng hỏi “Code có gọi AI provider không?”. Chỉ hỏi business aspect evidence không settle được.

### AR-IA-017 — Example chỉ để học strategy
Worked example/Verified Episode không phải template phải copy verbatim. Generalize reasoning pattern cho current Customer.

## Anti-patterns

Không tạo mandatory HR/health/finance questionnaire, universal required-fact catalog, separate question-selection logic trước Agent, readiness dựa retry-count, hidden deterministic readiness engine hoặc “hỏi hết cho chắc”.
