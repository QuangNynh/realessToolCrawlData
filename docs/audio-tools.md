# Audio to SRT, Audio to Script và Extract Audio

Ba mục trong thanh điều hướng Desktop được chuyển từ toolFe/toolBe, dùng Whisper cho nhận dạng và FFmpeg cho xử lý media.

## Cách dùng

1. Chọn **Lưu tại…** trên thanh phía trên để đặt thư mục kết quả.
2. Mở **Convert Audio to SRT**, **Audio to Script** hoặc **Extract Audio**.
3. Chọn hoặc kéo thả file trên máy; mỗi đợt từ 1 đến 1.000 file.
4. Với nhận dạng: chọn model Tiny/Base/Small và ngôn ngữ (hoặc tự nhận dạng). Base là mặc định; chọn đúng ngôn ngữ nếu đã biết.
5. Với tách audio: chọn MP3/WAV/AAC/FLAC/OGG và bitrate 64–320 kbps. WAV/FLAC không dùng bitrate.
6. Bấm nút xử lý. Tất cả file thành công được lưu tự động; **Mở thư mục** chọn file kết quả trong Finder/Explorer.

SRT giữ timestamp của lời nói. Script bỏ timestamp, giữ lời nói và đoạn văn, xuất từng file `.txt`. Có xem trước, sao chép và tải lại văn bản. Hai màn nhận dạng có **Xuất ZIP**; Script có **Xuất TXT gộp** và **Sao chép tất cả**, với mỗi mục bắt đầu bằng `1. Tên audio` để nhập lại vào AI Script Converter.

## Whisper

FFmpeg đã đi kèm ứng dụng. Whisper cần Python 3 với pip. Ứng dụng kiểm tra các vị trí Whisper có sẵn, bao gồm Homebrew trên macOS, và ưu tiên môi trường riêng đã cài thành công. Nếu chưa có hoặc bản hiện tại hỏng, bấm **Cài / sửa Whisper**. Cần internet khi cài và khi tải model lần đầu; nhận dạng sau đó chạy trên máy, không gửi audio tới Antigravity.

Môi trường riêng nằm trong `data/media-runtime/` của vùng dữ liệu ứng dụng, không sửa Python/Whisper toàn hệ thống. Development dùng thư mục `data/media-runtime/` của dự án. macOS Homebrew Python 3.11 được ưu tiên; có thể đặt `PYTHON_PATH` hoặc `WHISPER_PATH` trước khi khởi động backend. Model có sẵn trong `~/.cache/whisper` được dùng lại, nếu chưa có thư mục này thì model được giữ trong môi trường riêng. Whisper/PyTorch có thể dùng hơn 1 GB; đây là runtime dùng chung, không tăng theo số file lịch sử. Thư mục runtime không được đưa vào bộ cài Electron.

Nếu Python chưa được cài hoặc không hoạt động, thông báo trên màn nhận dạng chỉ rõ lỗi. **Extract Audio** hoạt động độc lập với Whisper. Chất lượng nhận dạng phụ thuộc giọng nói, tiếng ồn, ngôn ngữ và model; file không nhận ra lời nói được giữ ở trạng thái lỗi để xử lý lại.

## Hàng đợi và lịch sử

Ba màn dùng chung một worker, tránh chạy nhiều Whisper cùng lúc gây tốn RAM/CPU. Chuyển màn vẫn chạy. Tiến độ hiển thị theo từng giai đoạn và phần trăm thực tế khi FFmpeg/Whisper có cung cấp; không có tiến độ giả.

**Tạm dừng** dừng tiến trình đang xử lý và giữ file đó để chạy lại khi **Tiếp tục**. **Hủy đợt** hủy file đang làm/còn chờ, giữ file đã lưu. **Thử lại file lỗi / hủy** chỉ chạy lại file lỗi/hủy, bỏ qua thành công. Khi đóng/mở app, đợt chưa xong được giữ ở trạng thái tạm dừng; bấm **Tiếp tục**. Cần giữ file gốc đúng vị trí. Khi thiếu dung lượng hoặc quyền ghi, đợt được tạm dừng để khắc phục.

File đầu vào được đọc trực tiếp từ ổ đĩa, không sao chép vào dữ liệu app. File trung gian được dọn sau mỗi lượt, kể cả lỗi/hủy. Kết quả chỉ được đánh dấu thành công sau khi ghi xong; tên trùng thêm `(2)`, `(3)` để tránh ghi đè.

Select **Đợt đã lưu** có nút **Xóa lịch sử xử lý** bên cạnh. Nút bật khi màn hiện tại có ít nhất một đợt đã kết thúc. Xóa chỉ dọn lịch sử của các đợt đó; không xóa file gốc/kết quả hoặc đợt đang chờ/tạm dừng để tiếp tục. Dữ liệu lịch sử chỉ chứa metadata và đường dẫn, tối đa 20 đợt/5.000 file toàn bộ ba màn, lưu trong `data/media-jobs/jobs.json`. Văn bản xem trước/TXT gộp giới hạn 8 MB; file kết quả riêng vẫn ở thư mục tải.

## API và kiểm tra

Desktop dùng IPC được kiểm tra nguồn gọi; đường dẫn nguồn được lấy từ hộp chọn file hoặc kéo thả native, thư mục kết quả do Electron cung cấp. Backend quản lý tác vụ tại `POST /api/v1/internal/media` chỉ nhận loopback không có Origin. API upload tương thích gồm `POST /api/v1/youtube/srt`, `/youtube/script` và `/media/extract-audio` (`file`, `format`, `bitrate`), tối đa 500 MB mỗi upload. Desktop dùng đường dẫn native và không chịu giới hạn upload 500 MB.

```bash
npm run setup:whisper
npm run test:media
npm run build:frontend
npm run build:electron
npm run test:media-ui
node scripts/media-live-smoke.cjs # macOS: giọng nói mẫu, Whisper Base/FFmpeg thật
```

Backend kiểm tra lô 1.000 file bằng processor giả lập, 5 định dạng qua FFmpeg thật, truyền tham số Whisper và dọn file, pause/resume/retry/cancel, checkpoint và xóa lịch sử. Kiểm thử UI chạy Electron ẩn, ghi ảnh các kích thước 480/800/1360 px vào thư mục tạm, dùng fixture lời nói và FFmpeg thật cho tách audio. Kiểm thử live dùng giọng nói mẫu tổng hợp, không dùng audio cá nhân.
