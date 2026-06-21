import { loadModel, inferFrame, forceWasm } from './onnxPoseInference.js';
import { KalmanSmoother } from './kalmanSmoother.js';
import { getExerciseAngle } from './angleCalculator.js';
import { RepCounter } from './repCounter.js';
import { drawFrame } from './skeletonRenderer.js';
import { computeStats } from './statsCalculator.js';
import { DebugLogger, DEBUG_ON_DEVICE } from './debugLogger.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const OUT_FPS         = 15;   // Output video frame rate
const FRAME_INTERVAL  = 1 / OUT_FPS;  // Capture at 15fps during play-through
const MAX_FRAMES      = 500;  // Safety cap to prevent OOM on long videos
const MAX_DURATION    = 30;   // Maximum video duration in seconds
const WEBGPU_TIMEOUT  = 15_000; // ms to wait for WebGPU shader compilation before WASM fallback

// iOS detection — VideoEncoder silently drops all frames on iOS WebKit
const _isIOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
   (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1));

/**
 * Try to create a working VideoEncoder with the first supported codec config.
 * Uses VideoEncoder.isConfigSupported() to probe before committing,
 * and waits for a tick after configure() so async errors can surface.
 *
 * Returns { encoder, config } or null if VideoEncoder is unsupported.
 */
async function createVideoEncoder(onChunk, w, h) {
  if (typeof VideoEncoder === 'undefined') {
    console.warn('[onDevice] VideoEncoder API not available');
    return null;
  }

  // H.264 requires even dimensions
  const ew = Math.floor(w / 2) * 2;
  const eh = Math.floor(h / 2) * 2;

  // Probe codecs in order of broadest compatibility
  const candidates = [
    'avc1.42E01E',  // H.264 Baseline L3.0  — widest mobile support
    'avc1.4D001E',  // H.264 Main L3.0
    'avc1.42001f',  // H.264 Baseline L3.1
    'avc1.640028',  // H.264 High L4.0
  ];

  let chosenCodec = null;
  for (const codec of candidates) {
    try {
      const cfg = { codec, width: ew, height: eh, bitrate: 2_500_000, framerate: OUT_FPS };
      const { supported } = await VideoEncoder.isConfigSupported(cfg);
      console.log(`[onDevice] VideoEncoder codec probe: ${codec} → ${supported ? 'OK' : 'REJECTED'}`);
      if (supported) { chosenCodec = codec; break; }
    } catch (e) {
      console.log(`[onDevice] VideoEncoder codec probe: ${codec} → THREW: ${e.message}`);
    }
  }

  if (!chosenCodec) {
    console.warn('[onDevice] VideoEncoder: no supported H.264 codec found');
    return null;
  }

  const encConfig = {
    codec:     chosenCodec,
    width:     ew,
    height:    eh,
    bitrate:   2_500_000,
    framerate: OUT_FPS,
  };

  // Expose a mutable flag so the caller can detect mid-loop encoder errors
  const state = { closed: false };

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result) => { if (!settled) { settled = true; resolve(result); } };

    const enc = new VideoEncoder({
      output: onChunk,
      error: (e) => {
        console.error('[onDevice] VideoEncoder error:', e);
        state.closed = true;  // mark for mid-loop detection
        settle(null);         // no-op if already settled (mid-loop error)
      },
    });

    try {
      enc.configure(encConfig);
    } catch (e) {
      console.error('[onDevice] VideoEncoder.configure() threw:', e);
      settle(null);
      return;
    }

    console.log(`[onDevice] VideoEncoder.configure() → state=${enc.state}, codec=${chosenCodec}`);

    // configure() is synchronous in spec but implementations may error async.
    // Yield one microtask so any synchronous error callback fires before we resolve.
    Promise.resolve().then(() =>
      settle({ encoder: enc, config: encConfig, dims: { ew, eh }, state })
    );
  });
}

// ── Play-through frame capture ─────────────────────────────────────────────────

