# Deploy LCSP bằng PM2 trên VPS

Workflow **Deploy LCSP on VPS** chạy khi `main` nhận commit mới. Để chạy
thủ công, mở **Actions → Deploy LCSP on VPS → Run workflow** rồi chọn
`develop` hoặc `main`. GitHub cần có workflow trên nhánh mặc định
`develop` trước khi hiện nút **Run workflow**. Cả hai nhánh trỏ đến cùng
LCSP production trên VPS, nên chạy từ `develop` sẽ cập nhật production.

| Chế độ | Kết quả |
| --- | --- |
| `keep` | Mặc định cho mọi lần deploy. Giữ các kho dữ liệu đang cấu hình, chạy Prisma migrations và khởi động lại LCSP trên PM2. |
| `disk-only` | Hiện dung lượng cho checkout, Docker và thư mục tạm. Có thể chạy khi checkout bẩn hoặc dung lượng dưới ngưỡng. |
| `reset` | Chỉ chạy thủ công với xác nhận `RESET LCSP PRODUCTION`. Yêu cầu VPS có trình reset dành riêng cho LCSP. |

## Cấu hình GitHub và VPS

Workflow dùng lại GitHub secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` và
`VPS_KNOWN_HOSTS` ở cấp repository hoặc Environment `production`. User SSH cần
là tài khoản đang vận hành PM2 và checkout `/srv/apps/LCSP`. Dùng khóa SSH
riêng cho Actions và lưu host key đã xác minh vào `VPS_KNOWN_HOSTS`.
Cho phép hai nhánh `main` và `develop` dùng environment production nếu
repo có cấu hình giới hạn nhánh.

Workflow yêu cầu mặc định **3 GiB (3.072 MiB) trống** trên từng filesystem dùng
để build. Có thể chỉnh qua biến environment `PM2_MIN_FREE_MIB`. Chạy
`disk-only` để xem dung lượng trước lần deploy đầu tiên. Khi deploy,
checkout phải sạch và `origin` phải đọc được nhánh đã chọn. Workflow kiểm
tra SHA đúng với đầu nhánh trước khi drain Agent Runtime. Theo dõi kết quả
của API và Web trong log Actions.

## Bật chế độ reset

Cài lệnh thực thi `/usr/local/sbin/lcsp-reset-data` thuộc tài khoản vận
hành PM2, với quyền `0750`. Workflow truyền hai tham số là đường dẫn
checkout và SHA đang triển khai. Lệnh được gọi sau khi drain Agent Runtime,
build xong và dừng ba tiến trình LCSP. Khi lệnh trả thành công, workflow
kiểm tra lại quyền DB, chạy migrations và khởi động dịch vụ.

Lệnh reset cần sao lưu hoặc chuyển sang bộ lưu trữ trống cho đúng phạm vi
LCSP. Xác định riêng database ứng dụng, database checkpoint LangGraph,
RabbitMQ vhost và các thư mục lưu trữ được cấu hình. Tránh tác động tới
broker, volume hoặc thư mục của ứng dụng khác trên cùng VPS. Nếu reset lỗi,
các tiến trình LCSP vẫn dừng để người vận hành kiểm tra trạng thái dữ liệu
và khôi phục trước khi cho chạy lại.
