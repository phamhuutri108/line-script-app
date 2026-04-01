# Tổng hợp Logic và Kế hoạch Dự án (all-sources-260401-R1)

Tài liệu này tổng hợp toàn bộ nội dung, ý tưởng và logic thực thi từ thư mục `logic_idea` để cung cấp cái nhìn tổng quan toàn diện cho hệ thống.

## 1. Cấu trúc Thư mục (File Tree)

```text
logic_idea/
├── admin/
│   └── admin_panel.md
├── auth/
│   ├── authentication.md
│   └── inviting_sharing.md
├── infrastructure/
│   └── database.md
├── project/
│   ├── dashboard.md
│   └── details.md
├── script_viewer/
│   ├── line_logic.md
│   ├── shotlist.md
│   └── viewer.md
└── users/
    └── settings.md
```

---

## 2. Nội dung Chi tiết

### 📂 Cơ sở hạ tầng (Infrastructure)

#### 📄 [database.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/infrastructure/database.md)
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

---

### 📂 Xác thực & Phân quyền (Auth)

#### 📄 [authentication.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/auth/authentication.md)
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

#### 📄 [inviting_sharing.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/auth/inviting_sharing.md)
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

---

### 📂 Quản lý Dự án (Project)

#### 📄 [dashboard.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/project/dashboard.md)
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

#### 📄 [details.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/project/details.md)
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

---

### 📂 Trình xem & Kẻ kịch bản (Script Viewer)

#### 📄 [viewer.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/script_viewer/viewer.md)
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

#### 📄 [line_logic.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/script_viewer/line_logic.md)
# Visual & UI Specification: Vertical Marker Lines (Straight & Zigzag)

Tài liệu này mô tả chi tiết các thuộc tính trực quan (visual properties) để render các thành phần của Line Tool trên UI (sử dụng DOM/SVG hoặc Canvas), giúp Claude hiểu rõ cả phần "nhìn" (Visual) và phần "chạm" (Hitbox).

---

## 1. Vòng tròn Active (Control Nodes / Handles)
Đây là các điểm neo (anchors) xuất hiện tại `startY` (Top Node) và `endY` (Bottom Node) **chỉ khi Line đang ở trạng thái `active`**.

* **Hình dáng (Shape):** Hình tròn (Circle).
* **Kích thước hiển thị (Visual Radius):** `r = 4px` hoặc `r = 5px`.
* **Viền (Stroke):** Dày `2px`, sử dụng màu nổi bật (Primary Color - ví dụ: Xanh dương `#007AFF` hoặc màu tương phản với văn bản).
* **Lõi (Fill):** Trắng tinh (`#FFFFFF`), tạo cảm giác "nổi" (hollow) cắt ngang đường line.
* **Vùng chạm thực tế (Hitbox Area):** Bán kính mở rộng `r = 12px` đến `16px`. Khu vực này hoàn toàn trong suốt (`opacity: 0` hoặc `rgba(0,0,0,0)`).
* **Tương tác (Cursor):** Khi chuột hover vào vùng Hitbox này, đổi cursor thành `ns-resize` (mũi tên hai chiều lên/xuống) báo hiệu có thể kéo kéo dãn/thu ngắn.

## 2. Nét đứt (Dashed Line) - Trạng thái `drawing` (Preview Mode)
Line nét đứt xuất hiện khi người dùng đã click điểm đầu tiên (`startY`) và đang di chuyển chuột để tìm điểm chốt (`endY`), hoặc ngược lại.

* **Kiểu nét (Stroke Style):** Nét đứt.
    * *Canvas:* `ctx.setLineDash([6, 4])` (đoạn gạch 6px, khoảng trống 4px).
    * *SVG/CSS:* `stroke-dasharray: 6 4`.
* **Độ dày (Stroke Width):** `1.5px` hoặc `2px`.
* **Màu sắc (Color):** Màu xám nhạt (`#A0A0A0`) hoặc màu Primary nhưng có độ mờ (`rgba(0, 122, 255, 0.5)`).
* **Đặc tả cho Zigzag:** Vẫn render path zigzag theo biên độ ngang (amplitude) đã định, nhưng nét vẽ chạy dọc theo path đó sẽ bị đứt quãng. Mục đích là để báo cho user: *"Đường này đang được vẽ, chưa được lưu vào script"*.

## 3. Nét liền (Solid Line) - Trạng thái `idle` và `active` (Committed Mode)
Áp dụng cho các Line đã được "chốt" vị trí (hoàn thành State Machine phần vẽ).

* **Kiểu nét (Stroke Style):** Nét liền liên tục (Solid).
    * *Canvas:* `ctx.setLineDash([])` (reset).
    * *SVG/CSS:* Bỏ thuộc tính `stroke-dasharray`.
* **Độ dày (Stroke Width):** `2px` (Đủ rõ ràng nhưng không quá dày làm che khuất nội dung text kịch bản bên dưới).
* **Màu sắc (Color):** Màu đen (`#222222`), xám đậm, hoặc hệ thống màu phân loại riêng của app.
* **Phân biệt giữa `idle` và `active`:**
    * **Khi `idle` (Bình thường):** Chỉ hiển thị nét liền. Ẩn hoàn toàn hai Vòng tròn Active. Hover vào thân line, cursor đổi thành `pointer` (bàn tay) báo hiệu có thể click để chọn.
    * **Khi `active` (Đang được chọn):** Vẫn hiển thị nét liền, nhưng có thể thêm một lớp bóng mờ (Drop Shadow hoặc Glow nhẹ) xung quanh thân line để làm nổi bật. Đồng thời, **kích hoạt hiển thị hai Vòng tròn Active** ở hai đầu mút.

---

## 4. Cấu trúc Render Layer (Z-Index / Stack Order)
Để đảm bảo trải nghiệm vẽ và kéo thả mượt mà, không bị che khuất:

1.  **Lớp dưới cùng (Z: 0):** Document / Text của kịch bản.
2.  **Lớp giữa (Z: 10):** Các đường Line nét liền ở trạng thái `idle` (chỉ hiển thị, chờ tương tác).
3.  **Lớp trên (Z: 20):** Đường Line đang ở trạng thái `active` hoặc `drawing` nét đứt. Việc đẩy line active lên trên cùng đảm bảo khi nhiều line bị đè lên nhau, line đang thao tác luôn rõ nhất.
4.  **Lớp trên cùng (Z: 30):** Vòng tròn Active (Node Handles) và Hitbox của chúng. Phải ở layer cao nhất để hứng trọn sự kiện `mousedown`/`touchstart`, ngăn chặn sự kiện lọt xuống làm click nhầm vào thân line hay background.

#### 📄 [shotlist.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/script_viewer/shotlist.md)
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

---

### 📂 Quản trị (Admin)

#### 📄 [admin_panel.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/admin/admin_panel.md)
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

---

### 📂 Người dùng (Users)

#### 📄 [settings.md](file:///Users/phamhuutri/Desktop/websites/app/line-script-app/logic_idea/users/settings.md)
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