/**
 * Capture frames from video playback using requestVideoFrameCallback (RVFC)
 * or timeupdate fallback. Plays the video at 1× and intercepts frames as they
 * naturally arrive — zero seek latency, correct sequential frames.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {Function} onProgress
 * @returns {Promise<{ bitmap: ImageBitmap, mediaTime: number }[]>}
 */
async function captureFrames(videoEl, onProgress) {
  const frames = [];
  let lastCapturedTime = -Infinity;
  const estimatedTotal = Math.min(
    Math.ceil(videoEl.duration * OUT_FPS),
    MAX_FRAMES
  );

  // Compute proportional capture size (max 640px longest side).
  // This preserves aspect ratio — critical because letterbox() expects
  // proportional input to compute correct scale/padding for the YOLO model.
  // DO NOT capture at 416×416 — that stretches the video to a square and
  // destroys aspect ratio, causing wrong keypoint coordinates.
  const MAX_CAPTURE_DIM = 640;
  const { videoWidth: vw, videoHeight: vh } = videoEl;
  const captureScale = Math.min(1, MAX_CAPTURE_DIM / Math.max(vw, vh));
  const captureW = Math.round(vw * captureScale);
  const captureH = Math.round(vh * captureScale);
  // Memory per frame: captureW × captureH × 4 bytes
  // e.g. 640×360 = 0.92 MB/frame, 90 frames = 83 MB — safe

  const hasRVFC = typeof videoEl.requestVideoFrameCallback === 'function';
  console.log(`[onDevice] RVFC available: ${hasRVFC}`);
  console.log(`[onDevice] Video: ${vw}×${vh}, capture at ${captureW}×${captureH}`);
  console.log(`[onDevice] Duration: ${videoEl.duration.toFixed(2)}s, estimated frames: ${estimatedTotal}`);

  // Ensure video starts from the beginning
  videoEl.currentTime = 0;
  videoEl.playbackRate = 1.0;

  if (hasRVFC) {
    // ── RVFC path (iOS 15.4+, Chrome 83+, most modern browsers) ──
    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; setTimeout(resolve, 100); } };

      function onFrame(_now, metadata) {
        const { mediaTime } = metadata;
        if (mediaTime - lastCapturedTime >= FRAME_INTERVAL && frames.length < MAX_FRAMES) {
          lastCapturedTime = mediaTime;
          // Start createImageBitmap synchronously inside RVFC — spec guarantees
          // frame data is available for the duration of this callback.
          // Capture at proportional reduced size to save memory while preserving
          // aspect ratio for correct letterbox → YOLO inference.
          createImageBitmap(videoEl, {
            resizeWidth:   captureW,
            resizeHeight:  captureH,
            resizeQuality: 'pixelated',  // fastest; adequate for pose detection
          }).then(bitmap => {
            frames.push({ bitmap, mediaTime });
            onProgress?.({
              phase: 'capturing',
              framesProcessed: frames.length,
              totalFrames: estimatedTotal,
            });
          }).catch(e => {
            console.warn('[onDevice] RVFC createImageBitmap error:', e);
          });
        }
        if (!videoEl.ended && !videoEl.paused) {
          videoEl.requestVideoFrameCallback(onFrame);
        }
      }

      videoEl.requestVideoFrameCallback(onFrame);
      videoEl.onended = finish;
      // Safety timeout: 2× video duration in case onended doesn't fire
      setTimeout(finish, (videoEl.duration + 2) * 1000);
    });
  } else {
    // ── timeupdate fallback (pre-iOS 15.4, older Firefox) ──
    // timeupdate fires ~4-10fps on iOS — not great, but far better than seeking
    console.warn('[onDevice] RVFC unavailable — using timeupdate fallback (~4-10fps)');
    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => { if (!resolved) { resolved = true; setTimeout(resolve, 100); } };

      const handler = () => {
        const t = videoEl.currentTime;
        if (t - lastCapturedTime >= FRAME_INTERVAL && frames.length < MAX_FRAMES) {
          lastCapturedTime = t;
          createImageBitmap(videoEl, {
            resizeWidth:   captureW,
            resizeHeight:  captureH,
            resizeQuality: 'pixelated',
          }).then(bitmap => {
            frames.push({ bitmap, mediaTime: t });
            onProgress?.({
              phase: 'capturing',
              framesProcessed: frames.length,
              totalFrames: estimatedTotal,
            });
          }).catch(e => {
            console.warn('[onDevice] timeupdate createImageBitmap error:', e);
          });
        }
      };

      videoEl.addEventListener('timeupdate', handler);
      videoEl.onended = () => {
        videoEl.removeEventListener('timeupdate', handler);
        finish();
      };
      setTimeout(() => {
        videoEl.removeEventListener('timeupdate', handler);
        finish();
      }, (videoEl.duration + 2) * 1000);
    });
  }

  // Wait a moment for any in-flight createImageBitmap promises to settle
  await new Promise(r => setTimeout(r, 200));

  console.log(`[onDevice] Frame capture complete: ${frames.length} frames captured`);
  return frames;
}

