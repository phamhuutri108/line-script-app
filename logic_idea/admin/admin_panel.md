# Logic Bảng Quản trị (Admin Panel)

## Các Tính năng Hiện tại
- **Quản lý Người dùng**: Giao diện độc quyền dành cho admin.
- **Phê duyệt Đăng ký**: Phê duyệt người dùng đang ở trạng thái "pending".

## Logic Thực thi
### Vai trò Người dùng (User Roles)
- **Hệ thống cấp bậc**: `admin`, `user`, `pending`.
- **Kiểm tra bằng Middleware**: Mọi route của admin đều sử dụng `isSuperAdmin` để đảm bảo chỉ người dùng có vai trò `admin` mới có thể thực hiện.

### Quy trình Phê duyệt
- **Thao tác**: Admin có thể cập nhật vai trò của người dùng từ `pending` sang `user`.
- **Tác động**: Điều này cho phép người dùng vượt qua kiểm tra `login` và nhận được JWT token hợp lệ để truy cập hệ thống.
