# CrawlData

Ứng dụng Desktop (Electron + React + Express) cung cấp công cụ tải và xử lý nội dung YouTube, Instagram, TikTok và Pinterest.

## 🚀 Tính năng chính
1. **YouTube Tools**: lấy danh sách video kênh, transcript, audio gốc và video theo chất lượng.
2. **Instagram Tools**: quét thông tin kênh, lọc bài đăng, xuất Excel/ZIP ảnh, lấy thông tin hàng loạt và tải video/audio từ bài đăng hoặc Reel.

Instagram có nút **Kết nối Instagram** trong bản Electron. Ứng dụng mở cửa sổ đăng nhập riêng và lưu phiên trong vùng lưu trữ của Electron; người dùng không cần sao chép cookie. Lỗi 401/403 có thể cần đăng nhập lại. Lỗi 429 là giới hạn truy cập từ Instagram: hãy chờ thời gian ứng dụng báo rồi thử lại; kết nối lại thường không giải quyết được lỗi này. Quét kênh tải từng phần, lưu tiến độ sau mỗi trang; Excel/ZIP chỉ chứa các bài đã tải khi chưa quét hết. Không có redirect/callback nào có thể đọc cookie từ trình duyệt Chrome bên ngoài.

Khi phát triển, backend trên cổng 8695 chỉ giữ phiên trong bộ nhớ. Electron tự đồng bộ lại phiên khi mở ứng dụng và mỗi 15 giây, kể cả sau khi backend tự khởi động lại. Nếu gọi API trực tiếp bằng `curl`, hãy giữ ứng dụng Electron đang mở; có thể kiểm tra trạng thái bằng `GET http://127.0.0.1:8695/api/v1/internal/instagram-session` (chỉ trả `connected`, không trả cookie).
3. **TikTok Tools**: lấy danh sách video, tải video và audio.
4. **Pinterest Tools**: lấy danh sách pin, tải media và xuất dữ liệu.

---

## 🛠 Hướng dẫn phát triển (Development)

1. Cài đặt thư viện:
```bash
npm install
```

2. Chạy ứng dụng ở chế độ lập trình (Dev Mode):
```bash
npm run dev
```
*(Lệnh này sẽ tự động khởi chạy Backend Express, Vite Dev Server và Electron)*

Trong chế độ dev, giao diện ở cổng 8696 gọi thẳng API backend ở cổng 8695. Bản đóng gói dùng API nội bộ ở cổng 8696. Desktop không dùng proxy cho các yêu cầu mạng.

---

## 📦 Hướng dẫn đóng gói ứng dụng Desktop (Build & Package)

### 1. Build ứng dụng:
```bash
npm run build
```

### 2. Đóng gói bộ cài đặt:
- **macOS** (File `.dmg` và `.zip`):
```bash
npm run package:mac
```
- **Windows** (File `.exe` NSIS và Portable):
```bash
npm run package:win
```

File cài đặt xuất xưởng sẽ nằm trong thư mục `release/`.

### Cập nhật ứng dụng

Vào **Settings / About → Check for Updates** trên bản đã cài đặt. Ứng dụng chỉ kiểm tra khi người dùng bấm nút; tải và cài bản mới cũng cần người dùng xác nhận. Bản development không kiểm tra cập nhật.

Quy trình phát hành cho Windows và macOS, cấu hình ký macOS, các file `latest*.yml` và cách thử update nằm trong [docs/releasing.md](docs/releasing.md). Repo mã nguồn phát hành riêng là [realessToolCrawlData](https://github.com/QuangNynh/realessToolCrawlData).


## YouTube Tools

Mục YouTube có 4 tab: Video view (kèm xuất Excel), Lấy tiêu đề kịch bản, Lấy audio gốc và Tải video YouTube.

API tương ứng nằm dưới `/api/v1/youtube`:

- `POST transcript` nhận `{ videoId }`; `POST transcripts` nhận `{ videoIds }`, trả transcript theo từng đoạn cùng metadata.
- `POST urls` trả `videos` gồm ID, tiêu đề, lượt xem và ngày tạo.
- `POST audio`, `video`, `audio/youtubei`, `download-image`, `srt`, `script` hỗ trợ các luồng tải/xử lý trong project mẫu.

Các API quản lý kênh, OAuth, metadata, thumbnail và lên lịch YouTube đã được loại bỏ. Audio gốc ưu tiên M4A, giữ WebM/Opus nếu nguồn không có AAC để không giảm chất lượng. Video xuất MP4 H.264/AAC. Chuyển audio sang SRT/kịch bản cần lệnh `whisper` trong PATH; ffmpeg dùng binary đi kèm ứng dụng.

Kiểm tra sau khi sửa:

```bash
npx tsc --noEmit
npm run build
npm run test:youtube
npm run test:youtube-ui
```

Hai bài kiểm tra YouTube dùng dữ liệu giả lập. Kiểm tra giao diện chạy Electron ẩn và ghi ảnh vào thư mục tạm được in ra khi hoàn tất. Các luồng tải từ YouTube thực tế cần mạng hoạt động để kiểm chứng trực tiếp.
