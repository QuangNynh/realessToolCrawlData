# API tạo ảnh Gemini 3.1 Flash Image

Tài liệu theo source CrawlData v1.0.25. Model: `ag/gemini-3.1-flash-image`.

## 1. Chuẩn bị

1. Mở CrawlData → **AI / Antigravity**, kết nối tài khoản Google.
2. Tạo API key trong app và lưu lại key đầy đủ. Đây là key CrawlData, không phải Google API key.
3. Bấm **Làm mới models**, kiểm tra có `ag/gemini-3.1-flash-image`. App chỉ cho gọi model được API Antigravity trả về cho tài khoản; quyền sử dụng và quota do Google quyết định.
4. Giữ app/backend chạy trong lúc gọi API.

| Chế độ | Base URL |
| --- | --- |
| App đã cài | `http://127.0.0.1:8696/v1` |
| `npm run dev` / `yarn dev` | `http://127.0.0.1:8695/v1` |

Dùng Base URL hiển thị trên màn AI nếu đã đổi cổng. Ví dụ bên dưới dùng cổng 8696. API tạo ảnh hiện đi qua **Chat Completions**, chưa có `/v1/images/generations` hay `/v1/images/edits`.

## 2. Kiểm tra model

Thiết lập biến môi trường trên macOS/Linux:

```sh
export CRAWLDATA_BASE_URL='http://127.0.0.1:8696/v1'
export CRAWLDATA_API_KEY='YOUR_API_KEY'
```

Trên PowerShell:

```powershell
$env:CRAWLDATA_BASE_URL = 'http://127.0.0.1:8696/v1'
$env:CRAWLDATA_API_KEY = 'YOUR_API_KEY'
```

Đọc danh sách model (PowerShell dùng `curl.exe` thay `curl`):

```sh
curl "$CRAWLDATA_BASE_URL/models" \
  -H "Authorization: Bearer $CRAWLDATA_API_KEY"
```

Phải tìm thấy `data[].id` bằng `ag/gemini-3.1-flash-image`. Không tự thêm model khi danh sách không có. Danh sách cache tối đa 5 phút; nút **Làm mới models** bỏ qua cache.

## 3. Tạo ảnh từ prompt

```sh
curl "$CRAWLDATA_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $CRAWLDATA_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "model": "ag/gemini-3.1-flash-image",
    "messages": [{
      "role": "user",
      "content": "Tạo một ảnh minh họa quán cà phê bên hồ vào buổi sáng, màu ấm, không có chữ, bố cục ngang 16:9."
    }],
    "stream": false
  }' \
  --output response.json
```

`response.json` là JSON chứa ảnh base64, không phải file PNG. Cần giải mã như mục 5. Model có thể trả cả text và ảnh; luôn kiểm tra có phần `image_url` trước khi coi yêu cầu thành công.

## 4. Định dạng response

Ví dụ minh họa, phần base64 đã rút gọn:

```json
{
  "object": "chat.completion",
  "model": "ag/gemini-3.1-flash-image",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "Ảnh được tạo theo yêu cầu." },
        {
          "type": "image_url",
          "image_url": { "url": "data:image/png;base64,..." }
        }
      ]
    },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

Text/usage thực tế tùy phản hồi upstream; số 0 trên chỉ minh họa cấu trúc. Duyệt tất cả phần tử `choices[0].message.content` để lấy ảnh. Đuôi file nên theo MIME thực tế trong data URL.

## 5. Python: gọi API và lưu ảnh

Không cần cài thư viện ngoài. Lưu đoạn sau thành `generate_image.py`, cấu hình hai biến môi trường ở mục 2 rồi chạy `python3 generate_image.py` (Windows: `python generate_image.py`). File ảnh lưu tại thư mục đang chạy.

```python
import base64
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base_url = os.environ.get("CRAWLDATA_BASE_URL", "http://127.0.0.1:8696/v1").rstrip("/")
api_key = os.environ["CRAWLDATA_API_KEY"]
content = [{"type": "text", "text": "Tạo ảnh một chú mèo bên cửa sổ, ánh sáng buổi sáng, không có chữ."}]

# Tùy chọn: chỉnh ảnh có sẵn. Đổi prompt bên trên thành yêu cầu chỉnh ảnh.
# source = Path("input.png")
# content.append({"type": "image_url", "image_url": {
#     "url": "data:image/png;base64," + base64.b64encode(source.read_bytes()).decode("ascii")
# }})

payload = {
    "model": "ag/gemini-3.1-flash-image",
    "messages": [{"role": "user", "content": content}],
    "stream": False,
}
request = Request(
    base_url + "/chat/completions",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Authorization": "Bearer " + api_key, "Content-Type": "application/json"},
    method="POST",
)
try:
    with urlopen(request, timeout=210) as response:
        result = json.load(response)
