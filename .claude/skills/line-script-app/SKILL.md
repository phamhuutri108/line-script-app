---
name: line-script-app
description: >
  Master skill cho dự án Line Script App — web app làm phim dành cho Script Supervisor và đoàn phim độc lập.
  Dùng skill này cho BẤT KỲ tác vụ nào liên quan đến project này: viết code mới, sửa bug, thêm tính năng,
  thiết kế database, setup Cloudflare, cấu hình auth, xử lý PDF, vẽ line script, tạo shotlist, hay deploy.
  Trigger khi người dùng nhắc đến: line script, script lining, shotlist, kịch bản phim, PDF viewer,
  Fabric.js, Cloudflare Workers/D1/R2, Google Sheets sync, storyboard, Google Drive,
  hoặc bất kỳ phần nào của app này.
---

# Line Script App — Master Skill

## Tổng quan dự án

Web app chuyên dụng cho **Script Supervisor** và đoàn phim độc lập Việt Nam. Cho phép:
- Upload và xem kịch bản PDF
- Kẻ tuyến (Script Lining) chuẩn ngành trực tiếp lên PDF
- Tự động tạo Shotlist từ các đường kẻ tuyến (auto-extract text từ PDF)
- Quản lý nhiều dự án phim
- Làm việc nhóm với phân quyền Admin / Member

**Người dùng chính:** Đạo diễn, Script Supervisor, đoàn phim ~5 người.
**Thiết bị:** Desktop, iPad (Apple Pencil), iPhone, Android — tất cả qua trình duyệt (PWA).

---

## Tech Stack — ĐÃ CHỐT, KHÔNG THAY ĐỔI

| Layer | Công nghệ | Ghi chú |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | PWA enabled |
| PDF Viewer | PDF.js (Mozilla) | Render PDF lên canvas |
| Canvas / Drawing | Fabric.js | Vẽ line, annotation lên PDF |
| Apple Pencil | Pointer Events API | Qua Fabric.js, pressure-aware |
| Backend API | Cloudflare Workers (TypeScript) | Serverless |
| Database | Cloudflare D1 (SQLite) | Lưu users, projects, shots, annotations |
| File Storage | Cloudflare R2 | Lưu file PDF kịch bản |
| Auth | JWT tự build (bcrypt + jose) | Không dùng OAuth cho login |
| Hosting | Cloudflare Pages | Frontend deploy |
| Dev workflow | VS Code → GitHub → Cloudflare | Quy trình bất biến |
| Google Sheets Sync | Google Sheets API v4 | Sync shotlist 2 chiều (opt-in) |
| Storyboard Storage | Google Drive API v3 | Lưu ảnh storyboard, app chỉ dùng URL |

**Nguyên tắc quan trọng:**
- Ưu tiên công cụ **miễn phí hoàn toàn** — Cloudflare free tier đủ dùng cho team ~5 người
- KHÔNG dùng Supabase, Firebase, Vercel, hay bất kỳ service có thể bị pause/charge
- KHÔNG thêm dependency mới nếu không cần thiết — keep it lean
- Google Sheets/Drive là tính năng **opt-in** — user phải chủ động kết nối, không bắt buộc

---

## Kiến trúc hệ thống

```
┌─────────────────────────────────────────┐
│           Cloudflare Pages              │
│    React + Vite + TypeScript (PWA)      │
│  PDF.js viewer + Fabric.js canvas       │
└────────────────┬────────────────────────┘
                 │ fetch / REST API
┌────────────────▼────────────────────────┐
│         Cloudflare Workers              │
│       TypeScript API endpoints          │
│   Auth (JWT) + Business Logic           │
└──────┬───────────┬──────────────┬───────┘
       │           │              │
┌──────▼──────┐ ┌──▼──────┐ ┌────▼──────────────┐
│ Cloudflare  │ │Cloudflare│ │  Google APIs       │
│     D1      │ │    R2    │ │  (opt-in)          │
│  (Database) │ │  (PDFs)  │ │  Sheets API v4     │
└─────────────┘ └─────────┘ │  Drive API v3      │
                             └────────┬───────────┘
                                      │ Apps Script
                                      │ onEdit() webhook
                             ┌────────▼───────────┐
                             │  Google Sheets      │
                             │  (Shotlist sync)    │
                             │  Google Drive       │
                             │  (Storyboard imgs)  │
                             └────────────────────┘
```

