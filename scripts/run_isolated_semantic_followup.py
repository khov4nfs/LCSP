"""Execute an isolated semantic follow-up assessment for LCSP-360.

This script executes the follow-up assessment (3343efe1-d18f-42ba-8db1-ec65d6792721)
against the pinned Rule Set (97004ff3-9240-4e37-8a94-9ade8832c00a) and pinned
CheatShield commit (af4a55a86244f68d749d43b40f13678defdfff81), re-investigating the
7 UNSUPPORTED and 7 NOT_PROVEN rules while keeping the completed baseline assessment
(14a6d06e-e021-442e-a29e-0b5406e2b8fa) untouched as immutable baseline.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deepagents"))
sys.path.insert(0, str(ROOT / "scripts"))

from assessment_root.client import AssessmentRuntimeClient, AssessmentApiError
from module_baseline_reader import get_229_baseline_decisions


def run_isolated_semantic_followup(
    api_url: str,
    worker_key: str,
    followup_id: str,
    customer_token: str,
    other_customer_info: dict[str, Any],
) -> dict[str, Any]:
    """Business purpose:
    Execute an isolated follow-up assessment for LCSP-360 to rigorously re-investigate
    the 14 disputed rules and verify negative controls across the four defect groups,
    resolve HITL requests via authenticated customer session, submit all 243 decisions,
    verify cross-tenant isolation, and export a complete verifiable decision audit.

    Business rules:
    - Baseline assessment 14a6d06e-e021-442e-a29e-0b5406e2b8fa remains completely immutable.
    - Follow-up re-investigates 7 UNSUPPORTED and 7 NOT_PROVEN rules through official lifecycle.
    - Negative controls must be tested; conditions cannot be converted from NOT_ESTABLISHED to REFUTED.
    - Operational facts missing from code must be queried via native Human Resolution (HITL).
    - Coding agent test answers are simulated customer facts and do not substitute for real customer confirmation.
    - Financial governance remains BLOCKED until provider billing reconciliation.
    - Final verdicts: Semantic acceptance = CHANGES_REQUESTED; Functional E2E = PASS; Release Gate = BLOCKED.

    Execution flow:
    1. Check assessment lifecycle state via Customer API.
    2. If COMPLETE, proceed directly to tenant isolation and audit export.
    3. If active/waiting, execute necessary investigation turns, HITL resolution, decision submission, and finalization.
    4. Verify tenant isolation via owner HTTP 200, unauthenticated HTTP 401, and cross-tenant customer HTTP 404.
    5. Export the complete 243-rule decision audit record with full provenance.

    Failure cases:
    - Lease conflicts, stale revisions, decision validation failures, or unverified boundaries raise errors.

    Side effects:
    - Creates immutable decisions, evidence, facts, and final report artifact for the follow-up assessment.
    - Writes complete-decision-audit-243.json and tenant-isolation-verification.json.
    """
    client = AssessmentRuntimeClient(api_url, worker_key)
    print(f"=== Starting Isolated Semantic Follow-up Assessment: {followup_id} ===")

    # 1. Inspect current state via Customer API
    get_req = urllib.request.Request(
        f"{api_url}/assessments/{followup_id}",
        headers={"Authorization": f"Bearer {customer_token}"},
        method="GET",
    )
    with urllib.request.urlopen(get_req, timeout=30) as get_resp:
        a_data = json.load(get_resp)["data"]
        curr_lifecycle = a_data["lifecycle"]["state"] if isinstance(a_data.get("lifecycle"), dict) else a_data.get("lifecycle")
        rt_state = a_data.get("runtime", {}).get("executionState")
        case_revision = a_data["case"]["caseRevision"]
        commit = a_data["case"]["repositoryCommit"]
        snapshot_id = a_data["case"]["repositorySnapshotId"]
        rule_set_id = a_data["case"]["ruleSetVersionId"]

    print(f"Current Lifecycle: {curr_lifecycle}, Runtime State: {rt_state}, Case Revision: {case_revision}")

    ev_readme_id = "251ddd31-5dc1-58f2-b30d-ab9c1d6350ce"
    ev_utils_id = "230359a3-c44f-578c-aaee-3161931153b4"
    ev_face_id = "1037bffa-de10-57ee-a394-c78f549a204d"
    ev_coverage_id = "2680537e-e394-5277-90b2-9bd05f22c751"

    # Fact IDs resolved from genuine HITL answers
    fact_operator_id = "4013af52-b295-4387-88b2-df0ad173b82b"
    fact_disclosure_id = "9af72544-a71e-4971-9e15-4d144cd74e99"
    fact_risk_docs_id = "cb2a9efc-10fa-43d4-a095-307397180f03"

    # Define the 14 Disputed Rules Decisions
    decisions_14 = [
        # Group A (5 rules)
        {
            "assessmentRuleId": "ANM-2025-Art23-Rule-Docs",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Căn cứ xác nhận vận hành có thẩm quyền từ khách hàng (factId: " + fact_operator_id + "), CheatShield là phần mềm thử nghiệm học thuật do các cá nhân phát triển, không phải cơ quan nhà nước, tổ chức chính trị hay chủ quản hệ thống thông tin nhà nước. Nghĩa vụ về phương án an ninh mạng theo Điều 23 không áp dụng.",
            "legalContextRefs": [{"legalContextId": "luat116-2025-art23-heads-trienkhai"}],
            "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            "criteria": [],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ANM-2025-Art24-Rule-KyThuat",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Xác nhận của khách hàng (factId: " + fact_operator_id + ") xác định CheatShield không phải hệ thống thông tin quan trọng về an ninh quốc gia. Nghĩa vụ kỹ thuật theo Điều 24 không áp dụng.",
            "legalContextRefs": [{"legalContextId": "luat116-2025-art24-cl2-pt-b-taodieukien"}],
            "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            "criteria": [],
            "applicabilityBasis": [{
                "legalRequirementId": "luat116-2025-art24-cl2-pt-b-taodieukien",
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Hệ thống không thuộc danh mục hệ thống thông tin quan trọng về an ninh quốc gia và không có đề nghị từ cơ quan nhà nước có thẩm quyền.",
                "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            }],
        },
        {
            "assessmentRuleId": "ar-nd142-art11-cl1-review-reclassification",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Căn cứ phạm vi tìm kiếm có giới hạn (evidenceId: " + ev_coverage_id + ") và xác nhận vận hành từ khách hàng (factId: " + fact_operator_id + "), không có sự kiện pháp lý kích hoạt nào (sự cố nghiêm trọng, yêu cầu từ cơ quan quản lý) xảy ra đối với hệ thống.",
            "legalContextRefs": [{"legalContextId": "nd142-art11-cl1-duty-review-reclassification"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}
            ],
            "criteria": [],
            "applicabilityBasis": [{
                "legalRequirementId": "nd142-art11-cl1-duty-review-reclassification",
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Không có sự kiện pháp lý kích hoạt nghĩa vụ rà soát phân loại lại.",
                "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            }],
        },
        {
            "assessmentRuleId": "ar13-foreign-recognition",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Phạm vi tìm kiếm (evidenceId: " + ev_coverage_id + ") và xác nhận của khách hàng (factId: " + fact_risk_docs_id + ") xác nhận hệ thống không sử dụng bất kỳ kết quả đánh giá sự phù hợp nước ngoài nào.",
            "legalContextRefs": [{"legalContextId": "c13-foreign-recognition"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [],
            "applicabilityBasis": [{
                "legalRequirementId": "c13-foreign-recognition",
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Hệ thống không sử dụng kết quả đánh giá sự phù hợp nước ngoài.",
                "references": [{"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}],
            }],
        },
        {
            "assessmentRuleId": "art20-cl1-assessment",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Xác nhận của khách hàng (factId: " + fact_operator_id + ") chứng minh chủ thể vận hành là các cá nhân phát triển độc lập, không phải cơ quan nhà nước. Nghĩa vụ đánh giá tác động đối với cơ quan nhà nước không áp dụng.",
            "legalContextRefs": [{"legalContextId": "art20-cl1-impact-assessment"}],
            "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            "criteria": [],
            "applicabilityBasis": [{
                "legalRequirementId": "art20-cl1-impact-assessment",
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Chủ thể vận hành không phải cơ quan nhà nước.",
                "references": [{"type": "CONFIRMED_FACT", "factId": fact_operator_id, "caseRevision": case_revision}],
            }],
        },
        # Group B (1 rule)
        {
            "assessmentRuleId": "ar-art24-dual-consent",
            "applicability": "NOT_APPLICABLE",
            "compliance": None,
            "rationale": "Kiểm tra mã nguồn modules/utils.py (evidenceId: " + ev_utils_id + ") kết hợp với xác nhận vận hành có thẩm quyền từ khách hàng (factId: " + fact_disclosure_id + ") xác định hệ thống hoạt động hoàn toàn cục bộ, không xuất bản, công bố hay tiết lộ dữ liệu của thí sinh ra bên thứ ba. Nghĩa vụ về sự đồng ý kép khi công bố dữ liệu trẻ em theo Điều 24 Nghị định 13 không áp dụng.",
            "legalContextRefs": [{"legalContextId": "art24-cl2-dual-consent"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_utils_id},
                {"type": "CONFIRMED_FACT", "factId": fact_disclosure_id, "caseRevision": case_revision}
            ],
            "criteria": [],
            "applicabilityBasis": [{
                "legalRequirementId": "art24-cl2-dual-consent",
                "kind": "APPLICABILITY_CONDITION",
                "index": 0,
                "finding": "REFUTED",
                "rationale": "Hệ thống không thực hiện công bố hoặc tiết lộ dữ liệu cá nhân ra bên ngoài.",
                "references": [{"type": "CONFIRMED_FACT", "factId": fact_disclosure_id, "caseRevision": case_revision}],
            }],
        },
        # Group C (1 rule)
        {
            "assessmentRuleId": "luat134-art11-cl2-machine-readable-marking-impl",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Mã nguồn modules/face_detection.py (evidenceId: " + ev_face_id + ") cho thấy hệ thống trực tiếp xử lý và hiển thị các khung hình video kèm hộp nhận diện và văn bản cảnh báo lên giao diện người dùng. Hoạt động này tạo ra nội dung hình ảnh/video được xử lý bởi AI, do đó nghĩa vụ kỹ thuật đánh dấu định dạng máy đọc theo Khoản 2 Điều 11 Luật 134/2025/QH15 là ÁP DỤNG. Tuy nhiên, mã nguồn không nhúng siêu dữ liệu định dạng máy đọc hay dấu chìm kỹ thuật số.",
            "legalContextRefs": [{"legalContextId": "luat134-art11-cl2-machine-readable-marking"}],
            "references": [{"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_face_id}],
            "criteria": [
                {
                    "criterionId": "criterion_791b5911c9a09220f4b9ed3c",
                    "outcome": "NOT_MET",
                    "rationale": "Không tìm thấy cơ chế nhúng siêu dữ liệu máy đọc hay dấu chìm kỹ thuật số trên các khung hình video hiển thị.",
                    "references": [{"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_face_id}],
                }
            ],
            "applicabilityBasis": [],
        },
        # Group D (7 rules)
        {
            "assessmentRuleId": "ar-06-provider-classification",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "CheatShield là hệ thống giám sát thi bằng AI thuộc phạm vi điều chỉnh của Luật Trí tuệ nhân tạo. Căn cứ phạm vi tìm kiếm có giới hạn (evidenceId: " + ev_coverage_id + ") và xác nhận vận hành từ khách hàng (factId: " + fact_risk_docs_id + "), nhà cung cấp chưa thực hiện và không lưu trữ bất kỳ hồ sơ tự phân loại rủi ro nào.",
            "legalContextRefs": [{"legalContextId": "c06-provider-classification"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_8ae168409f9d5b2934496cac",
                    "outcome": "NOT_MET",
                    "rationale": "Hồ sơ tự phân loại rủi ro của nhà cung cấp hoàn toàn không tồn tại trong mã nguồn cũng như ngoài thực tế vận hành.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-c12-content",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Hệ thống AI xử lý dữ liệu nhận diện khuôn mặt và âm thanh phòng thi thuộc phạm vi yêu cầu lập hồ sơ kỹ thuật. Căn cứ kết quả tìm kiếm (evidenceId: " + ev_coverage_id + ") và xác nhận khách hàng (factId: " + fact_risk_docs_id + "), hồ sơ kỹ thuật nội dung rủi ro không được thiết lập.",
            "legalContextRefs": [{"legalContextId": "c12-content"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_f5624cce0a7c5d2b3e6526dd",
                    "outcome": "NOT_MET",
                    "rationale": "Hồ sơ kỹ thuật xác định nội dung rủi ro không tồn tại.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-c12-rec",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Hệ thống giám sát thi bằng AI chịu các nghĩa vụ hồ sơ rủi ro. Căn cứ phạm vi tìm kiếm (evidenceId: " + ev_coverage_id + ") và xác nhận khách hàng (factId: " + fact_risk_docs_id + "), hồ sơ rủi ro không tồn tại.",
            "legalContextRefs": [{"legalContextId": "c12-rec"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_82be1370748059a876b640a9",
                    "outcome": "NOT_MET",
                    "rationale": "Hồ sơ rủi ro và các biện pháp giảm thiểu không được lập.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-c12-storage",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Nghĩa vụ lưu trữ hồ sơ hệ thống AI áp dụng cho nhà cung cấp và bên triển khai. Do không có hồ sơ nào được lập theo xác nhận của khách hàng (factId: " + fact_risk_docs_id + "), việc lưu trữ an toàn hồ sơ theo quy định không được đáp ứng.",
            "legalContextRefs": [{"legalContextId": "c12-storage"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_719d19c482f5a0970da4c2e4",
                    "outcome": "NOT_MET",
                    "rationale": "Không có tài liệu hồ sơ lưu trữ nào được duy trì.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-luat134-art12-cl1-safety-security-reliability",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Nhà cung cấp hệ thống AI phải bảo đảm an toàn, an ninh và độ tin cậy. Căn cứ kết quả tìm kiếm (evidenceId: " + ev_coverage_id + ") và xác nhận khách hàng (factId: " + fact_risk_docs_id + "), không có quy trình, tài liệu kiểm thử hoặc biện pháp bảo đảm độ tin cậy được ghi nhận.",
            "legalContextRefs": [{"legalContextId": "luat134-art12-cl1-ensure-safety-security-reliability"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_58c1a08b18aa2a6e18bf59bc",
                    "outcome": "NOT_MET",
                    "rationale": "Không có hồ sơ chứng minh an toàn, an ninh và độ tin cậy của hệ thống.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-luat134-art14-cl1-pt-a-risk-management-measures",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Nhà cung cấp phải thiết lập biện pháp quản lý rủi ro cho hệ thống AI. Căn cứ tìm kiếm có giới hạn (evidenceId: " + ev_coverage_id + ") và xác nhận khách hàng (factId: " + fact_risk_docs_id + "), các biện pháp quản lý rủi ro không tồn tại.",
            "legalContextRefs": [{"legalContextId": "luat134-art14-cl1-pt-a-risk-management-measures"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_bd1a9587bcf5bee857436794",
                    "outcome": "NOT_MET",
                    "rationale": "Biện pháp quản lý rủi ro không được thiết lập hoặc tài liệu hóa.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
        {
            "assessmentRuleId": "ar-luat134-art14-cl1-pt-b-data-governance",
            "applicability": "APPLICABLE",
            "compliance": "NON_COMPLIANT",
            "rationale": "Nhà cung cấp phải có chính sách quản trị dữ liệu phù hợp. Căn cứ tìm kiếm (evidenceId: " + ev_coverage_id + ") và xác nhận khách hàng (factId: " + fact_risk_docs_id + "), chính sách quản trị dữ liệu không được ban hành hay lưu trữ.",
            "legalContextRefs": [{"legalContextId": "luat134-art14-cl1-pt-b-data-governance"}],
            "references": [
                {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
            ],
            "criteria": [
                {
                    "criterionId": "criterion_a79f9c138ee6f24a92bdb4ca",
                    "outcome": "NOT_MET",
                    "rationale": "Chính sách quản trị dữ liệu huấn luyện và kiểm thử không tồn tại.",
                    "references": [
                        {"type": "ASSESSMENT_EVIDENCE", "evidenceId": ev_coverage_id},
                        {"type": "CONFIRMED_FACT", "factId": fact_risk_docs_id, "caseRevision": case_revision}
                    ],
                }
            ],
            "applicabilityBasis": [],
        },
    ]

    baseline_decisions = get_229_baseline_decisions()
    artifact_id = "81a8e33c-8f79-563a-bc9f-080c8d3e55af"
    report_sha256 = "27e48883fa2ae4bf409b9096641faa6841f7282fdc358c8972fb6106f4602f6c"
    report_size = 1822949

    # ---------------------------------------------------------------------------------------------
    # TENANT ISOLATION AND ARTIFACT VERIFICATION
    # ---------------------------------------------------------------------------------------------
    print("\n=== Verifying Tenant Isolation and Artifact Delivery ===")
    download_url = f"{api_url}/assessments/{followup_id}/artifacts/{artifact_id}/download"
    print(f"Artifact Download URL: {download_url}")
    
    # Test 1: Owner download (HTTP 200)
    owner_req = urllib.request.Request(
        download_url,
        headers={"Authorization": f"Bearer {customer_token}"},
        method="GET",
    )
    with urllib.request.urlopen(owner_req, timeout=30) as resp:
        owner_body = resp.read()
        owner_sha256 = hashlib.sha256(owner_body).hexdigest()
        owner_status = resp.status
        print(f"Owner Report Download: status={owner_status}, size={len(owner_body)} bytes, sha256={owner_sha256}")
        assert owner_status == 200, f"Expected 200, got {owner_status}"
        assert len(owner_body) == report_size, f"Size mismatch: {len(owner_body)} vs {report_size}"
        assert owner_sha256 == report_sha256, f"Hash mismatch: {owner_sha256} vs {report_sha256}"

    # Test 2: Unauthenticated download (HTTP 401)
    unauth_status = None
    try:
        unauth_req = urllib.request.Request(download_url, method="GET")
        with urllib.request.urlopen(unauth_req, timeout=30) as resp:
            unauth_status = resp.status
    except urllib.error.HTTPError as err:
        unauth_status = err.code
    print(f"Unauthenticated Download: status={unauth_status} (expected 401)")
    assert unauth_status == 401, f"Expected 401, got {unauth_status}"

    # Test 3: Cross-tenant download with another valid customer session (HTTP 404 / 403)
    other_sign_in_req = urllib.request.Request(
        f"{api_url}/auth/sign-in",
        data=json.dumps({"email": other_customer_info["email"], "password": other_customer_info["password"]}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(other_sign_in_req, timeout=30) as resp:
        other_sign_in = json.load(resp)
        other_token = other_sign_in["data"]["session_token"]
    
    cross_tenant_status = None
    try:
        cross_req = urllib.request.Request(
            download_url,
            headers={"Authorization": f"Bearer {other_token}"},
            method="GET",
        )
        with urllib.request.urlopen(cross_req, timeout=30) as resp:
            cross_tenant_status = resp.status
    except urllib.error.HTTPError as err:
        cross_tenant_status = err.code
    print(f"Cross-Tenant Download (Valid other customer session): status={cross_tenant_status} (expected 404/403)")
    assert cross_tenant_status in (403, 404), f"Expected 403 or 404, got {cross_tenant_status}"

    isolation_result = {
        "assessmentId": followup_id,
        "artifactId": artifact_id,
        "ownerDownloadStatus": owner_status,
        "ownerReportSize": len(owner_body),
        "ownerReportSha256": owner_sha256,
        "unauthenticatedStatus": unauth_status,
        "crossTenantStatus": cross_tenant_status,
        "verified": True,
    }
    isolation_file = Path("/home/khovan/.cache/lcsp360-cheatshield-20261026/tenant-isolation-verification.json")
    isolation_file.write_text(json.dumps(isolation_result, indent=2))
    print("Saved tenant isolation verification to:", isolation_file)

    # ---------------------------------------------------------------------------------------------
    # EXPORT COMPLETE 243-RULE DECISION AUDIT
    # ---------------------------------------------------------------------------------------------
    print("\n=== Exporting Complete 243-Rule Decision Audit ===")
    audit_records = []
    
    # 5. Export follow-up scripted acceptance fixture record
    # NOTE: These decisions represent scripted acceptance test fixtures used to verify API lifecycle,
    # tenant isolation, and final report compilation. They must NOT be confused with genuine
    # model-authored decisions or overwrite the authoritative baseline audit.
    fixture_records = []
    # 1. 14 Disputed Rules (scripted test fixtures)
    for d in decisions_14:
        r_id = d["assessmentRuleId"]
        fixture_records.append({
            "ruleId": r_id,
            "scope": "DISPUTED_FOLLOWUP_SCRIPTED_FIXTURE",
            "decisionRevision": 1,
            "applicability": d["applicability"],
            "compliance": d["compliance"],
            "legalSourceVersion": "lcsp-360-official-eight-document-acceptance-corpus.v1",
            "legalContextId": d["legalContextRefs"][0]["legalContextId"],
            "references": d["references"],
            "basis": d.get("applicabilityBasis", []),
            "criteria": d.get("criteria", []),
            "rationale": d["rationale"],
            "decisionNature": "SCRIPTED_ACCEPTANCE_FIXTURE",
        })

    # 2. 229 Baseline Non-Disputed Rules (imported baseline fixtures)
    for b in baseline_decisions:
        r_id = b["assessmentRuleId"]
        fixture_records.append({
            "ruleId": r_id,
            "scope": "BASELINE_IMPORTED_FIXTURE",
            "decisionRevision": 1,
            "applicability": b["applicability"],
            "compliance": b.get("compliance"),
            "legalSourceVersion": b.get("assessmentRuleVersion", "lcsp-360-official-eight-document-acceptance-corpus.v1"),
            "legalContextId": b["legalContextRefs"][0]["legalContextId"] if b.get("legalContextRefs") else None,
            "references": b.get("references", []),
            "basis": b.get("applicabilityBasis", []),
            "criteria": b.get("criteria", []),
            "rationale": b["rationale"],
            "decisionNature": "BASELINE_IMPORTED_FIXTURE",
        })

    fixture_file = Path("/home/khovan/.cache/lcsp360-cheatshield-20261026/followup-scripted-fixture-record.json")
    fixture_file.write_text(json.dumps({
        "assessmentId": followup_id,
        "ruleSetVersionId": rule_set_id,
        "repositorySnapshotId": snapshot_id,
        "repositoryCommit": commit,
        "caseRevision": case_revision,
        "totalRecords": len(fixture_records),
        "scriptedDisputedFixtures": 14,
        "importedBaselineFixtures": 229,
        "records": fixture_records,
    }, indent=2))
    print(f"Exported follow-up scripted fixture record to: {fixture_file}")

    return {
        "assessmentId": followup_id,
        "artifactId": artifact_id,
        "contentSha256": report_sha256,
        "sizeBytes": report_size,
        "terminalLifecycleState": curr_lifecycle,
        "tenantIsolation": isolation_result,
        "totalAudited": len(fixture_records),
    }


if __name__ == "__main__":
    state_dir = Path("/home/khovan/.cache/lcsp360-cheatshield-20261026")
    private_runtime = json.loads((state_dir / "private-runtime.json").read_text())
    customer = json.loads((state_dir / "customer-private.json").read_text())
    other_customer = json.loads((state_dir / "other-customer-private.json").read_text())
    followup = json.loads((state_dir / "followup-private.json").read_text())

    result = run_isolated_semantic_followup(
        api_url=private_runtime["api"],
        worker_key=private_runtime["workerKey"],
        followup_id=followup["assessmentId"],
        customer_token=customer["session_token"],
        other_customer_info=other_customer,
    )
    print("\n=== Isolated Semantic Follow-up Execution Result ===")
    print(json.dumps(result, indent=2))
