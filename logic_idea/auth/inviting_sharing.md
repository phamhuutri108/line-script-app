# Logic Mời và Chia sẻ (Inviting & Sharing)

## Các Tính năng Hiện tại
- **Lời mời tham gia dự án**: Các dự án có thể được chia sẻ hoặc mời người dùng tham gia thông qua các token duy nhất và bảo mật.
- **Xử lý lời mời**: Trang `InvitePage` xử lý người dùng truy cập qua các token đặc biệt, thực hiện đăng ký hoặc liên kết họ với tài nguyên.
- **Chia sẻ dự án**: Chia sẻ quyền chỉ xem (read-only) hoặc cộng tác cho các dự án/kịch bản cụ thể với người dùng bên ngoài mà không yêu cầu quyền truy cập đầy đủ vào dashboard.

## Logic Thực thi
### Lời mời (Invites)
- **Tạo Token**: Khi mời một người dùng, hệ thống tạo một token duy nhất liên kết với `projectId`.
- **Xác thực**: Khi truy cập link mời, backend kiểm tra tính hợp lệ của token trước khi thêm người dùng vào bảng `project_members`.

### Chia sẻ (Sharing)
- **Share Token**: Cho phép tạo link chia sẻ công khai cho một kịch bản cụ thể.
- **Quyền truy cập**: Người dùng có link (token) có thể xem dữ liệu shotlist mà không cần đăng nhập, thông qua route `/share/:token`.