---

## Database Schema (Cloudflare D1)

```sql
-- Users & Auth
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,         -- bcrypt
  name TEXT NOT NULL,
  role TEXT DEFAULT 'pending',         -- 'super_admin' | 'owner' | 'member' | 'pending'
  created_at INTEGER DEFAULT (unixepoch())
);
-- Lưu ý: 'super_admin' chỉ có 1 record duy nhất, tạo thủ công khi setup lần đầu

-- Invite tokens (trưởng nhóm mời qua email)
CREATE TABLE invite_tokens (
  token TEXT PRIMARY KEY,              -- UUID random
  project_id TEXT REFERENCES projects(id),
  created_by TEXT REFERENCES users(id), -- owner tạo invite
  email TEXT,                          -- email được mời (nullable — có thể invite chung)
  used_by TEXT REFERENCES users(id),   -- ai đã dùng token này
  expires_at INTEGER NOT NULL,         -- unixepoch + 7 ngày
  created_at INTEGER DEFAULT (unixepoch())
);

-- Dự án phim
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Thành viên trong dự án
CREATE TABLE project_members (
  project_id TEXT REFERENCES projects(id),
  user_id TEXT REFERENCES users(id),
  PRIMARY KEY (project_id, user_id)
);

-- File kịch bản PDF
CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,                -- path trong R2 bucket
  page_count INTEGER,
  uploaded_by TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Đường kẻ tuyến (Script Lines)
CREATE TABLE script_lines (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id),
  user_id TEXT REFERENCES users(id),
  page_number INTEGER NOT NULL,
  line_type TEXT NOT NULL,             -- 'solid' | 'dashed'
  x_position REAL NOT NULL,           -- % của chiều rộng trang
  y_start REAL NOT NULL,              -- % từ đầu trang
  y_end REAL NOT NULL,                -- % từ đầu trang
  color TEXT DEFAULT '#000000',
  setup_number INTEGER,               -- số setup
  created_at INTEGER DEFAULT (unixepoch())
);

-- Annotations (highlight, note)
CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id),
  user_id TEXT REFERENCES users(id),
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL,                  -- 'highlight' | 'note' | 'drawing'
  fabric_json TEXT NOT NULL,           -- Fabric.js object serialized
  created_at INTEGER DEFAULT (unixepoch())
);

-- Shots (Shotlist)
CREATE TABLE shots (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id),
  line_id TEXT REFERENCES script_lines(id),  -- shot gắn với line nào
  user_id TEXT REFERENCES users(id),
  shot_number INTEGER NOT NULL,
  scene_number TEXT,                   -- auto-extracted từ PDF
  location TEXT,                       -- auto-extracted
  int_ext TEXT,                        -- 'INT' | 'EXT' | auto-extracted
  day_night TEXT,                      -- 'DAY' | 'NIGHT' | auto-extracted
  description TEXT,                    -- auto-extracted từ text đường line đi qua
  dialogue TEXT,                       -- auto-extracted dialogue text
  shot_size TEXT,                      -- WS, MS, CU, ECU... (nhập tay)
  angle TEXT,                          -- Eye level, Low, High... (nhập tay)
  movement TEXT,                       -- Static, Pan, Dolly... (nhập tay)
  lens TEXT,                           -- 24mm, 50mm... (nhập tay)
  notes TEXT,
  storyboard_drive_id TEXT,            -- Google Drive file ID của ảnh storyboard (nullable)
  sheets_row_index INTEGER,            -- Số hàng trong Google Sheets tương ứng (nullable)
  updated_at INTEGER DEFAULT (unixepoch()),
  created_at INTEGER DEFAULT (unixepoch())
);

-- Google OAuth tokens (cho Sheets/Drive integration)
-- Mỗi USER tự kết nối Google account của chính họ
-- Storyboard lưu trên Drive của từng user — tốn quota của họ, không phải admin
CREATE TABLE google_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  access_token TEXT NOT NULL,          -- short-lived, tự refresh
  refresh_token TEXT NOT NULL,         -- long-lived, lưu mã hóa
  expiry INTEGER NOT NULL,             -- unix timestamp hết hạn access_token
  sheets_id TEXT,                      -- Spreadsheet ID đang được link (chỉ admin cần)
  drive_folder_id TEXT,                -- Folder ID trên Drive CỦA USER để lưu storyboard
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Storyboard: lưu view URL thay vì chỉ file ID
-- Vì ảnh nằm trên Drive của nhiều user khác nhau
ALTER TABLE shots ADD COLUMN storyboard_view_url TEXT;
-- storyboard_drive_id: file ID (để owner có thể xóa)
-- storyboard_view_url: public "anyone with link" URL để admin/ai cũng xem được
```

