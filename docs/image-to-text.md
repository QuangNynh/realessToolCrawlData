# Ảnh sang Text hàng loạt

1. Kết nối tài khoản và tạo API key trong **AI / Antigravity**.
2. Mở **Ảnh sang Text**, chọn model có khả năng đọc ảnh và API key đã tạo.
3. Chọn hoặc kéo thả một folder ảnh vào khung tải lên. Chỉ lấy ảnh trực tiếp trong folder (không quét thư mục con), PNG/JPG/WEBP/TIFF/GIF/AVIF, tối đa 5.000 ảnh/đợt.
4. Kiểm tra danh sách theo thứ tự tên tự nhiên `1.png`, `2.png`, …, `10.png`, rồi bấm **CHẠY THẦN CHÚ**.
5. Khi hoàn tất, file `images-to-text-<mã đợt>.txt` tự lưu vào thư mục tải đã chọn. **Mở file TXT** chọn file trong Finder/Explorer.

Mỗi ảnh được gửi riêng qua gateway Antigravity đã kết nối. Ảnh được xoay theo EXIF, chuẩn hóa PNG tối đa 4096 × 4096, không phóng lớn ảnh nhỏ. Chỉ giữ một ảnh trong bộ nhớ; ảnh không đi qua renderer/IPC hoặc domain public. Không cài OCR/Python mới. Chọn model hỗ trợ vision; model chỉ hỗ trợ text có thể từ chối ảnh.

Model được yêu cầu chép nguyên văn, không dịch/tóm tắt. Mọi khoảng trắng/xuống dòng bên trong kết quả một ảnh ghép thành dấu cách. File TXT có đúng một dòng mỗi ảnh theo danh sách ban đầu, không chèn tên ảnh/tiêu đề; ảnh không có chữ giữ dòng trống. GIF/TIFF nhiều khung dùng khung đầu tiên. Model có thể đọc nhầm chữ nhỏ/mờ; khung Kết Quả Giải Mã xem text đầy đủ và nút Sao chép lấy toàn bộ kết quả đã đọc.

Đợt xử lý lần lượt. Lỗi tạm thời được thử tối đa 3 lần; lỗi tài khoản/model/quota tạm dừng để khắc phục. Nút thử lại chỉ đọc ảnh chưa thành công, không gọi lại ảnh đã xong. Chuyển màn vẫn chạy; đóng/mở app giữ tiến độ trong `data/image-ocr/current.json`, mở lại rồi tiếp tục. API key chỉ lưu ID tham chiếu, không sao chép secret vào tiến độ. Giữ folder gốc ở vị trí cũ.

File TXT đầy đủ chỉ xuất khi toàn bộ ảnh đã thành công. Nếu thay đợt còn lỗi bằng folder mới, text đã đọc của đợt cũ được lưu vào file cũ và giữ dòng trống cho ảnh lỗi để không mất thứ tự. File kết quả cũ không bị xóa. Ảnh nguồn giới hạn 50 MB/80 triệu pixel, ảnh chuẩn hóa tối đa 16 MB, tổng text tối đa 24 MB/đợt. Chỉ giữ đợt hiện tại trong dữ liệu tiến độ.

Desktop chọn folder native, main process cấp mã folder; renderer không được gửi đường dẫn tùy ý. Endpoint điều phối nội bộ chỉ nhận loopback không có Origin và không cung cấp qua cấu hình domain public. App packaged dùng cùng singleton backend để chia sẻ tài khoản Antigravity; development gọi backend 8695 nội bộ.

Giao diện hai khung nền tối theo mẫu: tải folder bên trái, kết quả bên phải; mở **Model & API key** để thay cấu hình. Màn nhỏ tự xếp dọc. Sau khi cập nhật mã preload/main cần mở lại Electron để dùng kéo thả folder và sao chép/xem text mới; tiến độ đã lưu không mất.

**Làm mới** ở đầu khung tải ảnh dừng lượt gọi đang chạy, dọn tiến độ và text trên màn hình để chọn folder khác. Giữ nguyên model/API key, ảnh nguồn và file TXT cũ. Text đã đọc của đợt dở được lưu vào TXT cũ trước khi dọn; dòng của ảnh chưa xong để trống.

Nút **Tải TXT** cạnh Sao chép mở hộp chọn nơi lưu file. Chỉ bật khi đã có ảnh đọc xong và worker đã dừng hoàn toàn (tạm dừng, lỗi hoặc hoàn tất). Backend kiểm tra lại trạng thái trước lúc ghi file. Nếu tải khi đợt chưa hoàn tất, tên mặc định có `-partial`, ảnh chưa đọc/lỗi giữ dòng trống.
