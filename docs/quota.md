# Quota Antigravity

Màn **Quota** ở `/dashboard/quota` (cũng truy cập được bằng `/quota`) dùng cơ chế Antigravity của bản 9router 0.5.99 đang cài trên máy. Tài khoản lấy từ kết nối AI / Antigravity của CrawlData; không đọc token/key hay database tài khoản của 9router.

## Nguồn dữ liệu

- `loadCodeAssist` lấy gói tài khoản và project.
- `fetchAvailableModels` lấy `quotaInfo.remainingFraction`, `resetTime` của các model khả dụng. Giống 9router, quota từng model chỉ hiện cho paid tier.
- `retrieveUserQuotaSummary` lấy bucket Gemini và Claude & GPT theo `5h`/`daily` và `Weekly`. Bucket tuần bị disabled được bỏ qua; bucket session bị disabled có giá trị 0.
- Phần trăm còn lại = remainingFraction × 100; không suy từ số request, không giả định 100% nếu provider không trả quota. Không hiển thị số 1.000 của 9router như một hạn mức request thật: đó chỉ là thang chuẩn hóa phần trăm.
- Giống 9router, nếu toàn bộ quota model trong nhóm đã về 0 nhưng session summary còn dương, session hiển thị 0 và lấy reset muộn nhất từ các model trong nhóm để tránh hiển thị sai quota khả dụng.

## Làm mới và hiển thị

Tự cập nhật 60 giây, có đếm ngược, dừng gọi API khi tab/app document bị ẩn; khi hiện lại và đã đến hạn sẽ cập nhật. Lựa chọn tự làm mới, thu gọn, sắp xếp và các dòng ẩn được lưu trên máy. Có cache kết quả để hiện ngay khi mở lại màn với cùng email đã kết nối. Ngày cập nhật hiển thị rõ; thời gian reset được tính lại mỗi giây khi trang hiển thị.

Backend cache kết quả 60 giây; quota summary cache 3 phút như 9router. Cùng tài khoản chỉ có một request đang chạy. **Làm mới** thủ công bỏ qua cache. Cache gắn với ID kết nối và bị xóa khi disconnect; kết quả đến muộn từ tài khoản cũ không được đưa vào tài khoản mới. Access token được refresh theo gateway hiện có.

UI có tìm model/nhóm, sắp xếp mặc định/% thấp đến cao/% cao đến thấp, ẩn/hiện dòng, phân trang 10 dòng và chế độ thu gọn. % còn lại có thanh màu; hiển thị cả đếm ngược và ngày giờ reset. Thiếu dữ liệu hoặc quota API 401/403 được thông báo riêng vì chat có thể vẫn hoạt động.

Tích hợp hiện dùng Antigravity mà app đã hỗ trợ, không thêm provider hoặc tài khoản khác từ database 9router. Các tùy chọn auto-ping của Claude/Codex trong 9router không áp dụng cho Antigravity; đọc quota không phát sinh lời gọi sinh nội dung AI.

Mở lại Electron sau khi cập nhật main process để nhận thao tác `quota` mới.