---

## Phân quyền

Có 4 role, theo thứ tự quyền từ cao xuống thấp:

| Role | Tên gọi | Quyền |
|---|---|---|
| `super_admin` | Quản trị web (bạn) | Toàn quyền hệ thống. Xem data tất cả mọi người. Duyệt/từ chối tài khoản pending. Xem layer chồng nhau trên PDF. |
| `owner` | Trưởng nhóm | Tạo và quản lý project của mình. Mời member qua email (invite link). Tạo sẵn account cho member. Chỉ xem data của chính mình. |
| `member` | Thành viên | Chỉ xem và chỉnh sửa data của chính mình. Tham gia project được mời. |
| `pending` | Chờ duyệt | Đã tự đăng ký, chờ `super_admin` duyệt. Không vào được app. |

**Quy tắc quan trọng:**
- `super_admin` là duy nhất — chỉ có 1 tài khoản, hardcode trong DB khi setup lần đầu
- Người được **mời qua invite link** → bypass `pending`, tự động thành `member` khi tạo account
- Người **tự đăng ký** (không có invite link) → vào `pending`, chờ `super_admin` duyệt
- `owner` KHÔNG thấy data của members trong project của họ — chỉ thấy của chính mình

**Super Admin view đặc biệt:**
- Xem data từng người riêng lẻ (chọn user → thấy toàn bộ annotations + lines của họ)
- Xem layer chồng nhau: mở 1 file PDF, thấy annotations của tất cả mọi người cùng lúc
- Quản lý toàn bộ users, projects của mọi người

**Invite flow (ưu tiên — trưởng nhóm không rành công nghệ):**
```
Owner gửi invite link qua email
        ↓
Người nhận click link → trang đăng ký với email pre-filled
        ↓
Điền tên + password → tạo account
        ↓
Tự động status = 'member', tự động join project đó
        ↓
Không cần super_admin duyệt
```

**Invite link format:** `https://app.com/invite/{token}` — token lưu trong DB, expire sau 7 ngày.

---

## Tính năng chi tiết

### 1. Auth & User Management

**Đăng ký thông thường (không có invite):**
- Trang đăng ký: email + password + tên → status `pending`
- Trang "Chờ duyệt": hiện thông báo chờ super_admin duyệt
- Super Admin dashboard: danh sách pending → Duyệt / Từ chối / Đổi role thành `owner`

**Đăng ký qua invite link (ưu tiên):**
- Owner gửi invite: nhập email → hệ thống gửi email kèm link `https://app.com/invite/{token}`
- Người nhận click link → trang đăng ký với email pre-filled, token ẩn trong URL
- Tạo account → tự động `member`, tự động join project → vào app luôn, không cần duyệt
- Token expire sau 7 ngày, dùng 1 lần

**Owner tạo sẵn account:**
- Owner nhập email + tên → hệ thống tạo password ngẫu nhiên → gửi email cho member
- Member đăng nhập bằng password tạm → được nhắc đổi password ngay

**Super Admin panel:**
- Xem toàn bộ users, projects, dung lượng
- Duyệt/từ chối pending users
- Đổi role bất kỳ user (member ↔ owner)
- Xem data của bất kỳ user trên bất kỳ project

**Owner panel (trong project của họ):**
- Quản lý members: mời qua email, tạo sẵn account, kick member
- Không thấy data (annotations, lines, shots) của members khác

### 2. Project Management
- CRUD dự án phim
- Mỗi dự án có danh sách members
- Upload nhiều file PDF kịch bản vào một dự án

