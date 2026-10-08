# AI / Antigravity trong CrawlData

## Sử dụng

1. Mở **AI / Antigravity** trong thanh điều hướng.
2. Bấm **Kết nối Antigravity**. Đăng nhập tài khoản Google và cấp quyền trong trình duyệt hệ thống. Quay lại app để xem trạng thái kết nối.
3. Bấm **Tạo API key**, sao chép key mới và lưu ở nơi riêng. Key chỉ hiển thị đầy đủ ngay sau khi tạo.
4. Chọn model từ danh sách hoặc phần **Gọi thử bằng API key**, nhập nội dung và bấm **Gọi model**.

App kết nối trực tiếp Google Antigravity. Không cần cài/chạy 9router. Một key dùng cho toàn bộ model mà tài khoản Antigravity trả về, gồm các model chat và tạo ảnh. Quyền truy cập và quota vẫn thuộc tài khoản Google đã kết nối. Kết nối Antigravity không cấp quyền sử dụng các nhà cung cấp khác trong 9router.

## API cho ứng dụng khác

Base URL của bản desktop đóng gói: `http://127.0.0.1:8696/v1`. Chế độ development dùng backend `http://127.0.0.1:8695/v1`. Dùng Base URL hiển thị trên màn AI để khớp chế độ đang chạy. App/backend cần đang mở; server chỉ lắng nghe loopback trên máy hiện tại.

```sh
curl http://127.0.0.1:8696/v1/models \
  -H 'Authorization: Bearer YOUR_API_KEY'

curl http://127.0.0.1:8696/v1/chat/completions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"model":"ag/MODEL_ID_FROM_MODELS","messages":[{"role":"user","content":"Xin chào"}],"stream":false}'
```

`GET /v1/models` trả về danh sách model lấy trực tiếp từ tài khoản, cache tối đa 5 phút. Bấm **Làm mới models** để cập nhật ngay. ID có dạng `ag/...`; API cũng chấp nhận ID gốc không có tiền tố `ag/`.

Danh sách chat lấy từ `agentModelSorts` của Google, kèm model tạo ảnh; các ID phục vụ tab/command và ID đã ngừng hỗ trợ trong `deprecatedModelIds` được loại khỏi lựa chọn. Nếu Google cung cấp `newModelId`, yêu cầu bằng ID cũ tự chuyển sang ID thay thế và phản hồi ghi model thực sự đã gọi. Ví dụ Google hiện thay `gemini-3.1-pro-high` bằng `gemini-pro-agent`. Model mặc định theo `defaultAgentModelId` của tài khoản. Cache lưu theo phiên bản cũ được làm mới một lần khi mở màn AI, giữ nguyên key và phiên đăng nhập.

Giao diện gọi qua Electron IPC, sau đó backend gửi API đến Google; request Google không xuất hiện trong tab Network của renderer. Terminal backend ghi endpoint, model, HTTP status và thời gian gọi, không ghi prompt, API key hoặc token. Lỗi HTTP từ Antigravity hiển thị thêm model và mã HTTP để phân biệt lỗi tham số với quota/quyền tài khoản.

`POST /v1/chat/completions` hỗ trợ tin nhắn system/developer/user/assistant/tool, tool calling, `temperature`, `top_p`, `max_tokens`/`max_completion_tokens`, `stop`, `response_format` JSON, và streaming SSE với `stream:true`. Chỉ hỗ trợ `n:1`. Ảnh đầu vào dùng `image_url` dạng `data:image/...;base64,...`; không tải URL ảnh từ mạng. Ảnh đầu ra trả về trong `message.content` dạng `image_url`. Giữ `tool_calls[].extra_content.google.thought_signature` khi gửi lịch sử tool calling lại cho model cần chữ ký đó.

Thu hồi key khiến các yêu cầu mới bằng key đó trả về HTTP 401. Ngắt kết nối xóa phiên Google và cache model nhưng giữ các key cá nhân để có thể kết nối lại. HTTP 429/quota và `Retry-After` được chuyển về client, không tự đổi tài khoản hoặc lặp gọi để vượt giới hạn.

## Lưu trữ và OAuth

Dữ liệu nằm trong `DATA_DIR/ai-gateway/`: `state.enc` mã hóa AES-256-GCM và `encryption.key` là khóa mã hóa cục bộ. Cả hai chỉ cho chủ sở hữu đọc/ghi trên hệ điều hành hỗ trợ quyền POSIX. Key API được tạo bằng 32 byte ngẫu nhiên, chỉ lưu SHA-256 hash. API quản lý chỉ nhận qua Electron IPC hoặc internal POST từ loopback không có Origin. Token Google không được gửi xuống renderer.

Đăng nhập dùng trình duyệt hệ thống, callback loopback cổng ngẫu nhiên, state và PKCE S256; hết thời gian sau 5 phút. Access token tự được làm mới bằng refresh token, các yêu cầu đồng thời dùng chung lần làm mới. Có thể đặt `ANTIGRAVITY_CLIENT_ID` và `ANTIGRAVITY_CLIENT_SECRET` để dùng cấu hình OAuth client tương thích khác. Client mặc định là cấu hình installed-app công khai mà Antigravity/9router sử dụng; đây là định danh ứng dụng, không phải thông tin đăng nhập cá nhân.

Tài khoản cần được Google cấp quyền Antigravity/Code Assist và project hợp lệ. Đăng nhập thực tế cần người dùng hoàn tất consent Google; kiểm thử tự động không sử dụng tài khoản thật.

## Nguồn giao thức

Triển khai trong dự án được viết bằng TypeScript, tham khảo các hằng số/giao thức trong dự án 9router (MIT):

- [OAuth provider](https://github.com/decolua/9router/blob/master/src/lib/oauth/providers/antigravity.js)
- [Provider registry và các endpoint](https://github.com/decolua/9router/blob/master/open-sse/providers/registry/antigravity.js)
- [Public installed-app client](https://github.com/decolua/9router/blob/master/open-sse/providers/shared.js)
- [Antigravity executor](https://github.com/decolua/9router/blob/master/open-sse/executors/antigravity.js)
- [Google OAuth cho desktop](https://developers.google.com/identity/protocols/oauth2/native-app)

## Kiểm tra

`npm run test:ai` build backend và kiểm tra key, OAuth, lưu trữ, phát hiện model, làm mới token, chat, tool calling, ảnh và SSE bằng upstream giả lập. Sau khi build frontend/Electron, `npm run test:ai-ui` kiểm tra màn AI trong Electron bằng dữ liệu giả lập ở nhiều kích thước và hai theme.
