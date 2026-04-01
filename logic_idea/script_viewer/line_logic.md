# Visual, UI & Performance Specification: Vertical Marker Lines

Tài liệu này mô tả chi tiết các thuộc tính trực quan (visual properties), logic trạng thái (state machine) và tối ưu hiệu suất để render các thành phần của Line Tool (sử dụng DOM/SVG/Canvas) trong Script Lining App.

---

## 1. Logic Quản lý Trạng thái & Tối ưu Hiệu suất (State & Performance)
Để khắc phục tình trạng giật lag và đảm bảo trải nghiệm tương tác mượt mà giống phần mềm chuyên dụng (chuẩn 60 FPS):

* **Single Active State:** Tại một thời điểm, chỉ có tối đa 1 Line được phép ở trạng thái `active`. Khi người dùng click vào thân Line A, bật cờ `isActive = true` cho Line A, đồng thời set `isActive = false` cho toàn bộ các line khác trên màn hình.
* **Tối ưu Kéo thả (Drag Performance):** Khi user nắm Node (vòng tròn) để kéo dãn/thu ngắn chiều dọc (`mousemove`), **tuyệt đối không** cập nhật Global State (như Redux, Zustand, Context) liên tục vì sẽ gây re-render toàn bộ script document làm tụt FPS trầm trọng. 
    * *Giải pháp:* Sử dụng Local State hoặc can thiệp trực tiếp vào thuộc tính DOM (thông qua `useRef` đổi `height` hoặc `transform`).
    * Chỉ khi user nhả chuột (`mouseup` - kết thúc hành động kéo), app mới dispatch action lưu lại tọa độ `startY` / `endY` mới vào Database hoặc Global State.

## 2. Vòng tròn Active (Control Nodes / Handles)
Đây là các điểm neo (anchors) xuất hiện tại `startY` (Top Node) và `endY` (Bottom Node) **chỉ khi Line đang ở trạng thái `active`**.

* **Hình dáng (Shape):** Hình tròn (Circle).
* **Kích thước hiển thị (Visual Radius):** `r = 4px` hoặc `r = 5px`.
* **Viền (Stroke):** Dày `2px`, sử dụng màu nổi bật đồng nhất với màu line.
* **Lõi (Fill):** Trắng tinh (`#FFFFFF`), tạo cảm giác "nổi" (hollow) cắt ngang đường line.
* **Vùng chạm thực tế (Hitbox Area):** Bán kính mở rộng `r = 12px` đến `16px`. Khu vực bọc ngoài này hoàn toàn trong suốt (`opacity: 0` hoặc `rgba(0,0,0,0)`).
* **Tương tác (Cursor):** Khi chuột hover vào vùng Hitbox này, đổi cursor thành `ns-resize` (mũi tên hai chiều lên/xuống) báo hiệu có thể kéo dọc.

## 3. Hiển thị Nhãn (Label: Type & Movement) - Góc nghiêng bám theo Line
Thay vì sử dụng các ô vuông (boxes) rời rạc cạnh nhau gây rối mắt và không chuẩn xác với cách ghi kịch bản truyền thống, cụm nhãn sẽ được render bám sát theo thân dọc của line.

* **Cấu trúc Nhãn (Label Group):** Gồm một khung vòng ô-van (Oval Box) chứa **Shot ID** (VD: `8K`, `8CC`), và một chuỗi văn bản liền mạch kết hợp **Type + Movement** (VD: `CU Tracking`).
* **Logic hiển thị Type & Movement:**
    * Bỏ hoàn toàn box bọc ngoài của Type và Movement.
    * Gộp giá trị `{Type}` và `{Movement}` thành một Text String. Đặt vị trí (anchor) ngay phía trên của Shot ID box.
* **Đặc tả CSS / Styling cho Angled Text:**
    * `position: absolute;` (hoặc định vị tương đối trên SVG).
    * `transform-origin: bottom left;` (Lấy góc dưới bên trái của chữ làm tâm xoay).
    * `transform: rotate(-70deg) translateY(-4px);` (Góc xoay nghiêng hướng lên dọc theo thân line, dùng `translateY` đẩy nhẹ ra để text không đè trực tiếp lên nét vẽ).
    * **Typography:** Chữ có màu đồng nhất với màu của đường line, `font-size: 12px - 14px`, `font-weight: normal` (không in đậm để phân biệt rạch ròi với Shot ID đang được in đậm/khoanh viền).
    * `overflow: visible;` trên các thẻ cha để đảm bảo chữ chéo không bị cắt xén (clip).

## 4. Nét đứt (Dashed Line) - Trạng thái `drawing` (Preview Mode)
Line nét đứt xuất hiện khi người dùng đã click điểm đầu tiên (`startY`) và đang di chuyển chuột để tìm điểm chốt (`endY`), hoặc ngược lại.

* **Kiểu nét (Stroke Style):** Nét đứt.
    * *Canvas:* `ctx.setLineDash([6, 4])` (đoạn gạch 6px, khoảng trống 4px).
    * *SVG/CSS:* `stroke-dasharray: 6 4`.
* **Độ dày (Stroke Width):** `1.5px` hoặc `2px`.
* **Màu sắc (Color):** Màu xám nhạt (`#A0A0A0`) hoặc màu line nhưng có độ mờ (opacity `0.5`).
* **Đặc tả cho Zigzag:** Vẫn render path zigzag theo biên độ ngang (amplitude) đã định, nhưng nét vẽ chạy dọc theo path đó sẽ bị đứt quãng. Báo hiệu trực quan: *"Đường này đang được vẽ, chưa được chốt"*.

## 5. Nét liền (Solid Line) - Trạng thái `idle` và `active` (Committed Mode)
Áp dụng cho các Line đã được "chốt" vị trí.

* **Kiểu nét:** Nét liền liên tục (Solid). Bỏ thuộc tính nét đứt.
* **Độ dày:** `2px` (Đủ rõ ràng nhưng không quá dày làm che khuất nội dung text kịch bản bên dưới).
* **Màu sắc:** Phân loại theo setting của ứng dụng (VD: Xanh, Đỏ).
* **Phân biệt tương tác:**
    * **Khi `idle`:** Ẩn hoàn toàn hai Vòng tròn Active. Hover vào hitbox của thân line (mở rộng đệm tàng hình `~15px`), cursor đổi thành `pointer` (bàn tay) báo hiệu có thể click chọn.
    * **Khi `active`:** Hiển thị 2 vòng tròn handle ở 2 đầu. Có thể thêm drop-shadow mờ cho thân line để nổi bật giữa đám đông.

## 6. Cấu trúc Render Layer (Z-Index / Stack Order)
Hệ thống Z-Index phân cấp chặt chẽ để chống đè sự kiện:
1.  **Lớp dưới cùng (Z: 0):** Document / Text nội dung kịch bản.
2.  **Lớp giữa (Z: 10):** Các đường Line nét liền ở trạng thái `idle`.
3.  **Lớp trên (Z: 20):** Đường Line đang `active` hoặc nét đứt `drawing`. Đảm bảo line đang thao tác nổi lên trên các line khác.
4.  **Lớp trên cùng (Z: 30):** Vòng tròn Active (Handles) + Cụm Label text chéo. Phải hứng trọn sự kiện `mousedown`/`touchstart`, nếu user click vào handle thì chặn sự kiện lây lan (`stopPropagation`) để không click nhầm vào text hay background.