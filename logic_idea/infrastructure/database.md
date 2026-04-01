# Logic Cơ sở hạ tầng & Cơ sở dữ liệu

## Tổng quan về Lưu trữ
- **Cơ sở dữ liệu (D1)**: Dữ liệu quan hệ (người dùng, dự án, kịch bản, các đường line, cảnh quay, chú thích).
- **Lưu trữ đối tượng (R2)**: Lưu trữ các file PDF gốc.

## Lược đồ lõi & Mối quan hệ
### Các bảng chính
- **`users`**: Bảng xác thực chính.
- **`projects`**: Các container cấp cao nhất. Liên kết với `users` qua `owner_id`.
- **`project_members`**: Bảng liên kết để quản lý quyền truy cập cộng tác.
- **`scripts`**: Siêu dữ liệu của file PDF. Liên kết với `projects`. Lưu trữ `r2_key` và `sheets_id` (tùy chọn).
- **`script_lines`**: Dữ liệu kẻ kịch bản trực quan. Liên kết với `scripts` và `users`.
- **`annotations`**: Dữ liệu Fabric.js trên canvas. Liên kết với `scripts` và `users`.
- **`shots`**: Dữ liệu sản xuất cho shotlist. Liên kết với `scripts`, `users`, và tùy chọn liên kết với một `line_id`.
- **`share_tokens`**: Các token để xem công khai từ bên ngoài.

## Logic Bảo mật
- **Kiểm tra quyền sở hữu**: Hầu hết các thao tác ghi đều xác minh xem `user_id` có khớp với `owner_id` hoặc người dùng có phải là `admin` hay không.
- **Kiểm tra tư cách thành viên**: Việc đọc dữ liệu dự án/kịch bản yêu cầu phải là chủ sở hữu hoặc thành viên (xác minh qua bảng `project_members`).
- **Lưu trữ chuẩn hóa**: Tất cả tọa độ và trạng thái UI đều được chuẩn hóa hoặc tuần tự hóa (JSON) để tránh mất độ chính xác trên các thiết bị khác nhau.
