# Phát hành và cập nhật CrawlData

Mã nguồn phát hành có Git riêng tại `release-repo/` của workspace này, với remote `https://github.com/QuangNynh/realessToolCrawlData.git`. Repo gốc `yt-desktop` giữ nguyên. Làm việc và chạy các lệnh version/tag bên trong `release-repo/` để workflow GitHub Actions nhận đúng commit. Repo GitHub phải công khai để app đọc release mà không chứa token.

## Cấu trúc update

React gọi `window.electron.updater` do `electron/preload.ts` cung cấp qua `contextBridge`. Main process dùng `electron-updater` và chỉ nhận IPC từ cửa sổ ứng dụng. `autoDownload` và `autoInstallOnAppQuit` đều tắt. Người dùng chủ động kiểm tra, tải, rồi bấm khởi động lại để cài. Không có yêu cầu cập nhật nào trong `npm run dev`.

Ứng dụng Windows dùng NSIS và `latest.yml`; macOS dùng DMG + ZIP và `latest-mac.yml`. ZIP cần thiết cho trình cập nhật macOS. Các manifest chứa URL và SHA-512 của file tải; `.blockmap` hỗ trợ tải phần thay đổi. File portable Windows không dùng để update. Không đổi `appId` và đường dẫn `userData` giữa các bản để giữ dữ liệu người dùng.

## Điều kiện trước bản phát hành đầu tiên

Trong GitHub repo, đặt các Actions secrets sau:

- `MAC_CSC_LINK`: nội dung base64 của chứng chỉ Developer ID Application `.p12`.
- `MAC_CSC_KEY_PASSWORD`: mật khẩu `.p12`.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: thông tin notarization của Apple.

Workflow sẽ dừng trước khi publish nếu thiếu các secrets macOS, vì ứng dụng macOS phải được ký để auto update hoạt động. Có thể thêm `WIN_CSC_LINK` và `WIN_CSC_KEY_PASSWORD` để ký Windows, giúp tránh cảnh báo SmartScreen; không commit chứng chỉ hoặc token. GitHub Actions dùng `GITHUB_TOKEN` với quyền `contents: write` chỉ ở job publish. Nếu policy repo chặn quyền ghi, bật quyền cho Actions trong Settings → Actions → General.

## Build và phát hành

Ở máy phát triển:

```bash
npm ci
npm run dev       # backend + Vite + Electron, không gọi update
npm run build     # chỉ biên dịch, không tạo installer
npm run dist      # NSIS trên Windows; DMG + ZIP trên macOS, không upload
```

Để phát hành từ repo riêng, đặt version mới bằng một trong các lệnh dưới đây tại `release-repo/`:

```bash
npm version patch   # 1.0.1 -> 1.0.2
# hoặc: npm version minor  # 1.0.1 -> 1.1.0
git push origin main --follow-tags
```

`npm version` tự sửa `package.json`/`package-lock.json`, tạo commit và tag `v<version>`; không tạo lại tag bằng tay. Workflow kiểm tra tag trùng version, chạy `npm ci`, build riêng trên Windows và macOS, ký/notarize macOS, rồi tạo GitHub Release kèm `.exe`, `.dmg`, `.zip`, `latest.yml`, `latest-mac.yml`, `.blockmap`. Chỉ published release phiên bản cao hơn bản đã cài và cùng kênh stable mới được nhận diện. Draft/prerelease không hiện vì app tắt `allowPrerelease`.

Lệnh `npm run release` có thể publish trực tiếp từ máy hiện tại khi đã đặt `GH_TOKEN`; khuyến nghị dùng tag + Actions để không lưu PAT trên máy. CI chỉ phát hành một lần sau khi cả hai nền tảng build thành công.

## Thử cập nhật

1. Phát hành bản baseline đã tích hợp updater, ví dụ `v1.0.1`, rồi cài NSIS trên Windows hoặc DMG đã ký/notarize trên macOS.
2. Phát hành `v1.0.2` bằng tag tương ứng và chờ GitHub Actions hoàn tất.
3. Mở bản `1.0.1` → Settings / About → Check for Updates → Download Update → Restart and Install.
4. Xác nhận bản mở lại là `1.0.2`. Test trên app cài đặt thật; `npm run dev` không có `app-update.yml` và cố ý không update.

## Khi có lỗi

- `latest.yml` hoặc `latest-mac.yml` không thấy/404: kiểm tra chúng nằm trong **published** GitHub Release cùng installer/ZIP và bản app có `app-update.yml` đúng repo.
- GitHub 403: kiểm tra repo công khai; workflow cần `contents: write` để publish. Không nhúng token vào app.
- Có release nhưng không thấy bản mới: kiểm tra tag/version theo SemVer, release không ở trạng thái draft/prerelease, cùng `appId` và kiến trúc hệ điều hành. Tăng version trước mỗi lần phát hành.
- Thiếu installer/ZIP hoặc download gián đoạn: upload lại đầy đủ asset và manifest của **cùng một build**. Dữ liệu tải lỗi không được cài.
- NSIS không cài được: kiểm tra quyền ghi, dung lượng ổ đĩa, antivirus và chữ ký Windows. Thử lại sau khi đóng app; app cũ vẫn dùng được.
- macOS tải xong nhưng không cài: kiểm tra ký Developer ID và notarization, cùng bundle ID/chứng chỉ cho hai phiên bản; DMG đơn lẻ không đủ, cần ZIP.