### 3. PDF Viewer
- Render PDF bằng PDF.js lên `<canvas>`
- Fabric.js overlay canvas lên trên PDF canvas để vẽ
- Navigation: lật trang, zoom in/out, fit-to-screen
- Mobile/iPad: touch pan, pinch-to-zoom
- Responsive cho mọi kích thước màn hình

### 4. Script Lining (Kẻ tuyến) — CORE FEATURE
- Vẽ đường thẳng dọc bằng Apple Pencil / touch / chuột
- Hai loại nét:
  - **Nét liền (solid)**: single coverage — 1 góc máy quay cảnh đó
  - **Nét đứt (dashed)**: multiple coverage — nhiều góc máy quay cùng cảnh
- Chọn màu cho từng line
- Đánh số setup tự động
- Gắn nhãn cảnh (scene label)
- Xóa, undo/redo
- Lưu tự động vào D1 theo từng trang

**Apple Pencil implementation:**
```typescript
// Dùng Pointer Events API — KHÔNG dùng mouse events
canvas.on('mouse:down', (opt) => {
  const e = opt.e as PointerEvent;
  if (e.pointerType === 'pen') {
    // Apple Pencil — có thể dùng e.pressure để vẽ nét đậm/nhạt
  }
});
```

### 5. Annotations (Ghi chú / Tô sáng)
- Highlight text trên kịch bản (màu vàng mặc định, đổi màu được)
- Text note: click vào trang → thêm sticky note
- Freehand drawing
- Tất cả serialize bằng `fabric.toJSON()` lưu vào D1

### 6. Shotlist — AUTO-GENERATION
Đây là tính năng quan trọng nhất sau Script Lining.

**Flow khi người dùng vẽ 1 đường line:**
1. Ghi nhận `x_position`, `y_start`, `y_end`, `page_number`
2. Dùng PDF.js `page.getTextContent()` để extract toàn bộ text items trên trang
3. Filter các text items có `transform[5]` (y coordinate) nằm trong range `[y_start, y_end]`
4. Detect scene header (thường là ALL CAPS, format `INT./EXT. LOCATION - DAY/NIGHT`)
5. Tách dialogue (text nằm ở cột giữa trong screenplay format)
6. Tạo shot entry với các field auto-filled

**Text extraction pattern:**
```typescript
async function extractTextForLine(
  page: PDFPageProxy,
  yStart: number,  // normalized 0-1
  yEnd: number,    // normalized 0-1
  xPosition: number // normalized 0-1
): Promise<{ sceneHeader: string | null, description: string, dialogue: string }> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });

  const itemsInRange = textContent.items.filter((item: any) => {
    const yNorm = 1 - (item.transform[5] / viewport.height); // flip y axis
    return yNorm >= yStart && yNorm <= yEnd;
  });

  // Scene header detection: ALL CAPS + starts with INT/EXT
  const sceneHeader = itemsInRange.find((item: any) =>
    /^(INT\.|EXT\.|INT\/EXT)/.test(item.str.trim())
  );

  // Dialogue: text in center column (x: 25%-75% of page width)
  const dialogue = itemsInRange
    .filter((item: any) => {
      const xNorm = item.transform[4] / viewport.width;
      return xNorm > 0.25 && xNorm < 0.75;
    })
    .map((item: any) => item.str)
    .join(' ');

  return { sceneHeader: sceneHeader?.str || null, description: ..., dialogue };
}
```

**Shotlist view:**
- Tab riêng trong app
- Hiển thị tất cả shots của file kịch bản đang mở
- Click vào shot → highlight line tương ứng trên PDF
- Inline edit tất cả fields
- Shot Size / Angle / Movement / Lens: dropdown + free text

**Export options:**
- Excel (.xlsx): dùng `xlsx` library (SheetJS)
- CSV: native export
- PDF: dùng `jsPDF` hoặc print CSS
- Share link: tạo public token → URL không cần đăng nhập

---

### 7. Google Sheets Sync (Opt-in)

Tính năng này **không bắt buộc** — user phải chủ động bật trong Settings. Khi đã kết nối, shotlist trong app và một Google Sheet cụ thể sẽ luôn đồng bộ 2 chiều.