/**
 * Process a video entirely on-device using ONNX Runtime Web.
 *
 * Architecture: Two-phase play-through approach.
 *   Phase 1 — Frame Capture: Play video at 1× speed, intercept frames via RVFC.
 *   Phase 2 — Inference + Encode: Drain the frame queue with ONNX inference,
 *             skeleton rendering, and video encoding.
 *
 * @param {File} file
 * @param {{
 *   exerciseType: string,
 *   overlayMode: string,
 *   cameraAngle: string,
 *   preferredFormat: 'mp4' | 'webm',
 *   onProgress: Function,
 * }} options
 * @returns {Promise<Object>} Result shaped to match server response
 */
export async function processVideoOnDevice(file, {
  exerciseType,
  overlayMode,
  cameraAngle,
  preferredFormat = 'mp4',
  onProgress,
}) {
  // ── 0. Debug logger ──────────────────────────────────────────────────────────
  const dbg = new DebugLogger();
  await dbg.init();
  dbg.event('start', 'processVideoOnDevice called', { exerciseType, overlayMode, cameraAngle, preferredFormat, fileSize: file.size, fileType: file.type });

  console.log('[onDevice] Starting on-device processing…');
  console.log(`[onDevice] Exercise: ${exerciseType}, Overlay: ${overlayMode}, Camera: ${cameraAngle}`);

  // ── 1. Load video metadata ──────────────────────────────────────────────────
  dbg.phase('video_load');
  let videoUrl = URL.createObjectURL(file);
  const videoEl  = document.createElement('video');
  videoEl.muted       = true;
  videoEl.playsInline = true;
  videoEl.preload     = 'auto';   // pre-buffer for smooth playback
  videoEl.src         = videoUrl;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = resolve;
    videoEl.onerror = () => reject(new Error(`Failed to load video: ${videoEl.error?.message ?? 'unknown'}`));
    setTimeout(() => reject(new Error('Video metadata load timed out')), 15_000);
  });
  dbg.phaseEnd('video_load');

  // Wait for enough data for smooth playback
  dbg.phase('video_canplay');
  if (videoEl.readyState < 3) {
    await new Promise(resolve => {
      videoEl.oncanplay = resolve;
      setTimeout(resolve, 5_000);   // don't block indefinitely
    });
  }
  dbg.phaseEnd('video_canplay');

  const { videoWidth: w, videoHeight: h, duration } = videoEl;
  dbg.setPipeline('video', { width: w, height: h, duration, readyState: videoEl.readyState });
  if (!w || !h || !duration) {
    URL.revokeObjectURL(videoUrl);
    throw new Error('Invalid video: could not read dimensions or duration');
  }

  // ── Duration cap ──────────────────────────────────────────────────────────
  if (duration > MAX_DURATION) {
    URL.revokeObjectURL(videoUrl);
    throw new Error(
      `Video is ${Math.round(duration)}s long — on-device processing is limited to ${MAX_DURATION}s. ` +
      `Please trim your video or use server-side processing.`
    );
  }

  console.log(`[onDevice] Video: ${w}×${h}, ${duration.toFixed(2)}s`);

  // ── 2. Load ONNX model ──────────────────────────────────────────────────────
  onProgress?.({ phase: 'loading_model', framesProcessed: 0, totalFrames: 0 });
  dbg.phase('model_load');

  let device;
  try {
    ({ device } = await loadModel());
    console.log(`[onDevice] Model loaded, device: ${device}`);
    dbg.phaseEnd('model_load', `device=${device}`);
    dbg.setPipeline('model', { device, wasmThreads: navigator.hardwareConcurrency });
  } catch (err) {
    dbg.error('model_load', err);
    URL.revokeObjectURL(videoUrl);
    throw new Error(`Model load failed: ${err.message}`);
  }

  // ── 3. Phase 1 — Frame capture (play-through) ─────────────────────────────
  console.log('[onDevice] Phase 1: Starting frame capture (play-through)…');
  dbg.phase('capture');
  const captureStart = performance.now();

  // Start playback — muted + playsInline allows autoplay on iOS without gesture
  let playSucceeded = false;
  try {
    await videoEl.play();
    playSucceeded = !videoEl.paused;
    dbg.event('capture', `play() → paused=${videoEl.paused}, readyState=${videoEl.readyState}`);
  } catch (e) {
    dbg.error('capture', e, { phase: 'play' });
    console.warn('[onDevice] videoEl.play() FAILED:', e.name, e.message);
  }

  let frames = [];
  if (playSucceeded) {
    frames = await captureFrames(videoEl, onProgress);
  } else {
    console.error('[onDevice] Video did not start playing — cannot capture frames');
  }

  // Stop playback and clean up
  videoEl.pause();
  const captureMs = Math.round(performance.now() - captureStart);
  dbg.phaseEnd('capture', `${frames.length} frames in ${captureMs}ms`);
  dbg.setPipeline('capture', { frames: frames.length, captureMs, playSucceeded });

  if (frames.length === 0) {
    dbg.error('capture', new Error('No frames captured'));
    await dbg.send();  // send partial log even on failure
    URL.revokeObjectURL(videoUrl);
    throw new Error('No frames captured from video. The video may be too short or unsupported by this browser.');
  }

  // ── 4. Init pipeline ────────────────────────────────────────────────────────
  const smoother   = new KalmanSmoother();
  const repCounter = new RepCounter(exerciseType);
  const allAngles      = [];
  const allConfidences = [];

  // ── 5. Recording setup ─────────────────────────────────────────────────────
  // Priority: VideoEncoder (WebCodecs, iOS 17.4+) → MediaRecorder → no video
  let muxer        = null;
  let muxerTarget  = null;
  let videoEncoder = null;
  let encState     = null;  // shared state object from createVideoEncoder
  let encDims      = { ew: w, eh: h };  // may differ from w/h if dimensions were odd
  let recorder     = null;
  const recordedChunks = [];
  let outputFormat = 'none';
  let encChunksAdded = 0;     // track chunks for debug
  let encChunksSkipped = 0;
  let cachedDecoderConfig = null;  // cache first valid decoderConfig for iOS

  // Output canvas — use encoder-adjusted dimensions if needed
  const outCanvas = document.createElement('canvas');
  const outCtx    = outCanvas.getContext('2d');

  // Try VideoEncoder — but SKIP on iOS (silently drops frames) and when user prefers WebM
  const needsVideoEncoder = !_isIOS && preferredFormat !== 'webm';
  const encResult = needsVideoEncoder ? await createVideoEncoder(
    (chunk, meta) => {
      if (!muxer) return;
      // mp4-muxer v5 line 391: `track.info.decoderConfig.colorSpace ? ...`
      // This crashes when decoderConfig is null OR when colorSpace is null.
      // Safari/iOS emits null decoderConfig on many keyframes.
      //
      // Strategy: cache the first valid decoderConfig and reuse it.
      if (chunk.type === 'key') {
        if (meta?.decoderConfig) {
          // Strip null/undefined fields from decoderConfig — mp4-muxer accesses them unsafely
          cachedDecoderConfig = Object.fromEntries(
            Object.entries(meta.decoderConfig).filter(([, v]) => v != null)
          );
          meta = { ...meta, decoderConfig: cachedDecoderConfig };
        } else if (cachedDecoderConfig) {
          // Reuse cached config from a previous keyframe
          meta = { ...(meta || {}), decoderConfig: cachedDecoderConfig };
        } else {
          // No cached config yet — skip this chunk (can't init muxer track without it)
          console.warn('[onDevice] keyframe missing decoderConfig and no cache — skipping');
          encChunksSkipped++;
          return;
        }
      }
      try {
        muxer.addVideoChunk(chunk, meta);
        encChunksAdded++;
      } catch (e) {
        encChunksSkipped++;
        console.error('[onDevice] addVideoChunk error:', e);
      }
    },
    w, h
  ) : null;

  if (_isIOS) {
    // iOS: skip encoding entirely — VideoEncoder silently drops all frames,
    // and MediaRecorder doesn't support WebM on iOS either.
    // Show original source video alongside stats.
    outputFormat     = 'source_video';
    outCanvas.width  = w;
    outCanvas.height = h;
    console.log('[onDevice] iOS detected — skipping video encoding. Using source video.');
    dbg.event('encode', 'iOS: skipped video encoding, will use source video');
  } else if (preferredFormat === 'webm' && typeof outCanvas.captureStream === 'function') {
    // User prefers WebM — use MediaRecorder
    outputFormat = 'webm';
    outCanvas.width  = w;
    outCanvas.height = h;
    console.log(`[onDevice] Output: WebM via MediaRecorder (user preference) (${w}×${h})`);

    const stream = outCanvas.captureStream(OUT_FPS);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    recorder.start();
  } else if (encResult) {
    // User prefers MP4, or WebM not available — use VideoEncoder + mp4-muxer
    outputFormat = 'mp4';
    videoEncoder = encResult.encoder;
    encState     = encResult.state;
    encDims      = encResult.dims;
    outCanvas.width  = encDims.ew;
    outCanvas.height = encDims.eh;
    console.log(`[onDevice] Output: MP4 via VideoEncoder (${encDims.ew}×${encDims.eh})`);

    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    muxerTarget = new ArrayBufferTarget();
    muxer = new Muxer({
      target: muxerTarget,
      video: {
        codec:     'avc',
        width:     encDims.ew,
        height:    encDims.eh,
        frameRate: OUT_FPS,
      },
      fastStart: 'in-memory',
    });
  } else if (typeof outCanvas.captureStream === 'function') {
    // MP4 preferred but VideoEncoder unavailable — fall back to WebM
    outputFormat = 'webm';
    outCanvas.width  = w;
    outCanvas.height = h;
    console.log(`[onDevice] Output: WebM via MediaRecorder (MP4 unavailable, fallback) (${w}×${h})`);

    const stream = outCanvas.captureStream(OUT_FPS);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    recorder.start();
  } else {
    // No video output available — still run inference and return stats
    outputFormat     = 'source_video';
    outCanvas.width  = w;
    outCanvas.height = h;
    console.warn('[onDevice] No video encoding available — using source video');
  }

  // ── 6. Phase 2 — Inference + Encode (drain the frame queue) ────────────────

  // Warm-up: first inference compiles WebGPU shaders.
  // Use a timeout — if WebGPU hangs (common on iOS), fall back to WASM.
  if (frames.length > 0 && device === 'webgpu') {
    onProgress?.({
      phase:           'compiling',
      framesProcessed: 0,
      totalFrames:     frames.length,
      device,
    });
    dbg.phase('shader_warmup');
    console.log('[onDevice] WebGPU warm-up: compiling shaders on first frame…');

    const warmupResult = await Promise.race([
      inferFrame(frames[0].bitmap)
        .then(() => 'ok')
        .catch(e => ({ error: e })),
      new Promise(resolve => setTimeout(() => resolve('timeout'), WEBGPU_TIMEOUT)),
    ]);

    const warmupMs = dbg.phaseEnd('shader_warmup');

    if (warmupResult === 'timeout') {
      // WebGPU shader compilation hung — fall back to WASM
      console.warn(`[onDevice] WebGPU shader compilation timed out after ${WEBGPU_TIMEOUT}ms — falling back to WASM`);
      dbg.event('fallback', `WebGPU timed out after ${WEBGPU_TIMEOUT}ms, switching to WASM`);
      onProgress?.({
        phase:           'fallback',
        framesProcessed: 0,
        totalFrames:     frames.length,
        device:          'wasm',
      });
      dbg.phase('wasm_fallback');
      try {
        ({ device } = await forceWasm());
        dbg.phaseEnd('wasm_fallback');
        dbg.setPipeline('fallback', { reason: 'webgpu_timeout', newDevice: device });
        // Re-run warm-up with WASM (fast, no shader compilation)
        await inferFrame(frames[0].bitmap);
        dbg.event('fallback', 'WASM warm-up succeeded');
      } catch (e) {
        dbg.error('wasm_fallback', e);
        console.error('[onDevice] WASM fallback also failed:', e);
      }
    } else if (typeof warmupResult === 'object' && warmupResult.error) {
      // WebGPU inference threw (not a timeout)
      console.warn('[onDevice] WebGPU warm-up inference failed:', warmupResult.error.message);
      dbg.error('shader_warmup', warmupResult.error);
      // Try WASM fallback for errors too
      dbg.event('fallback', 'WebGPU inference error, switching to WASM');
      try {
        ({ device } = await forceWasm());
        await inferFrame(frames[0].bitmap);
        dbg.event('fallback', 'WASM fallback succeeded after WebGPU error');
      } catch (e) {
        dbg.error('wasm_fallback', e);
      }
    } else {
      console.log(`[onDevice] WebGPU warm-up complete in ${warmupMs}ms`);
      dbg.event('shader_warmup', `WebGPU warm-up OK in ${warmupMs}ms`);
    }
  }

  dbg.phase('inference');
  console.log(`[onDevice] Phase 2: Starting inference on ${frames.length} frames (device: ${device})…`);
  const inferenceStart = performance.now();
  let currentAngle = null;
  let lastKpts     = null;
  let lastConfs    = null;
  let lastRepCount = 0;
  let lastInRep    = false;
  let encodedFrames = 0;
  let firstEncodeLogged = false;

  // ── Diagnostic counters ──
  let diagDetections   = 0;  // frames where YOLO found a person
  let diagAngles       = 0;  // frames where an exercise angle was computed
  let diagInferErrors  = 0;  // frames where inferFrame threw
  let diagAngleMin     = Infinity;
  let diagAngleMax     = -Infinity;
  let diagFirstError   = '';  // capture first error message for mobile debugging

  for (let i = 0; i < frames.length; i++) {
    const { bitmap, mediaTime } = frames[i];
    const frameStart = performance.now();

    // ── Inference ─────────────────────────────────────────────────────────
    try {
      const detection = await inferFrame(bitmap);
      if (detection) {
        diagDetections++;
        const { smoothed } = smoother.update(detection.keypoints, detection.confidences);
        lastKpts  = smoothed;
        lastConfs = detection.confidences;

        const angleResult = getExerciseAngle(smoothed, lastConfs, exerciseType);
        if (angleResult) {
          diagAngles++;
          currentAngle = angleResult.angle;
          if (currentAngle < diagAngleMin) diagAngleMin = currentAngle;
          if (currentAngle > diagAngleMax) diagAngleMax = currentAngle;
          allAngles.push(currentAngle);
          allConfidences.push(angleResult.confidence);
          const rep = repCounter.update(currentAngle);
          lastRepCount = rep.repCount;
          lastInRep    = rep.inRep;
        }
      }
    } catch (err) {
      diagInferErrors++;
      if (!diagFirstError) diagFirstError = `${err.name}: ${err.message}`;
      dbg.error('inference', err, { frame: i });
      console.warn(`[onDevice] inferFrame error at frame ${i}:`, err);
    }
    const frameMs = Math.round(performance.now() - frameStart);

    // ── Draw ──────────────────────────────────────────────────────────────
    // Draw the captured bitmap onto the output canvas (scales 416×416 → output dims)
    outCtx.drawImage(bitmap, 0, 0, outCanvas.width, outCanvas.height);
    if (lastKpts && lastConfs) {
      drawFrame(outCtx, lastKpts, lastConfs, currentAngle,
                lastRepCount, exerciseType, overlayMode,
                outCanvas.width, outCanvas.height, lastInRep);
    }

    // ── Encode ────────────────────────────────────────────────────────────
    if (videoEncoder && videoEncoder.state === 'configured' && !encState?.closed) {
      // Backpressure: if the encoder queue is building up, yield until it drains.
      // Without this the encoder overflows on mobile and auto-closes itself.
      if (videoEncoder.encodeQueueSize > 5) {
        await new Promise(resolve => setTimeout(resolve, videoEncoder.encodeQueueSize * 10));
      }
      if (videoEncoder.state === 'configured' && !encState?.closed) {
        try {
          // Use mediaTime from RVFC for accurate video timestamps
          const vf = new VideoFrame(outCanvas, {
            timestamp: Math.round(mediaTime * 1_000_000),  // seconds → microseconds
            duration:  Math.round(1_000_000 / OUT_FPS),
          });
          videoEncoder.encode(vf, { keyFrame: encodedFrames % (OUT_FPS * 2) === 0 });
          vf.close();
          if (!firstEncodeLogged) {
            console.log(`[onDevice] First encode() called at frame ${i}, mediaTime=${mediaTime.toFixed(3)}s`);
            firstEncodeLogged = true;
          }
        } catch (e) {
          console.warn('[onDevice] VideoFrame/encode error:', e);
          if (encState) encState.closed = true;
        }
      }
    }
    // MediaRecorder path: captureStream records automatically from canvas draws

    encodedFrames++;

    // ── Per-frame debug telemetry ─────────────────────────────────────────
    // Sample every frame for short videos, every 5th for long ones
    if (frames.length <= 100 || i % 5 === 0 || i === frames.length - 1) {
      dbg.frame(i, {
        infer_ms:  frameMs,
        detected:  diagDetections > (i > 0 ? diagDetections - 1 : -1),  // was THIS frame detected?
        angle:     currentAngle != null ? Math.round(currentAngle * 10) / 10 : null,
        rep_count: lastRepCount,
      });
    }

    // ── Free memory immediately ──────────────────────────────────────────
    bitmap.close();

    // ── Yield to browser every 3 frames ──────────────────────────────────
    if (i % 3 === 0 || i === frames.length - 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      onProgress?.({
        phase:           'processing',
        framesProcessed: i + 1,
        totalFrames:     frames.length,
        device,
      });
    }
  }

  const inferenceMs = Math.round(performance.now() - inferenceStart);
  dbg.phaseEnd('inference', `${frames.length} frames in ${inferenceMs}ms`);
  console.log(`[onDevice] Phase 2 complete: ${frames.length} frames in ${(inferenceMs / 1000).toFixed(1)}s (${(inferenceMs / frames.length).toFixed(0)}ms/frame avg)`);

  // ── 7. Finalize ────────────────────────────────────────────────────────────
  dbg.phase('finalize');
  // Don't revoke yet — we may need videoUrl as fallback if encoding fails

  let signedUrl = null;

  if (outputFormat === 'mp4' && videoEncoder && muxer) {
    dbg.event('encode', `Encoder done: ${encChunksAdded} chunks added, ${encChunksSkipped} skipped`);
    // Only flush if encoder is still alive — it may have self-closed on error
    if (videoEncoder.state === 'configured') {
      try {
        await videoEncoder.flush();
        console.log('[onDevice] VideoEncoder flush() completed');
      } catch (e) {
        dbg.error('encode', e, { phase: 'flush' });
        console.warn('[onDevice] flush error:', e);
      }
    }
    // close() throws if state is already 'closed' — guard explicitly
    if (videoEncoder.state !== 'closed') {
      try { videoEncoder.close(); } catch (e) {
        console.warn('[onDevice] close error:', e);
      }
    }
    muxer.finalize();
    const blob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
    dbg.setPipeline('encoder', { chunksAdded: encChunksAdded, chunksSkipped: encChunksSkipped, blobSize: blob.size });
    // Only produce a video URL if we encoded at least one frame successfully
    if (blob.size > 1024) {
      signedUrl = URL.createObjectURL(blob);
      console.log(`[onDevice] MP4 output: ${(blob.size / 1024).toFixed(0)} KB`);
    } else {
      // Annotated video failed — fall back to showing the original source video
      console.warn(`[onDevice] MP4 output empty (${blob.size} bytes, ${encChunksAdded} chunks) — using original video`);
      signedUrl = videoUrl;
      dbg.event('encode', 'MP4 blob empty — falling back to original source video');
      // Don't revoke videoUrl since we're using it as the output
      videoUrl = null;
    }

  } else if (outputFormat === 'webm' && recorder) {
    recorder.stop();
    await new Promise(resolve => { recorder.onstop = resolve; });
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    signedUrl  = URL.createObjectURL(blob);
    console.log(`[onDevice] WebM output: ${(blob.size / 1024).toFixed(0)} KB`);
  } else if (outputFormat === 'source_video') {
    // iOS: use the original source video (no annotation overlay)
    signedUrl = videoUrl;
    videoUrl = null;  // prevent revoking since we're using it
    console.log('[onDevice] Using original source video (iOS — no annotation overlay)');
  }
  // outputFormat === 'none': signedUrl stays null — UI hides the video tab

  // Clean up the source video URL (unless we're using it as the output fallback)
  if (videoUrl) {
    URL.revokeObjectURL(videoUrl);
  }

  dbg.phaseEnd('finalize');

  // ── 8. Stats + result ──────────────────────────────────────────────────────
  const stats = computeStats(repCounter, allAngles, allConfidences, duration, exerciseType);

  console.log(`[onDevice] Final: ${repCounter.repCount} reps, ${outputFormat} output, ${encodedFrames} encoded frames`);

  const diagSummary = {
    play_succeeded:     playSucceeded,
    frames_captured:    frames.length,
    capture_ms:         captureMs,
    detections:         diagDetections,
    angles_computed:    diagAngles,
    infer_errors:       diagInferErrors,
    first_error:        diagFirstError || 'none',
    angle_range:        diagAngleMin < Infinity ? `${Math.round(diagAngleMin)}°–${Math.round(diagAngleMax)}°` : 'none',
    reps_detected:      repCounter.repCount,
    inference_ms:       inferenceMs,
    ms_per_frame:       frames.length > 0 ? Math.round(inferenceMs / frames.length) : 0,
  };
  console.log('[onDevice] Diagnostics:', JSON.stringify(diagSummary));

  // ── 9. Debug log — auto-send + attach to result ────────────────────────────
  dbg.setPipeline('output', { format: outputFormat, encodedFrames, videoSize: signedUrl ? 'has_video' : 'none' });
  dbg.setPipeline('result', { reps: repCounter.repCount, angles: allAngles.length, stats: !!stats });
  await dbg.send();  // fire-and-forget to server (no-op if debug not enabled)

  return {
    signed_url: signedUrl,
    metadata: {
      rep_count:              repCounter.repCount,
      duration_sec:           duration,
      exercise_type:          exerciseType,
      detected_exercise_type: null,
      exercise_confidence:    null,
      camera_angle_warnings:  [],
      stats,
    },
    processing_log: {
      on_device:              true,
      output_format:          outputFormat,
      total_frames_processed: encodedFrames,
      device,
      diagnostics:            diagSummary,
    },
    // Attach debug logger reference for UI to generate download
    _debugLogger:             dbg.enabled ? dbg : null,
  };
}
