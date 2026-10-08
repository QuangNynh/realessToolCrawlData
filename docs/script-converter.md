# AI Script Converter

Chuyển chức năng từ `toolFe/src/pages/script-converter.tsx` và luồng chat/model của `toolBe/src/modules/translation` sang CrawlData Desktop. Dùng kết nối Antigravity độc lập đã thêm trong app.

## Sử dụng

1. Vào **AI / Antigravity**, kết nối Google và tạo API key cá nhân.
2. Vào **AI Script Converter**, tải/kéo thả file `.txt` hoặc dán nội dung.
3. Chọn **Nhiều kịch bản** cho file có định dạng bên dưới, hoặc **Kịch bản đơn** cho văn bản tự do.
4. Bấm **Phân tích kịch bản**, chọn key và model văn bản khả dụng.
5. Nhập prompt chứa `[SCRIPT]`, rồi bấm **Bắt đầu chạy AI**.
6. Xem gốc/kết quả từng mục, sao chép hoặc xuất TXT/Word. **Xóa đợt đã lưu** dọn nội dung và kết quả của đợt đó trên máy.

```text
1.
https://www.youtube.com/watch?v=VIDEO_ID

Tiêu đề thứ nhất

Nội dung kịch bản thứ nhất...

2.
https://www.youtube.com/watch?v=VIDEO_ID_2

Tiêu đề thứ hai

Nội dung kịch bản thứ hai...
```

Chỉ nội dung kịch bản được thay vào `[SCRIPT]`; số thứ tự, URL và tiêu đề được giữ khi xuất. Placeholder được thay ở mọi vị trí. Link trong file chỉ là metadata, app không truy cập hoặc tải video từ link khi chuyển đổi.

## Tiến trình và lưu trữ

- Backend xử lý một đợt tại một thời điểm, một yêu cầu AI tại một thời điểm. Chuyển màn hình không dừng hàng đợi.
- **Dừng chạy** hủy yêu cầu đang chờ và giữ những kết quả đã hoàn tất. Tiếp tục/chạy lại chỉ xử lý mục chưa thành công. Có thể chọn model/key khác trước khi tiếp tục; prompt của đợt đã lưu được giữ nguyên.
- Mỗi mục tự thử lại tối đa một lần với lỗi mạng, timeout, 408, 429 hoặc 5xx. Nghỉ ít nhất 3 giây cho lỗi tạm thời; 429 nghỉ ít nhất 30 giây và tôn trọng `Retry-After`. 429 lần nữa hoặc lỗi quyền/key/model sẽ dừng cả đợt để xử lý. Lỗi nội dung khác được ghi cho từng mục.
- Không đánh dấu thành công nếu AI trả văn bản rỗng hoặc báo kết quả bị cắt do giới hạn độ dài.
- Đóng app sẽ dừng. Khi mở lại, đợt bị gián đoạn ở trạng thái đã dừng; người dùng bấm **Tiếp tục** để chạy tiếp. App không tự gọi AI ngay khi mở lại.
- Giới hạn: 8 MB nguồn / 1.000 kịch bản mỗi đợt; prompt sau thay thế tối đa 100.000 ký tự/mục; tổng văn bản kết quả tối đa 32 MB/đợt; tối đa 20 đợt đã lưu. Danh sách hiển thị 50 mục/trang.
- Lưu checkpoint bằng ghi file tạm rồi rename tại `DATA_DIR/script-converter/*.json`, thư mục 700 và file 600. Nội dung kịch bản được lưu dưới dạng văn bản; key đầy đủ và token Google không được lưu vào lịch sử chuyển đổi. Dữ liệu được bỏ qua bởi Git.
- App chọn **ID của key đã tạo** qua IPC tin cậy. API công khai `/v1` vẫn bắt buộc key đầy đủ trong `Authorization: Bearer`; ID không dùng thay key để gọi API công khai.

Khi xuất một đợt còn lỗi/chưa xử lý, các mục đó giữ nội dung gốc. File Word `.doc` là HTML tương thích Word như dự án nguồn, hỗ trợ chữ đậm/nghiêng và link HTTP(S); nguồn và kết quả AI được escape trước khi tạo HTML.

Quota, quyền tài khoản và độ dài model vẫn do Antigravity quyết định. Khi kịch bản quá dài, chia nhỏ hoặc chọn model phù hợp rồi chạy lại mục lỗi.

## Kiểm tra

```bash
npm run build
npm run test:script-converter
npm run test:script-converter-ui
```

Kiểm thử backend có lô 1.000 kịch bản, checkpoint, retry/cooldown, abort, resume, thu hồi key và bảo vệ endpoint. Kiểm thử Electron dùng backend thật và phản hồi Antigravity giả lập, kiểm tra nhập file, chuyển màn hình, model/key, xuất file, xóa lịch sử, phân trang và giao diện sáng/tối ở 375, 768, 1280 px. Chưa xác minh tài khoản/model Google thực tế.
