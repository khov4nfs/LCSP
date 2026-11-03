---
name: rule-preparation-mixed-claims
description: Tách quyền, nghĩa vụ và điều kiện trong Điều/Khoản/Điểm nhiều chủ thể và nhiều giai đoạn.
---
# Tách mệnh đề luật mixed theo development/operation

## Khi dùng
Một khoản chứa nhiều actor/modality/stage; ví dụ khoản 2 Điều 10 Luật 134 vừa chứa PERMISSION vừa DUTY, Điều 12 khoản 1 có nhà phát triển và bên triển khai/người sử dụng.

## Quy trình
1. Đánh số các operative verbs từ exact source. Cho từng mệnh đề giữ {actor, modality, action, object, trigger, qualifier, exception, timing}.
2. Chỉ dùng 12 claim types hợp lệ của claim-file.schema.json. SPLIT_DEV_AND_NONDEV là nhãn review, không phải claim enum.
3. Chia nhánh dev và non-dev khi luật thực sự cho phép; không thay đổi câu chữ, chủ thể và tiền đề để làm vừa mục tiêu.
4. Nối SCOPE/CONDITION_OF, QUALIFIES, EXCEPTION_TO, DEFINED_BY và legalEffect chính xác qua source graph; không nhân đôi từ khoản dẫn và điểm con.
5. Với assessability MIXED, giữ repositoryObservableAspect và externalFulfillmentAspect; không biến nghĩa vụ bên ngoài thành code obligation.
6. Report những nhánh dev có thể thành AR và những nhánh non-dev chỉ account trong legal ledger.

## Negative controls
"Được" không trở thành "phải"; DUTY của bên triển khai không thành duty developer; "trước khi sử dụng" không mặc nhiên loại provider design duty; không bỏ nghĩa vụ dev khi cùng khoản có nghĩa vụ vận hành.

## Đầu ra
Typed claims + source support + directed relations + classification cho projection; thiếu context thì phải review, không đoán.