**Setup flow (một lần duy nhất):**
1. User vào Settings → "Kết nối Google Drive"
2. Google OAuth popup → user đồng ý cấp quyền `spreadsheets` + `drive`
3. App tạo 1 Spreadsheet mới trong Google Drive của user (hoặc user chọn file có sẵn)
4. App tạo Apps Script webhook tự động gắn vào Spreadsheet đó
5. Lưu `spreadsheet_id`, `drive_folder_id`, `refresh_token` vào bảng `google_tokens`

**App → Sheets (mỗi khi shot thay đổi):**
```typescript
// Cloudflare Worker gọi Sheets API sau khi update D1
async function syncShotToSheets(shot: Shot, token: GoogleToken) {
  const rowIndex = shot.sheets_row_index ?? await appendNewRow(token.sheets_id);
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${token.sheets_id}/values/Sheet1!A${rowIndex}:N${rowIndex}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token.access_token}` },
    body: JSON.stringify({
      values: [[
        shot.shot_number, shot.scene_number, shot.location,
        shot.int_ext, shot.day_night, shot.description,
        shot.dialogue, shot.shot_size, shot.angle,
        shot.movement, shot.lens, shot.notes,
        shot.storyboard_drive_id
          ? `=IMAGE("https://drive.google.com/uc?export=view&id=${shot.storyboard_drive_id}")`
          : ''
      ]]
    })
  });
}
```

**Sheets → App (khi user sửa trực tiếp trên Sheets):**

Apps Script được tự động inject vào Spreadsheet khi user kết nối:
```javascript
// Apps Script (tự động tạo khi user kết nối)
function onEdit(e) {
  const row = e.range.getRow();
  const sheet = e.source.getActiveSheet();
  const values = sheet.getRange(row, 1, 1, 13).getValues()[0];

  UrlFetchApp.fetch('https://line-script-workers.workers.dev/webhook/sheets', {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({
      secret: 'WEBHOOK_SECRET',   // hardcoded khi tạo script
      rowIndex: row,
      data: {
        shot_number: values[0], scene_number: values[1],
        location: values[2], int_ext: values[3],
        day_night: values[4], description: values[5],
        dialogue: values[6], shot_size: values[7],
        angle: values[8], movement: values[9],
        lens: values[10], notes: values[11]
      }
    })
  });
}
```

Cloudflare Worker nhận webhook → verify secret → update D1 → app fetch lại data.

**Cột Storyboard trong Sheets:** Hiển thị ảnh trực tiếp trong cell bằng công thức `=IMAGE(...)`. Ảnh thật nằm trên Google Drive, Sheets chỉ render từ URL — không tốn dung lượng Sheets.

---

### 8. Storyboard

**Nguyên tắc lưu trữ:**
- Ảnh storyboard lưu trên **Google Drive của từng thành viên** — tốn quota của họ, không phải admin
- File được set quyền **"anyone with link can view"** ngay sau khi upload
- App và admin chỉ cần URL công khai đó để hiển thị — không cần có Drive, không cần OAuth
- Admin xem được ảnh của tất cả members qua URL mà không cần kết nối gì thêm

**Upload flow (member):**
1. Member vào Settings → "Kết nối Google Drive của tôi" (OAuth một lần)
2. Lần upload đầu: app tạo folder `Line Script - [Tên dự án]` trong Drive của member
3. Member click "Upload Storyboard" trên shot
4. File ảnh upload lên Drive của member (dùng token của member đó)
5. Drive API set permission: `type: 'anyone', role: 'reader'` → file public
6. Lưu vào D1: `storyboard_drive_id` (để member xóa được sau này) + `storyboard_view_url`
7. Sheets tự cập nhật ô storyboard bằng `=IMAGE(storyboard_view_url)`

**Drive API: set file public sau khi upload:**
```typescript
// Cloudflare Worker — dùng token của member (không phải admin)
async function makeFilePublic(fileId: string, memberToken: string) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${memberToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader' })
  });

  // Lấy webContentLink để hiển thị
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink,webContentLink`,
    { headers: { Authorization: `Bearer ${memberToken}` } }
  );
  const { webContentLink } = await res.json();
  return webContentLink; // URL dạng: https://drive.google.com/uc?export=view&id=...
}
```

