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

FFmpeg đã đi kèm ứng dụng. Whisper cần Python 3 64-bit có `venv`; khuyến nghị **Python 3.11** để tương thích với các thư viện của bản Whisper đang dùng. Ứng dụng kiểm tra các vị trí Whisper có sẵn, bao gồm Homebrew trên macOS, và ưu tiên môi trường riêng đã cài thành công (trừ khi đặt `WHISPER_PATH`). Nếu chưa có hoặc bản hiện tại hỏng, bấm **Cài / sửa Whisper**. Cần internet khi cài và khi tải model lần đầu; nhận dạng sau đó chạy trên máy, không gửi audio tới Antigravity.

- **Windows:** cài Python 3.11 64-bit từ [python.org](https://www.python.org/downloads/windows/), kèm pip và Python Launcher. App tìm Python qua `py -3.11`, `py -3`, PATH và thư mục cài mặc định của Python.org, nên không bắt buộc phải có lệnh `python3`.
- **macOS:** dùng Python 3.11 từ [python.org](https://www.python.org/downloads/macos/) hoặc `brew install python@3.11`. App tìm các vị trí Homebrew cho Apple Silicon/Intel và Python.org; không cần mở app từ Terminal.

App tạo môi trường riêng rồi chuẩn bị pip bằng `ensurepip`; nếu một bản Homebrew không chạy được bước này, app dùng pip của Python gốc (cần pip ≥22.3) để cài pip vào môi trường riêng. Chỉ pip trong môi trường riêng được nâng cấp; Python hệ thống không bị thay đổi. Kiểm tra lại bằng `whisper --help` trước khi báo cài thành công.

Môi trường riêng nằm trong `data/media-runtime/` của vùng dữ liệu ứng dụng, không sửa Python/Whisper toàn hệ thống. Development dùng thư mục `data/media-runtime/` của dự án. macOS Homebrew Python 3.11 được ưu tiên; có thể đặt `PYTHON_PATH` hoặc `WHISPER_PATH` trước khi khởi động backend. Model có sẵn trong `~/.cache/whisper` được dùng lại, nếu chưa có thư mục này thì model được giữ trong môi trường riêng. Whisper/PyTorch có thể dùng hơn 1 GB; đây là runtime dùng chung, không tăng theo số file lịch sử. Thư mục runtime không được đưa vào bộ cài Electron.

Nếu Python chưa được cài hoặc không hoạt động, thông báo trên màn nhận dạng chỉ rõ lỗi. **Extract Audio** hoạt động độc lập với Whisper. Chất lượng nhận dạng phụ thuộc giọng nói, tiếng ồn, ngôn ngữ và model; file không nhận ra lời nói được giữ ở trạng thái lỗi để xử lý lại.

### Windows: `UnicodeEncodeError` khi in ký tự `。`

Lỗi này có thể xuất hiện ngay trong `argparse.print_help`, trước khi Whisper nhận dạng audio: Python ghi phần trợ giúp có tên ngôn ngữ Unicode ra pipe nhưng dùng bảng mã `cp1252`. Mọi tiến trình kiểm tra/cài/chạy Whisper và pip được đặt `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `PYTHONUNBUFFERED=1`; log được giải mã UTF-8 theo từng stream để không vỡ ký tự khi chia chunk. Cách này áp dụng cho cả Windows và macOS, không cần đổi vùng/ngôn ngữ hay code page của Windows. Xem [thiết lập mã hóa standard streams của Python](https://docs.python.org/3.13/using/cmdline.html#envvar-PYTHONIOENCODING).

App đã cài cần cập nhật sang bộ cài chứa bản sửa này. Sau khi cập nhật, vào màn nhận dạng và bấm **Kiểm tra lại**; nếu Whisper đã cài đủ thì app nhận lại ngay, không cần tải lại runtime. Chỉ bấm **Cài / sửa Whisper** nếu kiểm tra vẫn báo chưa sẵn sàng.

## Hàng đợi và lịch sử

Ba màn dùng chung một worker, tránh chạy nhiều Whisper cùng lúc gây tốn RAM/CPU. Chuyển màn vẫn chạy. Tiến độ hiển thị theo từng giai đoạn và phần trăm thực tế khi FFmpeg/Whisper có cung cấp; không có tiến độ giả.

**Tạm dừng** dừng tiến trình đang xử lý và giữ file đó để chạy lại khi **Tiếp tục**. **Hủy đợt** hủy file đang làm/còn chờ, giữ file đã lưu. **Thử lại file lỗi / hủy** chỉ chạy lại file lỗi/hủy, bỏ qua thành công. Khi đóng/mở app, đợt chưa xong được giữ ở trạng thái tạm dừng; bấm **Tiếp tục**. Cần giữ file gốc đúng vị trí. Khi thiếu dung lượng hoặc quyền ghi, đợt được tạm dừng để khắc phục.

File đầu vào được đọc trực tiếp từ ổ đĩa, không sao chép vào dữ liệu app. File trung gian được dọn sau mỗi lượt, kể cả lỗi/hủy. Kết quả chỉ được đánh dấu thành công sau khi ghi xong; tên trùng thêm `(2)`, `(3)` để tránh ghi đè.

Select **Đợt đã lưu** có nút **Xóa lịch sử xử lý** bên cạnh. Nút bật khi màn hiện tại có ít nhất một đợt đã kết thúc. Xóa chỉ dọn lịch sử của các đợt đó; không xóa file gốc/kết quả hoặc đợt đang chờ/tạm dừng để tiếp tục. Dữ liệu lịch sử chỉ chứa metadata và đường dẫn, tối đa 20 đợt/5.000 file toàn bộ ba màn, lưu trong `data/media-jobs/jobs.json`. Văn bản xem trước/TXT gộp giới hạn 8 MB; file kết quả riêng vẫn ở thư mục tải.

## API và build

Desktop dùng IPC được kiểm tra nguồn gọi; đường dẫn nguồn được lấy từ hộp chọn file hoặc kéo thả native, thư mục kết quả do Electron cung cấp. Backend quản lý tác vụ tại `POST /api/v1/internal/media` chỉ nhận loopback không có Origin. API upload tương thích gồm `POST /api/v1/youtube/srt`, `/youtube/script` và `/media/extract-audio` (`file`, `format`, `bitrate`), tối đa 500 MB mỗi upload. Desktop dùng đường dẫn native và không chịu giới hạn upload 500 MB.

```bash
npm run setup:whisper
npm run build:frontend
npm run build:electron
```
