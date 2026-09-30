# Push bản phát hành CrawlData lên GitHub

Repo dùng để phát hành: [QuangNynh/realessToolCrawlData](https://github.com/QuangNynh/realessToolCrawlData). Mã nguồn phát hành và `.git` riêng nằm trong thư mục `release-repo/`. **Chạy mọi lệnh Git và đổi version bên dưới trong thư mục này**, không chạy ở thư mục project cha (`lenytdesktop`), vì project cha đang dùng repo Git khác.

## 1. Chuẩn bị một lần trước khi phát hành

1. Vào repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Thêm đủ 5 secrets cho bản macOS:

   | Secret | Giá trị |
   | --- | --- |
   | `MAC_CSC_LINK` | Nội dung base64 của chứng chỉ **Developer ID Application** dạng `.p12` |
   | `MAC_CSC_KEY_PASSWORD` | Mật khẩu của file `.p12` |
   | `APPLE_ID` | Email Apple Developer |
   | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password của Apple ID |
   | `APPLE_TEAM_ID` | Team ID Apple Developer |

3. Nếu có chứng chỉ ký Windows, thêm `WIN_CSC_LINK` và `WIN_CSC_KEY_PASSWORD`. Hai secret này hiện là tùy chọn; Windows không ký vẫn build được nhưng có thể bị SmartScreen cảnh báo.
4. Đảm bảo repo GitHub **public** để app đọc Releases mà không cần nhúng token. Workflow dùng `GITHUB_TOKEN` do GitHub cấp, không cần tạo PAT hay commit token. Nếu job `publish` bị từ chối quyền, kiểm tra **Settings → Actions → General → Workflow permissions** và quyền `contents: write` trong workflow.

Workflow hiện tại chỉ đăng GitHub Release khi **cả Windows và macOS** build xong. Thiếu một trong 5 secrets macOS thì job macOS dừng và sẽ không có release mới; đây là chủ ý để tránh phát hành bản Mac không thể tự cập nhật.

## 2. Push bản đầu tiên: v1.0.2

Phiên bản trong `package.json` hiện là `1.0.2`. Sau khi thiết lập secrets, chạy:

```bash
cd /Users/quangnynh/Desktop/project/lenytdesktop/release-repo
git status --short
git pull --ff-only origin main
git tag v1.0.2
git push origin v1.0.2
```

`git status --short` nên không in gì trước khi tạo tag. **Không chạy `npm version patch` cho lần đầu**, vì lệnh đó sẽ đổi `1.0.2` thành `1.0.3`.

Sau khi push tag, xem tiến độ tại [GitHub Actions](https://github.com/QuangNynh/realessToolCrawlData/actions). Workflow sẽ tự checkout tag, `npm ci`, build NSIS Windows, build + ký/notarize macOS, kiểm tra hash file và tạo [GitHub Release](https://github.com/QuangNynh/realessToolCrawlData/releases).

Release thành công phải có ít nhất:

```text
CrawlData-Setup-1.0.2.exe
CrawlData-Setup-1.0.2.exe.blockmap
latest.yml
CrawlData-1.0.2-arm64.dmg
CrawlData-1.0.2-arm64-mac.zip
latest-mac.yml
*.blockmap cho macOS
```

`latest.yml` và `latest-mac.yml` là metadata mà app đọc để biết bản mới và kiểm tra SHA-512. `.blockmap` hỗ trợ tải phần thay đổi. Không upload các file của nhiều lần build khác nhau vào cùng một release.

## 3. Push bản cập nhật tiếp theo

Sửa code **trong `release-repo/`**, chạy test, rồi commit thay đổi trước khi tăng version:

```bash
cd /Users/quangnynh/Desktop/project/lenytdesktop/release-repo
npm ci
npm run build
npm run test:updater
git add .
git commit -m "Describe the changes"
npm version patch
git push origin main --follow-tags
```

Ví dụ: `npm version patch` đổi `1.0.2` → `1.0.3`. Muốn đổi `1.0.2` → `1.1.0`, dùng `npm version minor` thay cho `patch`. `npm version` **tự tạo commit và tag**; không chạy thêm `git tag v1.0.3` hoặc tạo commit version thủ công. `--follow-tags` push cả commit trên `main` và tag mới, kích hoạt workflow phát hành.

Nếu bạn vẫn sửa code ở project cha, phải chép các file đã sửa sang `release-repo/` và kiểm tra diff tại đó **trước khi commit**. Repo phát hành không tự đồng bộ với repo Git của project cha.

## 4. Kiểm tra cập nhật trong app

1. Cài bản **1.0.2 từ GitHub Release** trên Windows bằng NSIS `.exe` hoặc trên macOS bằng DMG đã ký. Các bản 1.0.1 cũ chưa có updater nên phải cài bản nền 1.0.2 thủ công một lần.
2. Phát hành `v1.0.3` theo mục 3 và chờ workflow hoàn thành.
3. Mở app 1.0.2 → **Settings / About → Check for Updates → Download Update → Restart and Install**.
4. App mở lại và hiển thị version 1.0.3. Bản `npm run dev` không kiểm tra update.

## Khi workflow hoặc update báo lỗi

| Triệu chứng | Kiểm tra |
| --- | --- |
| Workflow dừng ở macOS | Đủ 5 secrets macOS, chứng chỉ Developer ID còn hiệu lực và notarization thành công. |
| Workflow dừng ở `publish` với 403 | Quyền GitHub Actions `contents: write`; repo/tag đúng; `GITHUB_TOKEN` của workflow. |
| App báo GitHub 404 hoặc thiếu `latest.yml` | Release đã **Publish**, không ở trạng thái Draft; asset `latest.yml`/`latest-mac.yml` và installer/ZIP cùng version đều có mặt. |
| App không thấy bản mới | Version trên Release phải **lớn hơn** version đang cài; tag phải khớp `package.json`; không dùng prerelease. |
| Tải xong nhưng không cài được trên Mac | Kiểm tra chữ ký/notarization của cả hai bản và asset ZIP. |
| NSIS update thất bại | Kiểm tra quyền ghi, ổ đĩa còn trống và antivirus; thử lại khi app cũ đã đóng. |

Xem thêm [cấu hình và kiến trúc update](docs/releasing.md) hoặc [workflow đang chạy](.github/workflows/release.yml).