**Hiển thị trong app (không cần auth — URL đã public):**
```typescript
// Admin và bất kỳ ai có URL đều xem được — không cần token
<img
  src={shot.storyboard_view_url}
  loading="lazy"
  className="storyboard-thumbnail"
/>
```

**Xóa storyboard:**
- Chỉ member owner mới xóa được (dùng `storyboard_drive_id` + token của họ)
- Admin xóa entry trong D1 nhưng không xóa file trên Drive (không có token của member)

**Lưu ý:**
- Member chưa kết nối Drive → nút "Upload Storyboard" disabled, tooltip "Kết nối Google Drive để dùng tính năng này"
- Admin không cần kết nối Drive để xem storyboard — chỉ cần URL
- Admin kết nối Drive riêng nếu muốn dùng tính năng Sheets sync

---

## Cấu trúc thư mục project

```
line-script-app/
├── frontend/                    # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/            # Login, Register, Pending
│   │   │   ├── admin/           # Admin dashboard, user approval
│   │   │   ├── project/         # Project list, project detail
│   │   │   ├── viewer/          # PDF viewer + canvas overlay
│   │   │   │   ├── PDFViewer.tsx
│   │   │   │   ├── ScriptCanvas.tsx   # Fabric.js layer
│   │   │   │   └── LineToolbar.tsx    # Tools: line type, color, etc
│   │   │   ├── shotlist/        # Shotlist table + export
│   │   │   └── settings/        # Google Drive/Sheets connect UI
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── usePDF.ts
│   │   │   ├── useShotlist.ts
│   │   │   └── useGoogleSync.ts # Google Sheets sync state
│   │   ├── stores/              # Zustand state management
│   │   └── api/                 # API client (fetch wrappers)
│   ├── public/
│   │   └── manifest.json        # PWA manifest
│   └── vite.config.ts
│
├── workers/                     # Cloudflare Workers
│   ├── src/
│   │   ├── index.ts             # Router
│   │   ├── routes/
│   │   │   ├── auth.ts          # /auth/login, /auth/register
│   │   │   ├── users.ts         # /users (admin only)
│   │   │   ├── projects.ts      # /projects CRUD
│   │   │   ├── scripts.ts       # /scripts upload, list
│   │   │   ├── lines.ts         # /lines CRUD
│   │   │   ├── annotations.ts   # /annotations CRUD
│   │   │   ├── shots.ts         # /shots CRUD + export
│   │   │   ├── google.ts        # /google/auth-url, /callback, /sheets/setup
│   │   │   ├── webhook.ts       # /webhook/sheets (nhận từ Apps Script)
│   │   │   └── storyboard.ts    # /storyboard/upload, delete
│   │   └── middleware/
│   │       ├── auth.ts          # JWT verify middleware
│   │       └── cors.ts
│   └── wrangler.toml
│
└── .claude/
    └── skills/
        └── line-script-app/
            └── SKILL.md         # File này
```

---

## API Endpoints

