# Moonshine: pipeline audio dài trên Apple Silicon

## Kết quả đo trong workspace

Máy đo chạy Node, Electron, Python, FFmpeg, libmoonshine và libonnxruntime native arm64. `sysctl hw.perflevel0.physicalcpu` trả về **6 P-core**; không giả định mọi M1 Pro đều có 8 P-core. Model Tiny Streaming tiếng Anh đã được tải trước.

| Audio tổng hợp | Pipeline cũ | Pipeline mới |
| --- | ---: | ---: |
| Cùng file WAV khoảng 5 phút | 51,776 giây | 7,724 giây |
| WAV 61 phút 1,25 giây (đã có bản sửa flush EOF) | Không chạy lại toàn bộ bản cũ | 95,802 giây |

Mẫu 5 phút: hai bản đều trả 44 dòng, 658 từ; 653 từ trùng tại cùng vị trí, có khác biệt nhận dạng nên đây không phải chứng minh chất lượng tương đương trên mọi audio. Mẫu 61 phút: 535 dòng, có timestamp sau 1 giờ; Python báo RSS đỉnh 373,1 MiB, RTF 0,02614. Khối PCM lớn nhất đọc từ stdin là 320.000 byte, không phải toàn bộ bộ nhớ của model. Mẫu được lặp từ giọng hệ thống, có khoảng nghỉ; cần đo lại trên bản ghi thực tế, ngôn ngữ và model của người dùng. Kết quả không bao gồm tải model từ internet.

## Những điểm nghẽn đã tìm thấy

| Điểm trong source cũ | Chi phí | Thay đổi |
| --- | --- | --- |
| `return_audio_data` mặc định true, SDK `_parse_transcript()` duyệt mọi dòng rồi tạo `list(audio_array)` | PCM lịch sử bị chép lại ở mỗi lần cập nhật; lượng copy có thể tăng gần bậc hai theo thời lượng | `return_audio_data=false`; đọc C transcript từ chỉ số dòng mới, ghi dòng hoàn tất một lần |
| `create_stream(update_interval=1.0)` và giải mã câu chưa hoàn tất | Nhiều lượt decoder để tạo partial text không được dùng | Feed 5 giây/lượt; `decode_incomplete_lines=false` |
| `array('h')` → list comprehension float → ctypes array | Python xử lý từng sample và chép thêm buffer | FFmpeg xuất f32le; `np.frombuffer` → con trỏ C đồng bộ |
| Decode cả WAV rồi mới bắt đầu inference | Chờ một giai đoạn riêng, ghi/đọc lại PCM toàn file | FFmpeg stdout → Python stdin, backpressure, không WAV trung gian |
| Chưa ép kiến trúc Python được tìm thấy, lệnh package Mac chưa luôn có `--arm64` | Có thể chọn sai môi trường/binary khi đóng gói hoặc cài runtime | Probe `platform.machine()`, kiểm tra Mach-O, chọn slice arm64 khi spawn, build/afterPack kiểm tra arm64 |

IPC hiện tại vốn chỉ gửi ID/đường dẫn/metadata, không gửi audio từ Renderer. Model được load một lần mỗi file; trong lần đo dài, load mất khoảng 0,15 giây nên chưa cần thêm worker tồn tại lâu chỉ để xử lý điểm này.

Pipeline hiện tại (Node nối stdout/stdin bằng `stream.pipe()` có backpressure; không gom PCM vào một buffer lớn):

```text
Renderer --file IDs--> Electron/backend
FFmpeg arm64 --PCM f32le, 16 kHz mono, bounded pipe--> Python arm64
  --> NumPy view --> Moonshine C API / VAD --> completed text + native timestamps
  --> SRT/TXT on disk
```

VAD native có giới hạn câu 15 giây và được phép giữ câu đang dở qua nhiều khối input. Với `return_audio_data=false`, engine có thể giải phóng PCM của câu đã hoàn tất. SDK 0.1.5 không flush khi pending buffer rỗng: tại EOF app thêm một hop 512 sample im lặng, gọi stop rồi thu transcript lần cuối, tránh mất câu kết thúc ngay ở cuối file và phần sample lẻ chưa đủ một hop VAD. Padding không tính vào độ dài gốc; endpoint phụ đề được chặn tại sample cuối thật. Khoảng lặng được giữ trong timeline. Không dùng lọc năng lượng để bỏ audio vì có thể mất giọng nói nhỏ.

## Backend thực sự được sử dụng

