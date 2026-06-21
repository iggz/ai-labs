# Mobile On-Device Inference — Learnings & Reference
> **Created:** 2026-06-19 | **Session:** iOS ONNX pose inference debugging
> **Codebase:** `/Users/iggypop/Documents/ai-labs/web/`
> **Live URL:** `https://ilovetoridemybicycle.com/ai-labs`

This document captures every bug, fix, workaround, and performance baseline discovered while implementing on-device YOLOv8s-pose inference for mobile browsers. **Load this file at the start of any future mobile on-device work.**

---

## 1. Platform Constraints (iOS)

### 1.1 All iOS browsers use WebKit
- Chrome, Brave, Firefox on iOS are **all WebKit under the hood** (Apple's App Store policy)
- This means Safari limitations = ALL iOS browser limitations
- Don't waste time testing Chrome vs Safari on iOS — they behave identically for WebAPIs

### 1.2 WebGPU shader compilation hangs indefinitely on iOS
- **Bug:** `ort.InferenceSession.create()` with `['webgpu']` succeeds, but the first `session.run()` hangs forever during shader compilation
- **Root cause:** iOS WebKit's WebGPU implementation cannot compile YOLOv8s-pose shaders at 640×640
- **Fix:** Skip WebGPU entirely on iOS. Detect with:
  ```js
  const _isIOS = typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
     (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1));
  ```
- **Location:** `web/src/lib/inference/onnxPoseInference.js` — `loadModel()` skips `'webgpu'` provider on iOS

### 1.3 SharedArrayBuffer NOT available on iOS
- Even with correct COOP/COEP headers, iOS WebKit does NOT support `SharedArrayBuffer`
- This means **WASM runs single-threaded** on iOS despite `hardwareConcurrency: 4`
- ONNX Runtime reports `wasmThreads: 4` but they're not actually parallel
- **Impact:** ~850ms/frame vs ~200-400ms with threads on desktop
- **Cannot be fixed** — this is a WebKit engine limitation

### 1.4 VideoEncoder silently drops all frames on iOS
- **Bug:** `VideoEncoder.isConfigSupported()` returns `true` on iOS
- Frames are accepted by `encoder.encode()` without error
- But the `output` callback is **never called** — zero chunks emitted
- The MP4 blob ends up empty (< 1KB)
- **Fix:** Skip `VideoEncoder` entirely on iOS. Use `source_video` output mode (show original video alongside stats)
- **Location:** `web/src/lib/inference/onDeviceInference.js` — encoder selection logic

### 1.5 decoderConfig null on keyframes (Safari VideoEncoder)
- When VideoEncoder DOES emit chunks (non-iOS Safari), keyframes often have `null` decoderConfig
- mp4-muxer v5 crashes on `track.info.decoderConfig.colorSpace` when decoderConfig is null
- **Fix:** Cache first valid decoderConfig and reuse for subsequent keyframes:
  ```js
  let cachedDecoderConfig = null;
  if (chunk.type === 'key') {
    if (meta?.decoderConfig) {
      cachedDecoderConfig = Object.fromEntries(
        Object.entries(meta.decoderConfig).filter(([, v]) => v != null)
      );
      meta = { ...meta, decoderConfig: cachedDecoderConfig };
    } else if (cachedDecoderConfig) {
      meta = { ...(meta || {}), decoderConfig: cachedDecoderConfig };
    }
  }
  ```

---

## 2. ONNX Runtime Web Bugs

### 2.1 Session poisoning after WebGPU timeout
- **Bug:** When WebGPU `session.run()` hangs and we timeout via `Promise.race`, the old session's in-flight run poisons global ONNX state
- Calling `forceWasm()` to create a new session fails with "Session already started"
- Subsequent frames throw "The object is in an invalid state"
- **Fix:** Don't call `session.release()` synchronously — it blocks if a run is in-flight:
  ```js
  const oldSession = _session;
  _session = null;  // null out FIRST
  _device = null;
  _sessionVersion++;
  // Fire-and-forget release — don't block
  setTimeout(() => { try { oldSession.release(); } catch {} }, 0);
  ```
- **Better fix:** Skip WebGPU entirely on iOS (see 1.2) so the timeout path is never hit

### 2.2 Kalman smoother holds stale angles on inference errors
- When `inferFrame()` fails, the Kalman angle smoother retains the last valid angle
- This causes "stuck" angles (e.g., 85° for 70 frames) which prevents rep detection
- **Symptom:** 0 reps detected despite correct initial descent
- **Root cause chain:** WebGPU poison → "invalid state" errors → no new keypoints → smoother holds last value

---

## 3. Video Pipeline

### 3.1 Frame capture via RVFC play-through
- `requestVideoFrameCallback` (RVFC) fires during video playback
- Frame estimate = `duration × OUT_FPS` (e.g., 6.4s × 15fps ≈ 96)
- **Actual capture is always less** — typically 80-85% of estimate
- Last ~200ms of video often doesn't fire callbacks before `ended` event
- The `~` prefix in UI ("~96 frames") communicates this is an estimate

### 3.2 Output format selection (user preference)
- User can choose MP4 or WebM in Settings → On-Device Output Format
- Stored in `localStorage` key: `formai_output_format` (default: `'webm'`)
- **Must be read from localStorage at call site** — not from child component state
- Decision flow:
  1. iOS → always `source_video`
  2. User chose WebM + MediaRecorder available → WebM
  3. User chose MP4 + VideoEncoder available → MP4 (mp4-muxer)
  4. MP4 preferred but unavailable → fall back to WebM
  5. Nothing available → `source_video` (show original)

### 3.3 Video encoding performance
- MP4 via VideoEncoder: works on desktop Chrome/Edge, NOT iOS
- WebM via MediaRecorder: works on desktop Chrome/Firefox, NOT iOS
- iOS gets `source_video` mode — original video shown alongside stats (no skeleton overlay)

---

## 4. Performance Baselines (iPhone 14 Pro, iOS 26.5)

| Phase | Duration | Notes |
|---|---|---|
| video_load | ~70ms | File → blob URL |
| video_canplay | ~35ms | (can be 5s if readyState=1) |
| model_load | ~400ms | Cached ONNX model (45MB) |
| capture | ~7s | 79 frames via RVFC at 1× speed |
| inference | ~67s | 79 × 849ms/frame (WASM single-thread) |
| finalize | ~0ms | |
| **Total** | **~75s** | For a 6.4-second video |

### Per-frame inference
- **WASM single-threaded (iOS):** ~850ms/frame at 640×640
- **WASM multi-threaded (desktop):** ~200-400ms/frame estimated
- **WebGPU (desktop):** ~50-100ms/frame estimated

### Optimization opportunities
- [ ] `playbackRate = 2.0` during capture → could halve capture time (7s → 3.5s)
- [ ] Reduce model input from 640 to 416 → ~2.4× faster inference
- [ ] Skip frames (every 2nd) → halve inference count
- [ ] WebGPU on Android Chrome (should work, unlike iOS)

---

## 5. Debug Logging Infrastructure

### 5.1 Client-side: DebugLogger
- **File:** `web/src/lib/inference/debugLogger.js`
- Activated via `?debug=1` URL parameter
- Captures: device fingerprint, phase timings, per-frame telemetry, errors, pipeline state
- Auto-POSTs to `/ai-labs/api/debug-log` on completion
- Download button appears on results screen

### 5.2 Server-side: Cloudflare KV
- **KV Namespace:** `DEBUG_LOGS` (binding in `wrangler.jsonc`)
- **TTL:** 7 days (604800 seconds)
- **API Routes** (in `src/index.js`):
  - `POST /ai-labs/api/debug-log` — store log
  - `GET /ai-labs/api/debug-logs` — list last 50
  - `GET /ai-labs/api/debug-log/:id` — retrieve full log

### 5.3 Retrieving logs from Mac
```bash
# List recent logs
curl -s 'https://ilovetoridemybicycle.com/ai-labs/api/debug-logs' | jq .

# Get latest log
LATEST=$(curl -s 'https://ilovetoridemybicycle.com/ai-labs/api/debug-logs' | jq -r '.[-1].key')
curl -s "https://ilovetoridemybicycle.com/ai-labs/api/debug-log/$LATEST" | jq .

# Quick summary
curl -s "https://ilovetoridemybicycle.com/ai-labs/api/debug-log/$LATEST" | python3 -c "
import json, sys; d = json.load(sys.stdin)
for name, p in d['phases'].items():
    print(f'{name:20s} {p[\"duration\"]:>8,}ms')
print(f'Result: {d[\"pipeline\"][\"result\"]}')"
```

---

## 6. Key Files

| File | Purpose |
|---|---|
| `web/src/lib/inference/onDeviceInference.js` | Main pipeline: capture → infer → encode → stats |
| `web/src/lib/inference/onnxPoseInference.js` | ONNX model loading, `inferFrame()`, `forceWasm()` |
| `web/src/lib/inference/debugLogger.js` | Client-side telemetry capture |
| `web/src/lib/inference/statsCalculator.js` | Computes stats from rep counter data |
| `web/src/lib/inference/repCounter.js` | Rep counting via angle state machine |
| `web/src/lib/inference/skeletonRenderer.js` | Draws skeleton on canvas |
| `web/src/lib/inference/videoEncoder.js` | VideoEncoder probe + create |
| `web/src/components/cv/FormAICoach.jsx` | Main UI component |
| `web/src/components/cv/FormStatsDashboard.jsx` | Stats dashboard with stat cards |
| `src/index.js` | Cloudflare Worker (COOP/COEP headers, debug API) |
| `wrangler.jsonc` | Worker config + KV binding |

---

## 7. Field Name Mapping (statsCalculator → Dashboard)

The dashboard expects specific field names. If you change `computeStats()`, match these:

| Dashboard expects | statsCalculator returns | Description |
|---|---|---|
| `depth_score_pct` | `depth_score_pct` | 0-100 score |
| `letter_grade` | `letter_grade` | A+, A, B+, etc. |
| `form_label` | `form_label` | "Excellent form" etc. |
| `avg_primary_angle` | `avg_primary_angle` | Average extremum angle |
| `best_rep_angle` | `best_rep_angle` | Best rep (lowest for squat, highest for deadlift) |
| `worst_rep_angle` | `worst_rep_angle` | Worst rep |
| `angle_std_dev` | `angle_std_dev` | For consistency card |
| `per_rep_angles` | `per_rep_angles` | Array of per-rep extremum angles |
| `avg_confidence` | `avg_confidence` | Detection confidence |
| `tempo_sec_per_rep` | `tempo_sec_per_rep` | Null on-device |

---

## 8. Common Pitfalls

1. **React component scoping:** Don't reference variables from child components in parent callbacks. Use `loadPref()` directly or lift state up.
2. **`session.release()` blocks:** Never call synchronously if a `run()` might be in-flight. Fire-and-forget with `setTimeout`.
3. **VideoEncoder "supported" ≠ working:** iOS reports support but silently drops frames. Always verify output blob size.
4. **COOP/COEP headers:** Required for `SharedArrayBuffer` but iOS ignores them anyway. Still needed for desktop multi-threading.
5. **mp4-muxer decoderConfig:** Safari sends null decoderConfig on keyframes. Cache and reuse the first valid one.
6. **Frame count estimates:** RVFC delivers ~80-85% of `duration × fps`. Use `~` prefix in UI.

---

## 9. Outstanding Work

- [ ] **`playbackRate = 2.0` test** — could halve capture time
- [ ] **Cross-browser testing** — Chrome, Safari, Brave, Firefox on iOS + Android
- [ ] **Android strategy** — Android Chrome supports WebGPU; may get ~10× faster inference than iOS WASM
- [ ] **Model input size optimization** — 640 → 416 for ~2.4× speedup (test accuracy impact)
- [ ] **Annotated video on iOS** — explore canvas → GIF/image sequence as alternative to VideoEncoder
