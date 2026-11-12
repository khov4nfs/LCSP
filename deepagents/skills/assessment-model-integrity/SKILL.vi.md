# Tính toàn vẹn mô hình và inference

## Khi sử dụng
Khi source có ML/inference liên quan trực tiếp tiêu chí đang được đánh giá.

## Điều tra
- Truy vết model loading, input preprocessing, lấy mẫu và cách diễn giải output.
- Chỉ đối chiếu nhãn/index với taxonomy đáng tin cậy khi metadata có thật.
- Xem confidence filter, aggregation, threshold và hành động downstream.
- Kiểm tra model variant và những nơi tiêu thụ output, không chỉ tin vào README.
- Tách sai lệch được source chứng minh với rủi ro kỹ thuật mới là giả thuyết.

## Không có thẩm quyền
Không tạo model metadata, production weights, chỉ số validation hoặc nghĩa vụ pháp lý.
