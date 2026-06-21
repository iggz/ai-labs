---
name: mobile-on-device-inference
description: >
  Reference for on-device AI/ML inference on mobile browsers (iOS/Android).
  LOAD THIS when working on: ONNX Runtime Web, WebGPU, WASM inference,
  VideoEncoder, requestVideoFrameCallback, SharedArrayBuffer, or any
  on-device processing feature for ilovetoridemybicycle.com/ai-labs.
  Contains critical iOS bugs, workarounds, performance baselines, and
  the debug logging infrastructure.
---

# Mobile On-Device Inference Skill

When working on mobile on-device features, **read the full reference document first:**

📄 [mobile-on-device-inference.md](file:///Users/iggypop/Documents/ai-labs/.agents/references/mobile-on-device-inference.md)

This reference contains:
- iOS platform constraints (WebGPU, SharedArrayBuffer, VideoEncoder all broken)
- ONNX Runtime Web bugs and workarounds
- Video pipeline architecture and format selection
- Performance baselines (iPhone 14 Pro: ~850ms/frame WASM)
- Debug logging infrastructure (DebugLogger + Cloudflare KV)
- Field name mappings between statsCalculator and dashboard
- Common pitfalls and outstanding work items

## Quick Reminders
1. **All iOS browsers = WebKit** — don't test Chrome vs Safari separately on iOS
2. **Skip WebGPU on iOS** — shader compilation hangs indefinitely
3. **Skip VideoEncoder on iOS** — silently drops all frames
4. **SharedArrayBuffer unavailable on iOS** — WASM runs single-threaded
5. **Always test with `?debug=1`** — logs auto-upload to Cloudflare KV
6. **Check logs:** `curl -s 'https://ilovetoridemybicycle.com/ai-labs/api/debug-logs' | jq .`