except HTTPError as error:
    raise SystemExit(f"HTTP {error.code}: {error.read().decode('utf-8', errors='replace')}")

parts = result["choices"][0]["message"].get("content")
if not isinstance(parts, list):
    raise SystemExit(f"API không trả ảnh: {parts}")
count = 0
for part in parts:
    if part.get("type") == "text":
        print(part.get("text", ""))
    if part.get("type") != "image_url":
        continue
    url = part["image_url"]["url"]
    header, encoded = url.split(",", 1)
    extensions = {"data:image/png;base64": ".png", "data:image/jpeg;base64": ".jpg", "data:image/webp;base64": ".webp"}
    if header not in extensions:
        raise SystemExit("MIME ảnh chưa được ví dụ này hỗ trợ: " + header)
    count += 1
    output = Path(f"generated-{count}{extensions[header]}")
    output.write_bytes(base64.b64decode(encoded, validate=True))
    print("Đã lưu:", output.resolve())
if not count:
    raise SystemExit("Model không trả ảnh; kiểm tra nội dung phản hồi và finish_reason.")
```

Với ảnh đầu vào, MIME phải đúng định dạng thực tế; đổi `image/png` thành `image/jpeg` nếu dùng JPG. Hỗ trợ nhiều ảnh bằng cách thêm các phần `image_url`. Chỉ nhận data URL base64, chưa hỗ trợ URL HTTP của ảnh.

## 6. Tham số và giới hạn hiện tại

- `model`: dùng ID từ `/v1/models`; cũng chấp nhận `gemini-3.1-flash-image` không có tiền tố `ag/`.
- `messages`: chuỗi text hoặc mảng `text`/`image_url` như ví dụ.
- Nên dùng `stream: false` cho ảnh. Nếu bật streaming, server vẫn chờ tạo ảnh xong rồi chuyển kết quả thành SSE; không có ảnh xem trước theo tiến độ.
- `temperature`: 0–2; `top_p`: 0–1; `max_tokens` hoặc `max_completion_tokens`: 1–64.000. Đây là giới hạn token, không phải độ phân giải ảnh.
- `n`: chỉ hỗ trợ 1. Không bảo đảm mỗi phản hồi luôn có đúng một ảnh; client nên duyệt toàn bộ content.
- Chưa ánh xạ các tham số `size`, `quality`, `aspect_ratio`, `image_config`, `response_modalities` hoặc `response_format: "b64_json"`. Các trường không hỗ trợ có thể bị bỏ qua; không dựa vào chúng. App tự yêu cầu cả TEXT và IMAGE với model ảnh. Có thể mô tả bố cục/tỉ lệ trong prompt, nhưng đó không phải cấu hình kích thước được bảo đảm.
- Request Chat Completions giới hạn khoảng 8 MB JSON, gồm base64 (base64 lớn hơn file gốc khoảng 33%). Giảm dung lượng ảnh nguồn nếu cần.
- Thời gian chờ upstream là 180 giây; client nên đặt cao hơn, ví dụ 210 giây. Proxy public có thể hết thời gian sớm hơn; nên gọi localhost khi dùng trên cùng máy.

## 7. Xử lý lỗi

| Tình huống | Xử lý |
| --- | --- |
| Không kết nối được localhost | Mở app/backend, kiểm tra đúng cổng. |
| HTTP 401 | Kiểm tra key CrawlData còn hiệu lực; nếu lỗi phiên Google, kết nối lại Antigravity. |
| HTTP 404 / `model_not_found` | Làm mới models và dùng đúng ID đang được tài khoản trả về. |
| HTTP 403/429 | Kiểm tra quyền/quota; nếu có `Retry-After`, chờ theo giá trị đó. |
| HTTP 400 | Kiểm tra JSON, định dạng messages, data URL và tham số. |
| HTTP 413 | Giảm dung lượng JSON/ảnh đầu vào. |
| HTTP 502/504, mất kết nối | Kiểm tra backend và phản hồi upstream; chỉ retry có giới hạn, vì yêu cầu trước có thể đã được xử lý. |
| HTTP 200 nhưng không có ảnh | Đọc text và `finish_reason`; `content_filter` có thể chỉ ra nội dung bị chặn. Không lưu JSON thành PNG. |

Không ghi API key hoặc toàn bộ base64 vào log. Không đặt key vào frontend website công khai; khi tích hợp web, giữ key ở backend riêng.

Source tham chiếu: `backend/src/ai-routes.ts`, `backend/src/ai-gateway.ts`, `backend/src/antigravity-format.ts`.
