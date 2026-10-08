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

Các lệnh push bản mới nằm trong [RELEASE_PUSH.md](RELEASE_PUSH.md). Cấu hình ký macOS, các file `latest*.yml` và cách thử update chi tiết nằm trong [docs/releasing.md](docs/releasing.md). Repo mã nguồn phát hành riêng là [realessToolCrawlData](https://github.com/QuangNynh/realessToolCrawlData).


## YouTube Tools

Mục YouTube có 4 tab: Video view (kèm xuất Excel), Lấy tiêu đề kịch bản, Lấy audio gốc và Tải video YouTube.

API tương ứng nằm dưới `/api/v1/youtube`:

- `POST transcript` nhận `{ videoId }`; `POST transcripts` nhận `{ videoIds }`, trả transcript theo từng đoạn cùng metadata.
- `POST urls` trả `videos` gồm ID, tiêu đề, lượt xem và ngày tạo.
- `POST audio`, `video`, `audio/youtubei`, `download-image`, `srt`, `script` hỗ trợ các luồng tải/xử lý trong project mẫu.

Các API quản lý kênh, OAuth, metadata, thumbnail và lên lịch YouTube đã được loại bỏ. Audio gốc ưu tiên M4A, giữ WebM/Opus nếu nguồn không có AAC để không giảm chất lượng. Video xuất MP4 H.264/AAC. Chuyển audio sang SRT/kịch bản dùng Whisper có sẵn hoặc môi trường riêng cài từ nút **Cài / sửa Whisper**; ffmpeg dùng binary đi kèm ứng dụng.

Tải hàng loạt audio/video trong Electron dùng hàng đợi trên đĩa, mỗi lô tối đa 1.000 link. Chọn thư mục tải, dán link rồi bấm **Get Audio** hoặc **Get Video**. File chỉ được đánh dấu **Đã lưu file** sau khi kiểm tra media và ghi xong vào thư mục. Audio và video dùng chung một lượt tải, 2 fragment song song và nghỉ 4–6 giây giữa các file. Khi gặp giới hạn YouTube, toàn bộ hàng đợi nghỉ từ 2 phút, tăng dần đến khoảng 1 giờ, có độ lệch ngẫu nhiên và tôn trọng `Retry-After`. Lỗi mạng được thử lại với thời gian nghỉ tăng dần; hai loại lỗi này không bị bỏ sau 3 vòng như trước. File `.part` được giữ để tiếp tục tải, fragment thiếu sẽ báo lỗi thay vì xuất file thiếu đoạn.

Chuyển tab không dừng tải. **Tạm dừng** lưu xong file đang tải rồi dừng lô; **Tiếp tục** giữ thời gian chờ YouTube; **Thử lại mục lỗi** chỉ xếp lại các mục lỗi. Hàng đợi, lỗi và vị trí file lưu trong `data/youtube-downloads/` ở vùng dữ liệu ứng dụng, tự khôi phục sau khi mở lại. Tên file giữ số thứ tự; nếu đã có file cùng tên, thêm `(2)`, `(3)` để tránh ghi đè. Có thể **Xuất link chưa tải** để đối chiếu các mục còn lại. Quét kênh dùng metadata của danh sách thay vì gửi thêm một yêu cầu cho từng video; các trường YouTube không trả về sẽ để trống.

Hai tab audio/video có nút **Xóa lịch sử tải** để dọn toàn bộ lô đã kết thúc của loại đang xem (gồm mục thành công và lỗi). Thao tác xóa dữ liệu lịch sử, thư mục tải tạm và file lưu tạm còn sót của các lô đó, đồng thời thu gọn `queue.json` và bản sao `queue.json.bak`. File media đã lưu trong thư mục tải xuống được giữ nguyên. Lô còn mục đang chờ, đang tải, chờ thử lại hoặc đang tạm dừng để tiếp tục sẽ được giữ lại; nút tắt khi không có lịch sử đã kết thúc. Lô không dọn được do lỗi ổ đĩa/quyền ghi được giữ lại để thử xóa lần sau.

Video riêng tư, bị xóa, giới hạn vùng/tuổi hoặc cần quyền thành viên được giữ với thông báo **Cần xử lý**. Lỗi ổ đĩa/quyền ghi tạm dừng lô để khắc phục. Lỗi chưa phân loại được thử tối đa 5 lần rồi giữ lại để thử thủ công. Không thể bảo đảm mọi URL đều tải được hoặc tự giải quyết CAPTCHA/quyền truy cập. Chính sách chờ và giới hạn yêu cầu dựa trên [tài liệu yt-dlp](https://github.com/yt-dlp/yt-dlp#download-options) và [FAQ về lỗi 429](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#http-error-429-too-many-requests-or-402-payment-required).

Kiểm tra sau khi sửa:

```bash
npx tsc --noEmit
npm run build
npm run test:youtube
npm run test:youtube-downloads
npm run test:youtube-ui
```

Hai bài kiểm tra YouTube dùng dữ liệu giả lập. Kiểm tra giao diện chạy Electron ẩn và ghi ảnh vào thư mục tạm được in ra khi hoàn tất. Các luồng tải từ YouTube thực tế cần mạng hoạt động để kiểm chứng trực tiếp.

## AI / Antigravity và API key cá nhân

Mở **AI / Antigravity** trong thanh điều hướng, bấm **Kết nối Antigravity** và hoàn tất đăng nhập Google trong trình duyệt. Bấm **Tạo API key** để cấp key riêng, chọn model và gọi thử trong app. Một key dùng cho toàn bộ model Antigravity mà tài khoản hỗ trợ; danh sách model được lấy trực tiếp từ Google. Phần này chạy độc lập với 9router.

API tương thích Chat Completions tại `http://127.0.0.1:8696/v1` (development: cổng `8695`), gồm `GET /v1/models` và `POST /v1/chat/completions`, xác thực `Authorization: Bearer YOUR_API_KEY`. Có streaming, tool calling và ảnh. Xem [hướng dẫn Antigravity API](docs/antigravity-api.md) để biết cách gọi, lưu trữ và các tham số hỗ trợ. Kiểm tra bằng `npm run test:ai` và `npm run test:ai-ui` sau khi build frontend/Electron.

## AI Script Converter

Chức năng từ toolFe/toolBe: nhập hoặc kéo thả TXT, phân tích nhiều kịch bản, prompt tùy chỉnh `[SCRIPT]`, chọn key/model Antigravity, xử lý tuần tự, dừng/tiếp tục và chạy lại mục lỗi. Tiến độ được lưu ở backend; có xem/copy kết quả, xuất TXT/Word và xóa đợt đã lưu. Xem [hướng dẫn Script Converter](docs/script-converter.md). Kiểm tra bằng `npm run test:script-converter` và `npm run test:script-converter-ui` sau khi build.

## Audio Tools

Menu có **Convert Audio to SRT**, **Audio to Script** và **Extract Audio**, chuyển từ toolFe/toolBe. Chọn/kéo thả nhiều file, chọn model/ngôn ngữ hoặc định dạng/bitrate, xử lý tuần tự và lưu trực tiếp vào thư mục tải. Có tạm dừng/tiếp tục, thử lại, xem/copy kết quả, xuất TXT/ZIP và xóa lịch sử cạnh select **Đợt đã lưu**. Nhận dạng chạy bằng Whisper trên máy; tách audio dùng FFmpeg đi kèm. Xem [hướng dẫn Audio Tools](docs/audio-tools.md) để cài runtime và kiểm tra.
