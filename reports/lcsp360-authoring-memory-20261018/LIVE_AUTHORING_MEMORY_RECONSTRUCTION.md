# Live authoring-memory reconstruction (run 7fefb641)

Method: real compact_draft_history from the deployed SHA fed only the retained tool-call sequence. Exact match with the live visible-message/tool-result series: **True** over 19 distinct states.

After the freeze: 21 model requests, 20 inventory reads; at most **3** prior inventory reads were ever visible; final view 14 messages / 6 tool results.

Rejection recurrence: previous rejection still visible at 9 requests, repeated at 0; gone at 9 read requests, repeated at 3.

## Verdict
- INFORMATION_LOSS: PROVEN (exact reproduction of the live visible-history series)
- REJECTION_RECURRENCE_AFTER_FEEDBACK_LEFT_VIEW: PROVEN as a pattern (0 of 9 repeats while visible; 3 of 3 repeats came after it left view)
- NO_AUTHORING_CAUSED_BY_FORGETTING: STRONGLY INDICATED, NOT PROVEN (no counterfactual run; model behaviour confound)

## Not retained
raw message bodies, returned claim IDs, offsets and the exact limit values were destroyed with the isolated stack; only tool names, argument keys/sizes and context counts survive

| req | time | tool | prior reads visible | last rejection visible | rounds since | rejected |
|---|---|---|---|---|---|---|
| 74 | 11:22:47 | get_claim_inventory | 0 | None | None | False |
| 75 | 11:22:48 | get_claim_inventory | 1 | None | None | True |
| 76 | 11:22:49 | get_claim_inventory | 2 | True | 1 | False |
| 77 | 11:22:51 | get_claim_inventory | 3 | True | 2 | False |
| 78 | 11:22:53 | get_claim_inventory | 3 | True | 3 | False |
| 79 | 11:22:54 | start_rule_authoring | 3 | False | 4 | False |
| 80 | 11:22:56 | get_claim_inventory | 3 | False | 5 | True |
| 81 | 11:22:57 | get_claim_inventory | 3 | True | 1 | False |
| 82 | 11:22:59 | get_claim_inventory | 3 | True | 2 | False |
| 83 | 11:23:01 | get_claim_inventory | 3 | True | 3 | False |
| 84 | 11:23:02 | get_claim_inventory | 3 | False | 4 | False |
| 85 | 11:23:04 | get_claim_inventory | 3 | False | 5 | False |
| 86 | 11:23:05 | get_claim_inventory | 3 | False | 6 | False |
| 87 | 11:23:06 | get_claim_inventory | 3 | False | 7 | True |
| 88 | 11:23:07 | get_claim_inventory | 3 | True | 1 | False |
| 89 | 11:23:09 | get_claim_inventory | 3 | True | 2 | False |
| 90 | 11:23:10 | get_claim_inventory | 3 | True | 3 | False |
| 91 | 11:23:11 | get_claim_inventory | 3 | False | 4 | False |
| 92 | 11:23:13 | get_claim_inventory | 3 | False | 5 | False |
| 93 | 11:23:14 | get_claim_inventory | 3 | False | 6 | False |
| 94 | 11:23:16 | get_claim_inventory | 3 | False | 7 | True |