```
POST   /auth/register          Body: { email, name, password }
POST   /auth/login             Body: { email, password } → { token }

GET    /users                  Super Admin: list all users
PATCH  /users/:id/approve      Super Admin: approve pending user
PATCH  /users/:id/role         Super Admin: change role (member/owner)
DELETE /users/:id              Super Admin: delete user

POST   /invite                 Owner: tạo invite token, gửi email
GET    /invite/:token          Validate token, trả về project info + pre-filled email
POST   /invite/:token/accept   Tạo account từ invite → bypass pending → join project
POST   /users/create-for-member  Owner: tạo sẵn account, gửi email password tạm

GET    /projects               List my projects (admin: all)
POST   /projects               Create project
GET    /projects/:id           Project detail + members
POST   /projects/:id/members   Add member

GET    /scripts?projectId=     List scripts in project
POST   /scripts/upload         Upload PDF → R2, save metadata
GET    /scripts/:id/pdf        Stream PDF từ R2
DELETE /scripts/:id

GET    /lines?scriptId=&page=  Get lines for a page
POST   /lines                  Save new line
DELETE /lines/:id

GET    /annotations?scriptId=&page=&userId=
POST   /annotations
PUT    /annotations/:id
DELETE /annotations/:id

GET    /shots?scriptId=        Get all shots for script
POST   /shots                  Create shot (usually auto from line)
PUT    /shots/:id              Update shot fields
DELETE /shots/:id
GET    /shots/:scriptId/export?format=xlsx|csv|pdf
GET    /shots/:scriptId/share  Create public share token
GET    /share/:token           Public shotlist view

# Google Integration (opt-in)
GET    /google/auth-url        Lấy URL để bắt đầu OAuth flow
GET    /google/callback        OAuth callback — lưu tokens
GET    /google/status          Kiểm tra đã kết nối chưa, sheet ID là gì
DELETE /google/disconnect      Xóa token, ngắt kết nối

POST   /google/sheets/setup    Tạo Spreadsheet mới + inject Apps Script webhook
POST   /google/sheets/sync-all Sync toàn bộ shots của 1 script lên Sheets (lần đầu)
POST   /webhook/sheets         Nhận webhook từ Apps Script (Sheets → App)

POST   /storyboard/upload      Upload ảnh lên Google Drive, trả về drive_file_id
DELETE /storyboard/:shotId     Xóa ảnh trên Drive + xóa drive_file_id trong D1
```

---

## Quy trình deploy

```bash
# 1. Dev local
cd frontend && npm run dev
cd workers && wrangler dev

# 2. Deploy Workers
cd workers
wrangler deploy

# 3. Deploy Frontend (Cloudflare Pages)
git add . && git commit -m "..."
git push origin main
# Cloudflare Pages tự build và deploy từ GitHub

# 4. Migrations D1
wrangler d1 migrations apply line-script-db
```

**wrangler.toml cấu hình cần thiết:**
```toml
name = "line-script-workers"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "line-script-db"
database_id = "..."

[[r2_buckets]]
binding = "SCRIPTS_BUCKET"
bucket_name = "line-script-pdfs"
```

---

## Conventions & Rules

1. **TypeScript strict mode** — không dùng `any` trừ khi thật sự cần (PDF.js types)
2. **Error handling** — mọi API call phải có try/catch, trả về `{ error: string }` khi lỗi
3. **Auth guard** — mọi route trong Workers phải verify JWT trước, trừ `/auth/*`
4. **Pending guard** — frontend redirect về `/pending` nếu user role là `pending`
5. **Mobile first** — CSS bắt đầu từ mobile, dùng media query lên desktop
6. **Fabric.js save** — sau mỗi thao tác vẽ, debounce 500ms rồi auto-save lên API
7. **PDF coordinates** — luôn normalize về 0-1 (% của width/height) khi lưu vào DB, không lưu pixel tuyệt đối
8. **R2 keys** — format: `{userId}/{projectId}/{scriptId}/{filename}.pdf`
9. **Google token refresh** — trước mỗi lần gọi Sheets/Drive API, kiểm tra `expiry`. Nếu còn < 5 phút thì refresh token trước, cập nhật D1
10. **Webhook secret** — `WEBHOOK_SECRET` lưu trong Cloudflare Workers Secrets (không hardcode), inject vào Apps Script khi setup
11. **Storyboard display** — dùng `loading="lazy"` cho tất cả ảnh storyboard, không preload
12. **Sheets sync là best-effort** — nếu Sheets API lỗi, vẫn lưu vào D1 trước, log lỗi, không block user

---

## Trạng thái hiện tại

- [ ] Project chưa được khởi tạo
- [ ] Đây là file skill được tạo sau buổi thảo luận tính năng ban đầu
- [ ] Bước tiếp theo: khởi tạo project với `npm create vite@latest frontend -- --template react-ts`

---

## Lưu ý quan trọng khi làm việc

- **Luôn hỏi trước khi generate code lớn** — confirm với người dùng trước khi viết một module mới
- **Ưu tiên free tier** — nếu cần thêm service, kiểm tra free tier trước và hỏi người dùng
- **Người dùng là filmmaker độc lập** — giải thích kỹ thuật bằng ngôn ngữ đơn giản, dùng ví dụ liên quan đến phim
- **Ngôn ngữ giao diện app:** Tiếng Việt (chưa chốt — cần hỏi lại)
