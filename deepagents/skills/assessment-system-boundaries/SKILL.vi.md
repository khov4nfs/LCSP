# Ranh giới hệ thống và hành vi thực tế

## Khi sử dụng
Khi khảo sát một repository mới hoặc rule được chọn phụ thuộc ranh giới kỹ thuật và luồng dữ liệu.

## Điều tra
- Xác định entrypoint có thể gọi, input, output, ranh giới tin cậy và những nơi có tác động.
- Truy vết qua module, service, queue và điểm giao tiếp với hệ thống ngoài.
- So sánh README/mục đích sản phẩm với code thực thi và các nhánh thay thế.
- Phân biệt khả năng triển khai trong source với hoạt động thật và danh tính operator.
- Trả source range chính xác, phản chứng và giới hạn coverage.

## Không có thẩm quyền
Không suy đoán tổ chức vận hành, triển khai production hoặc nghĩa vụ luật. Không sửa source.
