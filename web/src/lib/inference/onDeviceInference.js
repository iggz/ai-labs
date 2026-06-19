import { loadModel, inferFrame } from './onnxPoseInference.js';
import { KalmanSmoother } from './kalmanSmoother.js';
import { getExerciseAngle } from './angleCalculator.js';
import { RepCounter } from './repCounter.js';
import { drawFrame } from './skeletonRenderer.js';
import { computeStats } from './statsCalculator.js';

// ── Constants ──────────────────────────────────────────────────────────────────
const FRAME_STRIDE = 2;   // Run inference every 2nd frame → 15 fps equivalent
const OUT_FPS      = 15;  // Output video frame rate

/**
 * Try to create a working VideoEncoder with the first supported codec config.
 * Uses VideoEncoder.isConfigSupported() to probe before committing,
 * and waits for a tick after configure() so async errors can surface.
 *
 * Returns { encoder, config } or null if VideoEncoder is unsupported.
 */
async function createVideoEncoder(onChunk, w, h) {
  if (typeof VideoEncoder === 'undefined') return null;

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
      if (supported) { chosenCodec = codec; break; }
    } catch { /* codec query threw — try next */ }
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

    // configure() is synchronous in spec but implementations may error async.
    // Yield one microtask so any synchronous error callback fires before we resolve.
    Promise.resolve().then(() =>
      settle({ encoder: enc, config: encConfig, dims: { ew, eh }, state })
    );
  });
}

/**
 * Process a video entirely on-device using ONNX Runtime Web.
 *
 * @param {File} file
 * @param {{
 *   exerciseType: string,
 *   overlayMode: string,
 *   cameraAngle: string,
 *   onProgress: Function,
 * }} options
 * @returns {Promise<Object>} Result shaped to match server response
 */
