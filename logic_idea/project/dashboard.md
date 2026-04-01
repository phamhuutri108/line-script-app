# Logic Dashboard Dự án

## Các Tính năng Hiện tại
- **Danh sách Dự án**: Trang chính hiển thị tất cả các dự án mà người dùng có quyền truy cập.
- **Thao tác**: Tạo, Xóa và Cập nhật thông tin dự án (tên, mô tả).
- **Điều hướng**: Liên kết trực tiếp đến trang chi tiết của các dự án cụ thể.

## Logic Thực thi
### Hiển thị danh sách Dự án (List Projects)
- **Logic truy vấn**:
  - **Super Admin**: Lấy tất cả các dự án chưa bị xóa tạm thời.
  - **Người dùng tiêu chuẩn**: Lấy các dự án mà họ là chủ sở hữu (`owner_id`) hoặc có tên trong bảng `project_members`.
- **Thông tin bổ sung**: Bao gồm số lượng thành viên (`member_count`) và số lượng kịch bản (`script_count`) thông qua các truy vấn con (sub-queries).

### Tạo Dự án (Create Project)
- **Kiểm tra**: Yêu cầu tên dự án không được để trống.
- **Phân quyền tự động**: Người tạo được chỉ định là `owner_id` và tự động được thêm vào bảng `project_members`.
- **Lưu trữ**: Bản ghi được tạo trong bảng `projects` với một ID duy nhất được tạo ra.

### Xóa tạm thời & Thùng rác (Soft Delete & Trash)
- **Xóa tạm thời**: Đặt giá trị cho cột `deleted_at`.
- **Khôi phục từ thùng rác**: Có thể xem và khôi phục các dự án trong chế độ 'trash'.
- **Tự động xóa vĩnh viễn**: Một quy trình (thực hiện khi liệt kê danh sách) sẽ xóa vĩnh viễn các dự án khỏi cơ sở dữ liệu nếu chúng đã nằm trong thùng rác hơn 30 ngày.
- **Quyền hạn**: Chỉ chủ sở hữu hoặc admin mới có quyền xóa/khôi phục dự án.
