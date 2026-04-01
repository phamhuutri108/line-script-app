# Logic Cài đặt Người dùng (User Settings)

## Các Tính năng Hiện tại
- **Tùy chỉnh Hồ sơ**: Người dùng có thể thay đổi các cài đặt cơ bản về bản thân.
- **Tùy chọn (Preferences)**: Hiển thị các tùy chọn về cách ứng dụng hoạt động.
- **Quản lý chi tiết tài khoản**: Form cập nhật thông tin cá nhân.

## Logic Thực thi
### Cập nhật Hồ sơ
- **Dữ liệu được cập nhật**: Cho phép thay đổi `name`, `password`, và các siêu dữ liệu khác.
- **Bảo mật**: Cập nhật mật khẩu bao gồm việc băm lại mật khẩu bằng `bcryptjs`.
- **Lưu trữ**: Các cập nhật được thực hiện trực tiếp vào bảng `users` dựa trên ID của người dùng đang đăng nhập.

### Liên kết bên ngoài (Google Sheets)
- **Tích hợp**: Có thể xử lý luồng OAuth ban đầu để liên kết tài khoản Google nhằm đồng bộ danh sách shotlist.
- **Lưu trữ thông tin xác thực**: Lưu trữ an toàn các token Google OAuth (nếu được thực hiện qua `google.ts`).
