---
name: line-script-app
description: >
  Master skill cho dự án Line Script App — web app làm phim dành cho Script Supervisor và đoàn phim độc lập.
  Dùng skill này cho BẤT KỲ tác vụ nào liên quan đến project này: viết code mới, sửa bug, thêm tính năng,
  thiết kế database, setup Cloudflare, cấu hình auth, xử lý PDF, vẽ line script, tạo shotlist, hay deploy.
  Trigger khi người dùng nhắc đến: line script, script lining, shotlist, kịch bản phim, PDF viewer,
  Fabric.js, Cloudflare Workers/D1/R2, hoặc bất kỳ phần nào của app này.
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
| Auth | JWT tự build (bcrypt + jose) | Không dùng OAuth |
| Hosting | Cloudflare Pages | Frontend deploy |
| Dev workflow | VS Code → GitHub → Cloudflare | Quy trình bất biến |

**Nguyên tắc quan trọng:**
- Ưu tiên công cụ **miễn phí hoàn toàn** — Cloudflare free tier đủ dùng cho team ~5 người
- KHÔNG dùng Supabase, Firebase, Vercel, hay bất kỳ service có thể bị pause/charge
- KHÔNG thêm dependency mới nếu không cần thiết — keep it lean

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
└──────┬──────────────────┬───────────────┘
       │                  │
┌──────▼──────┐    ┌──────▼──────┐
│ Cloudflare  │    │ Cloudflare  │
│     D1      │    │     R2      │
│  (Database) │    │  (PDFs)     │
└─────────────┘    └─────────────┘
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
  role TEXT DEFAULT 'pending',         -- 'admin' | 'member' | 'pending'
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
  created_at INTEGER DEFAULT (unixepoch())
);
```

---

## Phân quyền

| Role | Quyền |
|---|---|
| `admin` | Toàn quyền. Xem data tất cả members. Duyệt/từ chối tài khoản pending. Tạo account trước cho member. |
| `member` | Chỉ xem và chỉnh sửa data của chính mình. Tham gia project được admin mời. |
| `pending` | Đã đăng ký, chờ admin duyệt. Không vào được app, chỉ thấy trang "Chờ duyệt". |

**Admin view đặc biệt:**
- Xem data từng member riêng lẻ (chọn member → thấy toàn bộ annotations + lines của họ)
- Xem layer chồng nhau: mở 1 file PDF, thấy annotations của tất cả members hiển thị cùng lúc

---

## Tính năng chi tiết

### 1. Auth & User Management
- Trang đăng ký: email + password + tên → status `pending`
- Trang đăng nhập: JWT token, lưu localStorage, refresh token
- Admin dashboard: danh sách pending users → nút Duyệt / Từ chối
- Admin có thể tạo sẵn account (email + password tạm) cho member
- Trang "Chờ duyệt" cho pending users

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
│   │   │   └── shotlist/        # Shotlist table + export
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── usePDF.ts
│   │   │   └── useShotlist.ts
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
│   │   │   └── shots.ts         # /shots CRUD + export
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

GET    /users                  Admin: list all users
PATCH  /users/:id/approve      Admin: approve pending user
PATCH  /users/:id/role         Admin: change role
DELETE /users/:id              Admin: delete user

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