`moonshine-voice==0.1.5` tải `libmoonshine` và **libonnxruntime riêng** bằng ctypes. Wheel đang cài trên máy này thực tế có thể đăng ký CoreML: thử khởi tạo đã ghi log phân vùng CoreML. Tài liệu nhánh main upstream lại mô tả binary CPU-only; không dùng tài liệu nhánh main để kết luận khả năng của mọi wheel. Cài `onnxruntime-silicon`, `onnxruntime` hoặc PyTorch và tạo `SessionOptions` khác không sửa các session đã được libmoonshine tạo. Xem [phân tích execution provider của upstream](https://github.com/moonshine-ai/moonshine/blob/main/docs/execution-providers.md).

App mặc định `CPU` cho throughput ổn định với graph quantized hiện tại. Có thể thử `LENYT_MOONSHINE_PROVIDER=coreml` khi khởi chạy backend/app từ terminal; runner dùng `ort_providers=CoreML,CPU`, cache riêng trong `data/moonshine-runtime/coreml/<hash SDK + đường dẫn model>/`. Nếu khởi tạo thất bại thì chuyển sang CPU; nếu inference thất bại thì backend dừng cả hai tiến trình, đọc lại file gốc và thử CPU đúng một lần. Metrics có `requestedProvider`, provider thực tế và `backendFallback`. Hủy tác vụ không kích hoạt thử lại. Windows dùng CPU. `provider=CoreML,CPU` cho biết cấu hình session, không có nghĩa mọi operator chạy trên ANE.

Thử thực tế trên cùng mẫu 30 giây: CPU hoàn thành trong 0,964 giây. CoreML load được trong khoảng 2,6 giây nhưng decoder lỗi vì `k_self` có shape `{6,1,8,0,40}` (zero elements), không được EP chấp nhận. Bản có fallback hoàn thành đủ 5 dòng bằng CPU trong 3,414 giây tổng cộng và ghi đúng `backendFallback=true`. Vì vậy chưa chọn CoreML làm mặc định cho model này. Phải có graph/KV cache tương thích và benchmark lại trước khi coi đó là đường tăng tốc.

Các model `.ort` quantized đã fusion của Moonshine cũng không phải artifact bảo đảm tối ưu cho CoreML. Muốn chuyển backend cần dùng graph phù hợp, ORT có CoreML, đo partition/profile và kiểm tra chất lượng. `MLComputeUnits=ALL` cho phép CoreML chọn CPU/GPU/ANE, không bảo đảm mọi operator chạy trên ANE. MPS là backend PyTorch cho GPU, không phải ANE.

### 1. Python sidecar Moonshine đang dùng trong app

```python
from moonshine_voice import Transcriber

transcriber = Transcriber(
    model_path=model_path,
    model_arch=model_arch,
    options={
        "ort_providers": "CPU",
        "return_audio_data": "false",
        "decode_incomplete_lines": "false",
        "identify_speakers": "false",
        "word_timestamps": "false",
        "vad_max_segment_duration": 15.0,
    },
)
# App feeds a single native stream in 5-second PCM blocks. VAD chooses
# sentence boundaries. See backend/src/moonshine-transcribe.ts.
```

SDK 0.1.5 **không expose** `intra_op_num_threads` qua Transcriber options. Vì vậy app không truyền một key vô hiệu rồi báo đã dùng P-core. `MOONSHINE_ORT_SINGLE_THREAD` chỉ ép một luồng, không nhận số luồng tùy ý. Muốn đặt đúng số P-core cho các session bên trong SDK cần rebuild libmoonshine với API cấu hình thread hoặc tự quản lý ORT sessions như ví dụ dưới. Xem [options SDK](https://moonshine-voice.readthedocs.io/en/latest/api/options/) và [ORT helper upstream](https://github.com/moonshine-ai/moonshine/blob/main/core/ort-utils/ort-utils.cpp).

### 2. Python ONNX Runtime tự quản lý session

Ví dụ khởi tạo cho một graph `.onnx` tương thích, **không phải backend đang bật trong app**. Dùng Python/ORT arm64 chính thức; kiểm tra provider thực tế thay vì phụ thuộc tên gói `onnxruntime-silicon`.

```python
import hashlib
import platform
import subprocess
from pathlib import Path
import onnxruntime as ort

assert platform.machine() == "arm64"
pcores = int(subprocess.check_output(
    ["/usr/sbin/sysctl", "-n", "hw.perflevel0.physicalcpu"], text=True
).strip())
assert pcores > 0

def create_session(model_file, cache_root):
    model_file = Path(model_file).resolve()
    with model_file.open("rb") as model:
        model_hash = hashlib.file_digest(model, "sha256").hexdigest()
    cache = Path(cache_root) / model_hash
    cache.mkdir(parents=True, exist_ok=True)
    options = ort.SessionOptions()
    options.intra_op_num_threads = pcores
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    providers = ["CPUExecutionProvider"]
    if "CoreMLExecutionProvider" in ort.get_available_providers():
        providers.insert(0, ("CoreMLExecutionProvider", {
            "ModelFormat": "MLProgram",
            "MLComputeUnits": "ALL",
            "RequireStaticInputShapes": "0",
            "ModelCacheDirectory": str(cache),
        }))
    session = ort.InferenceSession(
        str(model_file), sess_options=options, providers=providers
    )
    print("Session providers:", session.get_providers())
    return session
```

Session/provider được đăng ký không chứng minh operator đã chạy trên ANE; bật ORT profiling để kiểm tra. Với graph có shape cố định, benchmark thêm `RequireStaticInputShapes=1`. So sánh CPU 1/2/P-core luồng: decoder nhỏ tuần tự có thể chậm hơn khi tăng luồng. Cache theo hash model giúp không dùng nhầm compilation cũ khi thay trọng số. [CoreML EP](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html), [ORT threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html).

### 3. Node.js `onnxruntime-node`

Chạy trong worker/utility process, giữ session dùng lại; không đưa buffer audio toàn file qua Renderer IPC. Đây là phương án thay backend, chưa thêm dependency này vào app.

```javascript
import { execFileSync } from 'node:child_process';
import * as ort from 'onnxruntime-node';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Requires native macOS arm64 Node');
}
const pcores = Number(execFileSync('/usr/sbin/sysctl',
  ['-n', 'hw.perflevel0.physicalcpu'], { encoding: 'utf8' }).trim());
if (!Number.isInteger(pcores) || pcores < 1) throw new Error('Invalid P-core count');
const backends = ort.listSupportedBackends();
const coreml = backends.some(backend => backend.name === 'coreml' && backend.bundled);
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: coreml ? [{ name: 'coreml', coreMlFlags: 0x010 }, 'cpu'] : ['cpu'],
  intraOpNumThreads: pcores,
  interOpNumThreads: 1,
  executionMode: 'sequential',
  graphOptimizationLevel: 'all',
});
```

`coreMlFlags=0x010` chọn MLProgram và không bật CPU-only. Node binding dùng API flags; không gán bừa các key provider của Python như `ModelCacheDirectory` nếu phiên bản binding chưa hỗ trợ. [API Node CoreML](https://onnxruntime.ai/docs/api/js/interfaces/InferenceSession.CoreMLExecutionProviderOption.html).

### 4. C++ session cho Node native addon hoặc libmoonshine custom

Đây là phần cấu hình ORT trong addon, không phải một addon N-API hoàn chỉnh. Build Release với `CMAKE_OSX_ARCHITECTURES=arm64`, ORT arm64 có CoreML, gọi inference ngoài event loop. `cache_dir` cần là thư mục writable gắn với hash model.

```cpp
#include <algorithm>
#include <stdexcept>
#include <string>
#include <sys/sysctl.h>
#include <onnxruntime_cxx_api.h>

Ort::SessionOptions session_options(const std::string& cache_dir) {
  int pcores = 0;
  size_t size = sizeof(pcores);
  if (sysctlbyname("hw.perflevel0.physicalcpu", &pcores, &size, nullptr, 0) || pcores < 1)
    throw std::runtime_error("Cannot determine P-core count");
  Ort::SessionOptions options;
  options.SetIntraOpNumThreads(pcores);
  options.SetInterOpNumThreads(1);
  options.SetExecutionMode(ORT_SEQUENTIAL);
  options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
  const auto providers = Ort::GetAvailableProviders();
  if (std::find(providers.begin(), providers.end(), "CoreMLExecutionProvider") != providers.end()) {
    options.AppendExecutionProvider("CoreML", {
      {"ModelFormat", "MLProgram"}, {"MLComputeUnits", "ALL"},
      {"RequireStaticInputShapes", "0"}, {"ModelCacheDirectory", cache_dir},
    });
  }
  return options;
}
// Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "speech");
// auto options = session_options(cache_dir);
// Ort::Session session(env, model_path.c_str(), options);
```

Các ví dụ ORT/Python/Node/C++ cần graph encoder/decoder, KV cache, tokenizer và loop decode tương ứng với model. Khởi tạo một session không thay được toàn bộ Moonshine pipeline. Không cài thêm PyTorch/MPS vào sidecar hiện tại vì đường inference này không sử dụng PyTorch.
