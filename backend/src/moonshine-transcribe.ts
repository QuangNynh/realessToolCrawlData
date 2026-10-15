// moonshine-voice is pinned to 0.1.5. Its typed C ABI feeds NumPy buffers and
// reads only new completed lines. The Python convenience Stream copies every
// historical transcript line (and, by default, its PCM) on each update.
export const moonshineTranscribe = String.raw`
import ctypes
import hashlib
import json
import math
import os
import platform
import sys
import time
from pathlib import Path
import numpy as np
from moonshine_voice import Transcriber, ModelArch, get_model_for_language
from moonshine_voice.errors import check_error
from moonshine_voice.moonshine_api import TranscriptC

if sys.platform == "darwin" and platform.machine() != "arm64":
    raise RuntimeError("Moonshine requires native arm64 Python, not Rosetta")

output_path, cache_path, language, model = sys.argv[1:]
architectures = {
    "tiny-streaming": ModelArch.TINY_STREAMING,
    "small-streaming": ModelArch.SMALL_STREAMING,
    "medium-streaming": ModelArch.MEDIUM_STREAMING,
}
started = time.perf_counter()
last_progress = {}

def progress(stage, **values):
    record = {"stage": stage, **values}
    if last_progress.get(stage) != record:
        print("LENYT_MOONSHINE=" + json.dumps(record), flush=True)
        last_progress[stage] = record

def timestamp(milliseconds):
    hours, remainder = divmod(milliseconds, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"

progress("download", progress=0)
model_path, model_arch = get_model_for_language(
    wanted_language=language, wanted_model_arch=architectures[model],
    cache_root=Path(cache_path),
    on_progress=lambda fraction, name: progress("download", progress=min(99, int(fraction * 100))),
)
download_finished = time.perf_counter()
# The SDK bundles its own ORT; options for a separate Python onnxruntime package
# cannot change it. CPU avoids partition/compile costs for the shipped graphs.
requested_provider = os.environ.get("LENYT_MOONSHINE_PROVIDER", "cpu").lower()
if requested_provider not in ("cpu", "coreml"):
    raise RuntimeError("LENYT_MOONSHINE_PROVIDER must be cpu or coreml")
provider = "CoreML,CPU" if requested_provider == "coreml" and sys.platform == "darwin" else "CPU"
options = {
    "ort_providers": provider,
    "return_audio_data": "false",
    "decode_incomplete_lines": "false",
    "identify_speakers": "false",
    "word_timestamps": "false",
    "vad_max_segment_duration": 15.0,
}
if language in ("ja", "zh"):
    options["max_tokens_per_second"] = 13.0
if provider == "CoreML,CPU":
    cache_key = hashlib.sha256(("0.1.5:" + str(Path(model_path).resolve())).encode()).hexdigest()
    coreml_cache = Path(cache_path).parent / "coreml" / cache_key
    coreml_cache.mkdir(parents=True, exist_ok=True)
    options["coreml_cache_dir"] = str(coreml_cache)
progress("backend", provider=provider)
backend_fallback = False
try:
    transcriber = Transcriber(model_path=model_path, model_arch=model_arch, options=options)
except Exception:
    if provider != "CoreML,CPU":
        raise
    # SDK wheels differ in compiled EP support. A missing provider/compilation
    # failure must not break the CPU path or be reported as successful CoreML.
    backend_fallback = True
    provider = "CPU"
    options["ort_providers"] = provider
    options.pop("coreml_cache_dir", None)
    progress("backend", provider=provider, fallback=True)
    transcriber = Transcriber(model_path=model_path, model_arch=model_arch, options=options)
loaded = time.perf_counter()
lib, handle = transcriber._lib, transcriber._handle
stream = None
consumed = 0
emitted = 0
count = 0
size = 0
rate = 16000
block_bytes = rate * 5 * 4  # 5 seconds of float32, independent of file length.
peak_input_bytes = 0
decode_wait = 0.0
inference_time = 0.0

try:
    stream = lib.moonshine_create_stream(handle, 0)
    if stream < 0:
        check_error(stream)
    check_error(lib.moonshine_start_stream(handle, stream))
    with open(output_path, "w", encoding="utf-8", newline="\n") as output:
        def collect():
            global emitted, count, size
            result = ctypes.POINTER(TranscriptC)()
            check_error(lib.moonshine_transcribe_stream(handle, stream, 0, ctypes.byref(result)))
            if not result:
                return
            transcript = result.contents
            # Native indices are stable; completed text is immutable with
            # diarization/spelling off. Never revisit the previous PCM.
            while emitted < transcript.line_count:
                line = transcript.lines[emitted]
                if not line.is_complete:
                    break
                emitted += 1
                text = " ".join(ctypes.string_at(line.text).decode("utf-8").split()) if line.text else ""
                if not text or not math.isfinite(line.start_time) or not math.isfinite(line.duration):
                    continue
                start = max(0, round(line.start_time * 1000))
                end = min(round(consumed / rate * 1000), round((line.start_time + line.duration) * 1000))
                if end <= start:
                    continue
                count += 1
                block = f"{count}\n{timestamp(start)} --> {timestamp(end)}\n{text}\n\n"
                size += len(block.encode("utf-8"))
                if size > 8 * 1024 * 1024:
                    raise RuntimeError("Subtitle output exceeds 8 MB")
                output.write(block)

        progress("transcribe", seconds=0)
        while True:
            before_read = time.perf_counter()
            raw = sys.stdin.buffer.read(block_bytes)
            decode_wait += time.perf_counter() - before_read
            if not raw:
                break
            if len(raw) % 4:
                raise RuntimeError("Truncated PCM float32 input")
            peak_input_bytes = max(peak_input_bytes, len(raw))
            samples = np.frombuffer(raw, dtype="<f4")
            # Keep both bytes and view alive until this synchronous call returns.
            # No Python scalar list or ctypes array copy.
            before_inference = time.perf_counter()
            check_error(lib.moonshine_transcribe_add_audio_to_stream(
                handle, stream, samples.ctypes.data_as(ctypes.POINTER(ctypes.c_float)),
                len(samples), rate, 0,
            ))
            consumed += len(samples)
            collect()
            inference_time += time.perf_counter() - before_inference
            progress("transcribe", seconds=round(consumed / rate, 3))
        if not consumed:
            raise RuntimeError("Audio is empty")
        # SDK 0.1.5 does not flush an empty pending stream on stop. Queue one
        # silent VAD hop (512 samples) so it also consumes a partial final hop
        # and decodes unfinished speech. Do not count padding as source audio;
        # all subtitle endpoints remain clamped to the actual sample count.
        before_inference = time.perf_counter()
        padding = np.zeros(512, dtype="float32")
        check_error(lib.moonshine_transcribe_add_audio_to_stream(
            handle, stream, padding.ctypes.data_as(ctypes.POINTER(ctypes.c_float)),
            len(padding), rate, 0,
        ))
        check_error(lib.moonshine_stop_stream(handle, stream))
        collect()
        inference_time += time.perf_counter() - before_inference
        if not count:
            raise RuntimeError("Không nhận dạng được lời nói trong file này")
    finished = time.perf_counter()
    metrics = {
        "audioSeconds": round(consumed / rate, 3),
        "modelSeconds": round(download_finished - started, 3),
        "loadSeconds": round(loaded - download_finished, 3),
        "inferenceSeconds": round(inference_time, 3),
        "decodeWaitSeconds": round(decode_wait, 3),
        "streamSeconds": round(finished - loaded, 3),
        "totalSeconds": round(finished - started, 3),
        "rtf": round((finished - started) / (consumed / rate), 5),
        "peakInputBytes": peak_input_bytes,
        "lines": count,
        "architecture": platform.machine(),
        "provider": provider,
        "backendFallback": backend_fallback,
    }
    try:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        metrics["peakRssMb"] = round(rss / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)
    except ImportError:
        pass  # Windows has no resource module.
    print("LENYT_MOONSHINE_METRICS=" + json.dumps(metrics), flush=True)
finally:
    if stream is not None and stream >= 0:
        lib.moonshine_free_stream(handle, stream)
    transcriber.close()
`;