export async function processVideoOnDevice(file, {
  exerciseType,
  overlayMode,
  cameraAngle,
  onProgress,
}) {
  // ── 1. Load video metadata ──────────────────────────────────────────────────
  const videoUrl = URL.createObjectURL(file);
  const videoEl  = document.createElement('video');
  videoEl.muted       = true;
  videoEl.playsInline = true;
  videoEl.preload     = 'auto';   // pre-buffer so seeks are fast
  videoEl.src         = videoUrl;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = resolve;
    videoEl.onerror = () => reject(new Error(`Failed to load video: ${videoEl.error?.message ?? 'unknown'}`));
    setTimeout(() => reject(new Error('Video metadata load timed out')), 15_000);
  });

  // Wait for enough data for reliable seeking
  if (videoEl.readyState < 3) {
    await new Promise(resolve => {
      videoEl.oncanplay = resolve;
      setTimeout(resolve, 5_000);   // don't block indefinitely
    });
  }

  const { videoWidth: w, videoHeight: h, duration } = videoEl;
  if (!w || !h || !duration) {
    URL.revokeObjectURL(videoUrl);
    throw new Error('Invalid video: could not read dimensions or duration');
  }

  const srcFps         = 30;
  const totalSrcFrames = Math.floor(duration * srcFps);
  const totalInferFrames = Math.ceil(totalSrcFrames / FRAME_STRIDE);

  onProgress?.({ phase: 'loading_model', framesProcessed: 0, totalFrames: totalInferFrames });

  // ── 2. Load ONNX model ──────────────────────────────────────────────────────
  let device;
  try {
    ({ device } = await loadModel());
  } catch (err) {
    URL.revokeObjectURL(videoUrl);
    throw new Error(`Model load failed: ${err.message}`);
  }

  // ── 3. Init pipeline ────────────────────────────────────────────────────────
  const smoother   = new KalmanSmoother();
  const repCounter = new RepCounter(exerciseType);
  const allAngles      = [];
  const allConfidences = [];

  // ── 4. Recording setup ─────────────────────────────────────────────────────
  // Priority: VideoEncoder (WebCodecs, iOS 17.4+) → MediaRecorder → no video
  let muxer        = null;
  let muxerTarget  = null;
  let videoEncoder = null;
  let encState     = null;  // shared state object from createVideoEncoder
  let encDims      = { ew: w, eh: h };  // may differ from w/h if dimensions were odd
  let recorder     = null;
  const recordedChunks = [];
  let outputFormat = 'none';

  // Output canvas — use encoder-adjusted dimensions if needed
  const outCanvas = document.createElement('canvas');
  const outCtx    = outCanvas.getContext('2d');

  // Try VideoEncoder first
  const encResult = await createVideoEncoder(
    (chunk, meta) => {
      if (!muxer) return;
      // mp4-muxer crashes if decoderConfig.colorSpace is null (Safari omits it).
      // Sanitize: strip null/undefined colorSpace before handing off to muxer.
      if (meta?.decoderConfig?.colorSpace == null && meta?.decoderConfig) {
        const { colorSpace: _omit, ...dc } = meta.decoderConfig;
        meta = { ...meta, decoderConfig: dc };
      }
      muxer.addVideoChunk(chunk, meta);
    },
    w, h
  );

  if (encResult) {
    // VideoEncoder is working — set up mp4-muxer
    outputFormat = 'mp4';
    videoEncoder = encResult.encoder;
    encState     = encResult.state;
    encDims      = encResult.dims;
    outCanvas.width  = encDims.ew;
    outCanvas.height = encDims.eh;

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
    // MediaRecorder fallback (Chrome on Android, desktop)
    outputFormat = 'webm';
    outCanvas.width  = w;
    outCanvas.height = h;

    const stream = outCanvas.captureStream(OUT_FPS);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    recorder.start();
  } else {
    // No video output (older iOS) — still run inference and return stats
    outputFormat     = 'none';
    outCanvas.width  = w;
    outCanvas.height = h;
    console.warn('[onDevice] No video encoding available — returning stats only');
  }

  // ── 5. Frame loop ──────────────────────────────────────────────────────────
  let currentAngle = null;
  let lastKpts     = null;
  let lastConfs    = null;
  let lastRepCount = 0;
  let lastInRep    = false;
  let encodedFrames = 0;

  for (let srcFrame = 0; srcFrame < totalSrcFrames; srcFrame += FRAME_STRIDE) {
    const targetTime = srcFrame / srcFps;

    // ── Seek ──────────────────────────────────────────────────────────────
    await new Promise(resolve => {
      const timeout = setTimeout(() => {
        videoEl.onseeked = null;
        resolve();   // don't block on a stuck seek
      }, 3_000);

      videoEl.onseeked = () => {
        clearTimeout(timeout);
        videoEl.onseeked = null;
        resolve();
      };

      videoEl.currentTime = targetTime;
    });

    // ── Inference ─────────────────────────────────────────────────────────
    try {
      const detection = await inferFrame(videoEl);
      if (detection) {
        const { smoothed } = smoother.update(detection.keypoints, detection.confidences);
        lastKpts  = smoothed;
        lastConfs = detection.confidences;

        const angleResult = getExerciseAngle(smoothed, lastConfs, exerciseType);
        if (angleResult) {
          currentAngle = angleResult.angle;
          allAngles.push(currentAngle);
          allConfidences.push(angleResult.confidence);
          const rep = repCounter.update(currentAngle);
          lastRepCount = rep.repCount;
          lastInRep    = rep.inRep;
        }
      }
    } catch (err) {
      console.warn(`[onDevice] inferFrame error at frame ${srcFrame}:`, err);
    }

    // ── Draw ──────────────────────────────────────────────────────────────
    outCtx.drawImage(videoEl, 0, 0, outCanvas.width, outCanvas.height);
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
          const vf = new VideoFrame(outCanvas, {
            timestamp: Math.round(encodedFrames * (1_000_000 / OUT_FPS)),
            duration:  Math.round(1_000_000 / OUT_FPS),
          });
          videoEncoder.encode(vf, { keyFrame: encodedFrames % (OUT_FPS * 2) === 0 });
          vf.close();
        } catch (e) {
          console.warn('[onDevice] VideoFrame/encode error:', e);
          if (encState) encState.closed = true;
        }
      }
    }
    // MediaRecorder path: captureStream records automatically

    encodedFrames++;

    // ── Yield to browser every 5 frames ───────────────────────────────────
    const inferIdx = Math.floor(srcFrame / FRAME_STRIDE);
    if (inferIdx % 5 === 0 || srcFrame + FRAME_STRIDE >= totalSrcFrames) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      onProgress?.({
        phase:           'processing',
        framesProcessed: inferIdx + 1,
        totalFrames:     totalInferFrames,
        device,
      });
    }
  }

  // ── 6. Finalize ────────────────────────────────────────────────────────────
  URL.revokeObjectURL(videoUrl);

  let signedUrl = null;

  if (outputFormat === 'mp4' && videoEncoder && muxer) {
    // Only flush if encoder is still alive — it may have self-closed on error
    if (videoEncoder.state === 'configured') {
      try { await videoEncoder.flush(); } catch (e) {
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
    // Only produce a video URL if we encoded at least one frame successfully
    if (blob.size > 1024) {
      signedUrl = URL.createObjectURL(blob);
    } else {
      console.warn('[onDevice] MP4 output empty — video encoding failed silently');
    }

  } else if (outputFormat === 'webm' && recorder) {
    recorder.stop();
    await new Promise(resolve => { recorder.onstop = resolve; });
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    signedUrl  = URL.createObjectURL(blob);
  }
  // outputFormat === 'none': signedUrl stays null — UI hides the video tab

  // ── 7. Stats + result ──────────────────────────────────────────────────────
  const stats = computeStats(repCounter, allAngles, allConfidences, duration, exerciseType);

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
    },
  };
}
