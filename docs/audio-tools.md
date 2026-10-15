# Audio to SRT, Audio to Script và Extract Audio

Ba mục trong thanh điều hướng Desktop được chuyển từ toolFe/toolBe, có thể chọn Whisper hoặc Moonshine cho nhận dạng và dùng FFmpeg cho xử lý media.

## Cách dùng

1. Chọn **Lưu tại…** trên thanh phía trên để đặt thư mục kết quả.
2. Mở **Convert Audio to SRT**, **Audio to Script** hoặc **Extract Audio**.
3. Chọn hoặc kéo thả file trên máy; mỗi đợt từ 1 đến 1.000 file.
4. Với nhận dạng: chọn **Bộ nhận dạng → Whisper / Moonshine**, cài bộ nhận dạng đã chọn nếu cần, rồi chọn model. Giao diện mặc định **Moonshine Small Streaming**, ngôn ngữ **Tiếng Anh**. Whisper có thêm lựa chọn **Tiếng Việt**, mặc định model Base. Moonshine chỉ có **Tiếng Anh**, mặc định Small Streaming và cho chọn Small/Medium; chuyển từ Whisper tiếng Việt sang Moonshine sẽ tự chọn tiếng Anh.
5. Với tách audio: chọn MP3/WAV/AAC/FLAC/OGG và bitrate 64–320 kbps. WAV/FLAC không dùng bitrate.
6. Bấm nút xử lý. Tất cả file thành công được lưu tự động; **Mở thư mục** chọn file kết quả trong Finder/Explorer.

Màn SRT có hai lựa chọn: **Giữ thời gian nhận dạng (hiện tại)** hoặc **Đầu đoạn sau = cuối đoạn trước + khoảng cách**. Giao diện mặc định chọn chế độ nhập khoảng cách và hiện sẵn ô **10 ms**. Chế độ thứ hai đặt đầu mỗi đoạn sau bằng cuối đoạn trước cộng khoảng cách nhập trong ô **Khoảng cách giữa hai đoạn (ms)**; mặc định **10 ms = 0,01 giây**, cho nhập số nguyên không âm, giữ nguyên đầu đoạn đầu tiên, toàn bộ thời điểm kết thúc và nội dung. Nếu đầu mới chạm/vượt cuối đoạn hoặc độ dài audio đã biết thì báo lỗi, tránh tạo timestamp không hợp lệ. Áp dụng cho cả Whisper/Moonshine trước khi lưu, nên xem trước, tải SRT và ZIP dùng cùng kết quả. Nếu mốc không hợp lệ, file báo lỗi để thử lại. Script bỏ timestamp, giữ lời nói và đoạn văn, xuất từng file `.txt`. Có xem trước, sao chép và tải lại văn bản. Hai màn nhận dạng có **Xuất ZIP**; Script có **Xuất TXT gộp** và **Sao chép tất cả**, với mỗi mục bắt đầu bằng `1. Tên audio` để nhập lại vào AI Script Converter.

## Whisper

FFmpeg đã đi kèm ứng dụng. Whisper cần Python 3 64-bit có `venv`; khuyến nghị **Python 3.11** để tương thích với các thư viện của bản Whisper đang dùng. Ứng dụng kiểm tra các vị trí Whisper có sẵn, bao gồm Homebrew trên macOS, và ưu tiên môi trường riêng đã cài thành công (trừ khi đặt `WHISPER_PATH`). Nếu chưa có hoặc bản hiện tại hỏng, bấm **Cài / sửa Whisper**. Cần internet khi cài và khi tải model lần đầu; nhận dạng sau đó chạy trên máy, không gửi audio tới Antigravity.

