# Logic Xác thực (Authentication)

## Các Tính năng Hiện tại
- **Đăng ký & Đăng nhập bằng Email/Mật khẩu**: Người dùng có thể đăng ký và đăng nhập bằng email và mật khẩu.
- **Trạng thái Chờ duyệt (Pending)**: Các đăng ký mới được đặt ở trạng thái 'pending' và phải được Admin phê duyệt trước khi có quyền truy cập đầy đủ.
- **Google OAuth**: Người dùng có thể xác thực bằng tài khoản Google.
- **Bảo mật JWT**: Các route được bảo vệ và API endpoint sử dụng JSON Web Tokens (JWT) để xác thực và phân quyền.
- **Bảo vệ Route giao diện**: Một số trang ở frontend yêu cầu phiên đăng nhập hợp lệ trước khi truy cập.

## Logic Thực thi
### Đăng ký (Registration)
- **Thu thập dữ liệu**: Thu thập `email`, `password` (tối thiểu 8 ký tự), và `name`.
- **Kiểm tra trùng lặp**: Xác minh xem email đã tồn tại trong bảng `users` chưa.
- **Băm mật khẩu (Hashing)**: Sử dụng `bcryptjs` với salt factor là 10.
- **Vai trò ban đầu (Role)**: Tất cả người dùng mới được gán vai trò `pending` theo mặc định.
- **Lưu trữ**: Chèn bản ghi vào bảng `users` trong Cloudflare D1.

### Đăng nhập (Login)
- **Xác thực thông tin**: So sánh mật khẩu được cung cấp với mã băm đã lưu bằng `bcrypt.compare`.
- **Kiểm tra vai trò**: Nếu vai trò của người dùng là `pending`, quyền truy cập bị từ chối với mã lỗi 403.
- **Tạo Token**: Sau khi đăng nhập thành công, một JWT được ký bằng `jose` với thời hạn 7 ngày. Payload bao gồm `id`, `email`, `name`, và `role`.

### Middleware (Phần mềm trung gian)
- **verifyAuth**: Giải mã và xác thực JWT từ tiêu đề `Authorization`.
- **isSuperAdmin**: Kiểm tra xem vai trò trong token đã giải mã có phải là 'admin' hay không.
