# Logic Trình xem Kịch bản (Script Viewer)

## Các Tính năng Hiện tại
- **Xem PDF**: Hiển thị PDF kịch bản trực tiếp trong trình xem chuyên dụng sử dụng thư viện `pdfjs-dist`.
- **Vẽ đường Line và Chú thích**: Khả năng vẽ các đường line và thêm chú thích trên các trang kịch bản (kẻ kịch bản - script lining).
- **Trích xuất Cảnh và Cảnh quay (Scenes & Shots)**: Ghi lại các số cảnh quay và số cảnh cụ thể liên kết với các đường line trên kịch bản.
- **Xuất/Lưu trạng thái**: Lưu trữ các chú thích, đường kẻ, cảnh quay và cảnh vào cơ sở dữ liệu.

## Logic Thực thi
### Quản lý Kịch bản
- **Lưu trữ PDF**: Các file tải lên được lưu trữ trong Cloudflare R2 bucket (`SCRIPTS_BUCKET`).
- **Phát trực tiếp (Streaming)**: File được cung cấp từ R2 với các header `Content-Type: application/pdf` và `Content-Disposition: inline`. Quyền truy cập bị giới hạn cho các thành viên dự án.

### Kẻ kịch bản (Script Lines)
- **Chuẩn hóa (Normalization)**: Tọa độ (x, yStart, yEnd) được lưu trữ dưới dạng giá trị chuẩn hóa (từ 0 đến 1) để đảm bảo chúng hiển thị chính xác bất kể mức độ thu phóng hoặc kích thước màn hình.
- **Các phân đoạn (Segments)**: `segments_json` lưu trữ đường dẫn chính xác của đường line được vẽ trên canvas.
- **Logic nối tiếp**: Tự động phát hiện nếu một đường line là sự tiếp nối từ trang trước bằng cách kiểm tra các đường line ở vị trí X tương tự trên trang trước có cờ `continues_to_next_page`.
- **Xem thêm chi tiết thiết kế**: Thông số chi tiết về render, nét đứt/nét liền, và các điểm neo (handles) có trong file [line_logic.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/script_viewer/line_logic.md).

### Chú thích (Annotations)
- **Các loại**: Hỗ trợ `highlight` (tô đậm), `note` (ghi chú), và `drawing` (vẽ tay).
- **Lưu trữ**: Sử dụng `fabric_json` để lưu trữ trạng thái đối tượng Fabric.js thô.
- **Cách biệt**: Các chú thích được liên kết với cả `script_id` và `user_id`, cho phép tạo các lớp chú thích cá nhân hoặc chia sẻ.

### Cảnh quay & Đồng bộ (Shots & Sync)
- **Trích xuất Shot**: Liên kết một `line_id` với một bản ghi shot.
- **Tự động đồng bộ (Google Sheets)**: Khi một shot được tạo hoặc cập nhật, một tác vụ chạy ngầm (`ctx.waitUntil`) sẽ kích hoạt hàm `autoSync`.
  - Nó lấy token Google hợp lệ cho người dùng.
  - Nó đẩy dữ liệu danh sách shot (cảnh, địa điểm, mô tả, v.v.) lên một Google Sheet (`sheets_id`) cụ thể được liên kết với kịch bản.
  - Xóa các hàng hiện có (A5:R1000) trước khi đẩy dữ liệu mới.