- **Windows:** cài Python 3.11 64-bit từ [python.org](https://www.python.org/downloads/windows/), kèm pip và Python Launcher. App tìm Python qua `py -3.11`, `py -3`, PATH và thư mục cài mặc định của Python.org, nên không bắt buộc phải có lệnh `python3`.
- **macOS Apple Silicon:** dùng Python 3.11 arm64 từ [python.org](https://www.python.org/downloads/macos/) hoặc `brew install python@3.11` bằng Homebrew trong `/opt/homebrew`. App kiểm tra kiến trúc Python và bỏ qua Python x86_64 chạy qua Rosetta; không cần mở app từ Terminal.

App tạo môi trường riêng rồi chuẩn bị pip bằng `ensurepip`; nếu một bản Homebrew không chạy được bước này, app dùng pip của Python gốc (cần pip ≥22.3) để cài pip vào môi trường riêng. Chỉ pip trong môi trường riêng được nâng cấp; Python hệ thống không bị thay đổi. Kiểm tra lại bằng `whisper --help` trước khi báo cài thành công.

Môi trường riêng nằm trong `data/media-runtime/` của vùng dữ liệu ứng dụng, không sửa Python/Whisper toàn hệ thống. Development dùng thư mục `data/media-runtime/` của dự án. macOS Homebrew Python 3.11 được ưu tiên; có thể đặt `PYTHON_PATH` hoặc `WHISPER_PATH` trước khi khởi động backend. Model có sẵn trong `~/.cache/whisper` được dùng lại, nếu chưa có thư mục này thì model được giữ trong môi trường riêng. Whisper/PyTorch có thể dùng hơn 1 GB; đây là runtime dùng chung, không tăng theo số file lịch sử. Thư mục runtime không được đưa vào bộ cài Electron.

Nếu Python chưa được cài hoặc không hoạt động, thông báo trên màn nhận dạng chỉ rõ lỗi. **Extract Audio** hoạt động độc lập với Whisper. Chất lượng nhận dạng phụ thuộc giọng nói, tiếng ồn, ngôn ngữ và model; file không nhận ra lời nói được giữ ở trạng thái lỗi để xử lý lại.

### Windows: `UnicodeEncodeError` khi in ký tự `。`

Lỗi này có thể xuất hiện ngay trong `argparse.print_help`, trước khi Whisper nhận dạng audio: Python ghi phần trợ giúp có tên ngôn ngữ Unicode ra pipe nhưng dùng bảng mã `cp1252`. Mọi tiến trình kiểm tra/cài/chạy Whisper và pip được đặt `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`, `PYTHONUNBUFFERED=1`; log được giải mã UTF-8 theo từng stream để không vỡ ký tự khi chia chunk. Cách này áp dụng cho cả Windows và macOS, không cần đổi vùng/ngôn ngữ hay code page của Windows. Xem [thiết lập mã hóa standard streams của Python](https://docs.python.org/3.13/using/cmdline.html#envvar-PYTHONIOENCODING).

App đã cài cần cập nhật sang bộ cài chứa bản sửa này. Sau khi cập nhật, vào màn nhận dạng và bấm **Kiểm tra lại**; nếu Whisper đã cài đủ thì app nhận lại ngay, không cần tải lại runtime. Chỉ bấm **Cài / sửa Whisper** nếu kiểm tra vẫn báo chưa sẵn sàng.

## Moonshine

[Moonshine Voice](https://github.com/moonshine-ai/moonshine) là lựa chọn nhận dạng chạy trên máy, không cần tài khoản hoặc API key. SDK cài riêng bằng **Cài / sửa Moonshine**, không cần cài Whisper/PyTorch. Bản tích hợp khóa `moonshine-voice==0.1.5` và kiểm tra thư viện native trước khi báo sẵn sàng. Gói chính thức có binary cho **Windows x64** và **macOS 15+ Apple Silicon**; bộ cài macOS của ứng dụng nhắm kiến trúc arm64. Xem [gói phát hành chính thức](https://pypi.org/project/moonshine-voice/0.1.5/).

SDK có các model streaming trong [catalog chính thức](https://moonshine-voice.readthedocs.io/en/latest/models/available-models/) dưới đây; ứng dụng chỉ cho chọn Moonshine Small/Medium tiếng Anh cho đợt mới:

| Ngôn ngữ | Model Moonshine |
| --- | --- |
| Tiếng Việt, Trung, Ả Rập, Tagalog | Tiny Streaming |
| Tiếng Nhật, Đức, Tây Ban Nha | Tiny / Small Streaming |
| Tiếng Anh | Tiny / Small / Medium Streaming |

Sau khi cài xong, khi mở màn nhận dạng hoặc bấm **Kiểm tra lại**, backend đọc catalog từ SDK native đã cài (không cần tải model). Danh sách được trả cùng trạng thái sẵn sàng và giao diện tự cập nhật sau khi cài. Trước khi cài, giao diện dùng catalog dự phòng của SDK 0.1.5.

Moonshine chỉ có lựa chọn **Tiếng Anh**, với **Small / Medium Streaming**, mặc định Small. Tiny và tiếng Việt đã được bỏ khỏi lựa chọn cho đợt mới và API upload. Muốn nhận dạng tiếng Việt, dùng Whisper. Đợt Moonshine đã lưu dùng Tiny hoặc tiếng Việt vẫn đọc và tiếp tục được với lựa chọn ban đầu. API mặc định tiếng Anh nếu bỏ trống `language`.

Môi trường Python nằm trong `data/moonshine-runtime/venv/`, model tải lần đầu vào `data/moonshine-runtime/models/`. Hai thư mục ở vùng dữ liệu ứng dụng (development: trong dự án); cài/sửa SDK không xóa model đã tải. Xóa lịch sử không làm mất runtime/model. FFmpeg decode trực tiếp sang PCM float32 16 kHz mono qua pipe có backpressure; không tạo WAV trung gian cho Moonshine. Python đọc từng khối 5 giây và đưa NumPy buffer vào C API. VAD native chia lời nói thành câu tối đa 15 giây; không cắt câu theo biên khối 5 giây. Chỉ ghi text/timestamp của dòng đã hoàn tất, tắt PCM trong transcript và giải mã câu chưa hoàn tất. Audio to Script dùng cùng transcript, bỏ timestamp khi xuất TXT.

Trên Mac, Electron/Node phải là arm64, Python và FFmpeg phải có slice arm64; child process được khởi chạy qua `arch -arm64`. Hook sau đóng gói kiểm tra Mach-O của framework, binary và native addon. Hủy/tạm dừng/timeout dừng cả FFmpeg và Python. Backend ghi một bản ghi `[Moonshine performance]` cho mỗi file hoàn tất: thời gian chuẩn bị model, load, inference, chờ decode, toàn pipeline, RTF và RAM đỉnh khi Python cung cấp được; không ghi audio/text/path vào bản ghi này. Xem [phân tích hiệu năng và cấu hình inference](moonshine-performance.md).

Đợt đã lưu giữ `engine`, `model`, `language`; tạm dừng/tiếp tục/chạy lại dùng đúng lựa chọn ban đầu. Đợt cũ chưa có `engine` được đọc thành Whisper. Trạng thái sẵn sàng/cài đặt của hai bộ nhận dạng độc lập; cài Moonshine không sửa môi trường Whisper.

## Hàng đợi và lịch sử

Ba màn dùng chung một worker, tránh chạy nhiều bộ nhận dạng cùng lúc gây tốn RAM/CPU. Chuyển màn vẫn chạy. Tiến độ hiển thị theo từng giai đoạn và phần trăm thực tế khi FFmpeg/Whisper/Moonshine có cung cấp; không có tiến độ giả.

**Tạm dừng** dừng tiến trình đang xử lý và giữ file đó để chạy lại khi **Tiếp tục**. **Hủy đợt** hủy file đang làm/còn chờ, giữ file đã lưu. **Thử lại file lỗi / hủy** chỉ chạy lại file lỗi/hủy, bỏ qua thành công. Khi đóng/mở app, đợt chưa xong được giữ ở trạng thái tạm dừng; bấm **Tiếp tục**. Cần giữ file gốc đúng vị trí. Khi thiếu dung lượng hoặc quyền ghi, đợt được tạm dừng để khắc phục.

File đầu vào được đọc trực tiếp từ ổ đĩa, không sao chép vào dữ liệu app. File trung gian được dọn sau mỗi lượt, kể cả lỗi/hủy. Kết quả chỉ được đánh dấu thành công sau khi ghi xong; tên trùng thêm `(2)`, `(3)` để tránh ghi đè.

**Audio to SRT / Audio to Script** chỉ hiển thị đợt hiện tại, không có select lịch sử hay nút xóa lịch sử. Đợt đã kết thúc chỉ giữ trong bộ nhớ để xem/xuất/thử lại; bấm **Tạo đợt mới** để thay đợt cũ. Khi còn file chờ/đang chạy, cần hoàn tất hoặc hủy trước. Chỉ đợt chưa xong được lưu để tiếp tục khi mở lại app. Lịch sử nhận dạng đã kết thúc từ bản cũ được tự dọn khi khởi động, không xóa file gốc/kết quả. Nếu bản cũ có nhiều đợt đang dở, giao diện lần lượt mở đợt cũ nhất; kết thúc rồi bấm Tạo đợt mới để mở đợt đang dở tiếp theo.

**Extract Audio** vẫn có select **Đợt đã lưu** và nút **Xóa lịch sử xử lý**, bật khi có đợt đã kết thúc. Xóa chỉ dọn metadata của các đợt đó, không xóa file gốc/kết quả hoặc đợt chưa xong. Dữ liệu lưu trong `data/media-jobs/jobs.json`, giới hạn 20 đợt/5.000 file cho lịch sử Extract và các đợt chưa xong. Văn bản xem trước/TXT gộp giới hạn 8 MB; file kết quả riêng vẫn ở thư mục tải.

## API và build

Desktop dùng IPC được kiểm tra nguồn gọi; đường dẫn nguồn được lấy từ hộp chọn file hoặc kéo thả native, thư mục kết quả do Electron cung cấp. Backend quản lý tác vụ tại `POST /api/v1/internal/media` chỉ nhận loopback không có Origin. API upload tương thích gồm `POST /api/v1/youtube/srt`, `/youtube/script` (`file`, tùy chọn `engine`, `model`, `language`) và `/media/extract-audio` (`file`, `format`, `bitrate`), tối đa 500 MB mỗi upload. API SRT nhận thêm `srtTiming=original` (mặc định) hoặc `previous-end-plus-10ms` (tên tương thích), kèm `srtGapMs` là số nguyên không âm, mặc định 10. Mặc định upload dùng Whisper như trước. Desktop dùng đường dẫn native và không chịu giới hạn upload 500 MB.

```bash
npm run setup:whisper
npm run setup:moonshine
npm run build:frontend
npm run build:electron
```
