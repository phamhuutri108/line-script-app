# Logic Chi tiết Dự án

## Các Tính năng Hiện tại
- **Quản lý Kịch bản**: Bên trong một dự án, các kịch bản có thể được thêm, cập nhật hoặc xóa.
- **Tải lên PDF**: Các dự án chấp nhận file PDF kịch bản trực tiếp để xử lý kẻ kịch bản (lining) hoặc vẽ storyboard.
- **Liên kết đến trình xem**: Cung cấp các điểm truy cập để mở trình xem kịch bản (viewer) hoặc trang danh sách cảnh quay (shotlist).

## Logic Thực thi
### Quản lý Kịch bản (Script Management)
- **Danh sách Kịch bản**: Lấy tất cả kịch bản có sẵn liên kết với `project_id`.
- **Phân quyền**: Xác minh xem người dùng có phải là thành viên dự án hoặc chủ sở hữu hay không trước khi hiển thị danh sách.
- **Khôi phục từ thùng rác**: Bao gồm logic để xem và khôi phục các kịch bản đã xóa trong phạm vi dự án.

### Bộ xử lý PDF (PDF Processor)
- **Luồng dữ liệu**: Frontend (form-data) -> Backend (route `uploadScript`) -> R2 Bucket + Metadata trong D1.
- **Giới hạn kích thước**: Thực thi giới hạn tối đa 50MB cho mỗi file PDF kịch bản.
- **Kiểm tra định dạng (MIME)**: Chỉ chấp nhận các file có định dạng `application/pdf`.

### Quản lý Thành viên (Member Management)
- **Danh sách thành viên**: Lấy danh sách tất cả người dùng liên kết với dự án thông qua bảng `project_members`.
- **Thêm/Xóa thành viên**: Chủ sở hữu hoặc Admin có thể thay đổi danh sách quyền bằng cách thêm hoặc xóa ID người dùng.
