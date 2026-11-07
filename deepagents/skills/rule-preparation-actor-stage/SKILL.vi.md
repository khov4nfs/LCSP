---
name: rule-preparation-actor-stage
description: Phân loại actor và giai đoạn nghĩa vụ pháp lý cho development-only rule catalog.
---
# Phân loại chủ thể và giai đoạn — Preparation

## Khi dùng
Sau khi đọc source unit thuộc /legal-source đã pin, trước khi đề xuất catalog development. Không đọc repository, assessment, dữ liệu khách hàng.

## Hợp đồng đầu vào
Source nodeId, legalSourceVersionId, canonicalLocator, exact quote, ancestors, điều kiện/ngoại lệ và target scope do **server** cấp.

## Quy trình
1. Tách mỗi operative proposition theo actor, modality, action, object, trigger. Không dựa vào mỗi chữ "phát triển" hay "ứng dụng".
2. Phân biệt nhà phát triển, nhà cung cấp, bên triển khai, người sử dụng, Nhà nước và nhà sản xuất thương mại. Nhà cung cấp có thể có duty thiết kế; không mặc định đồng nhất với nhà phát triển.
3. Phân loại stage: DEVELOPMENT (thiết kế/xây dựng/huấn luyện/kiểm thử/tích hợp, safeguard built-in), OPERATION/DEPLOYMENT/USE, COMMERCIAL_PRODUCTION, PUBLIC_AUTHORITY, MIXED.
4. Provider duty phát sinh trước đưa vào sử dụng có thể liên quan dev; nếu không chắc đánh dấu LEGAL_REVIEW_REQUIRED, không loại tự động.
5. Output review scope: DEVELOPMENT_CANDIDATE, SPLIT_DEV_AND_NONDEV, CONTEXT_ONLY_IF_LINKED, EXCLUDE_FROM_DEV_CATALOG, LEGAL_REVIEW_REQUIRED; kèm chính xác quote/reason.

## Đầu ra
{sourceNodeId, locator, actor, normativeAction, stage, scopeDecision, support, materialContext, reviewerStatus}. Chỉ là projection, KHÔNG đưa các field này vào schema chưa hỗ trợ.

## Cấm
Không bãi bỏ/đánh NOT_APPLICABLE, không dùng NO_REQUIREMENT cho một duty nằm ngoài target scope, không giả source ID/hash, không tự activate.

## Quy tắc bỏ qua hoàn toàn phần chỉ liên quan deployment

Trong bản projection DEVELOPMENT_ONLY, không đưa Điều/Khoản/Điểm, AssessmentRule hoặc đoạn context chỉ dành cho deploy, production operation, sử dụng hay quản lý nhà nước. Nếu một khoản trộn nhiều chủ thể thì phải tách từng hành vi; chỉ bỏ nhánh non-development, giữ nhánh developer có căn cứ.

Việc chung số Điều hoặc chung chủ đề không phải quan hệ material. Ngoại lệ phải được xác minh cùng nguồn/quan hệ hướng, chỉ giữ predicate tối thiểu. Full legal ledger và validation không được cắt.
