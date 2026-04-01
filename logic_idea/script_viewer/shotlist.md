# Logic Danh sách Cảnh quay (Shotlist)

## Các Tính năng Hiện tại
- **Chế độ xem Bảng/Thẻ**: Xem các cảnh quay và cảnh được trích xuất từ trình xem kịch bản.
- **Khả năng Xuất**: Sử dụng `xlsx`, `jspdf` để xuất dữ liệu ra Excel hoặc PDF.
- **Quản lý Siêu dữ liệu**: Chỉnh sửa trực tiếp các chi tiết cảnh quay.

## Logic Thực thi
### Liệt kê Cảnh quay (List Shots)
- **Kiểm soát Truy cập**: Người dùng phải là thành viên của dự án.
- **Sắp xếp**: Luôn được sắp xếp theo `shot_number` tăng dần.
- **Trạng thái Đồng bộ**: Phản ánh trạng thái hiện tại được lưu trong D1, có thể được đồng bộ với Google Sheets.

### Xuất dữ liệu (Exporting)
- **Xuất CSV**: Máy chủ tạo ra một chuỗi CSV với các ký tự thoát (escaping) phù hợp cho dấu phẩy và dấu ngoặc kép, cung cấp file tải về thông qua `Response`.
- **Chia sẻ**: Cho phép tạo một `share_token` để tạo ra một URL công khai (`/share/:token`).
  - Bất kỳ ai có token đều có thể xem danh sách shot cho kịch bản đó trong một giao diện xem đơn giản (chỉ đọc).
