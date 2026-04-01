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