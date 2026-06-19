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
  videoEl.preload     = 'auto';         // critical: pre-buffer for fast seeks
  videoEl.src         = videoUrl;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = resolve;
    videoEl.onerror = () => reject(new Error(`Failed to load video: ${videoEl.error?.message || 'unknown'}`));
    setTimeout(() => reject(new Error('Video metadata load timeout')), 15_000);
  });

  // Also wait for enough data to seek reliably
  if (videoEl.readyState < 3) {
    await new Promise(resolve => {
      videoEl.oncanplay = resolve;
      // Don't wait forever — proceed after 5s even if not fully buffered
      setTimeout(resolve, 5_000);
    });
  }

  const { videoWidth: w, videoHeight: h, duration } = videoEl;
  if (!w || !h || !duration) {
    URL.revokeObjectURL(videoUrl);
    throw new Error('Invalid video: could not read dimensions or duration');
  }

  const srcFps       = 30;
  const totalSrcFrames = Math.floor(duration * srcFps);
  // Frames we'll actually process (every FRAME_STRIDE-th source frame)
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

  // Output canvas — matches source resolution
  const outCanvas = document.createElement('canvas');
  outCanvas.width  = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d');

  // ── 4. Recording setup ─────────────────────────────────────────────────────
  // iOS Safari does not support canvas.captureStream() or MediaRecorder for WebM.
  // Use VideoEncoder + mp4-muxer (WebCodecs) when available; otherwise collect
  // raw frames as PNG blobs and mux them into a video at the end.
  let muxer        = null;
  let muxerTarget  = null;
  let videoEncoder = null;
  let outputFormat = 'webm';

  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';

  if (hasVideoEncoder) {
    outputFormat = 'mp4';
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    muxerTarget = new ArrayBufferTarget();
    muxer = new Muxer({
      target: muxerTarget,
      video: { codec: 'avc', width: w, height: h, frameRate: OUT_FPS },
      fastStart: 'in-memory',
    });

    await new Promise((resolve, reject) => {
      const enc = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: reject,
      });
      enc.configure({
        codec:     'avc1.42001f',
        width:     w,
        height:    h,
        bitrate:   3_000_000,
        framerate: OUT_FPS,
      });
      videoEncoder = enc;
      resolve();
    });
  } else {
    // Fallback: MediaRecorder (Chrome/Android); will be a no-op on iOS since
    // captureStream is unsupported — we detect and throw a helpful error.
    if (typeof outCanvas.captureStream !== 'function') {
      URL.revokeObjectURL(videoUrl);
      throw new Error(
        'On-device video export is not supported in this browser. ' +
        'Please use Chrome on Android, or a desktop browser. ' +
        'iOS Safari requires iOS 17.4+ for WebCodecs support.'
      );
    }
    outputFormat = 'webm';
    // MediaRecorder path (Chrome/Android only)
    // Recorder is started after we append the first frame so it doesn't
    // capture empty canvas frames at the start.
  }

  // ── 5. Frame loop ──────────────────────────────────────────────────────────
  let currentAngle   = null;
  let lastKpts       = null;   // smoothed keypoints from last inference
  let lastConfs      = null;
  let lastRepCount   = 0;
  let lastInRep      = false;
  let encodedFrames  = 0;

  // MediaRecorder deferred start (only for non-WebCodecs path)
  let recorder       = null;
  const recordedChunks = [];

  for (let srcFrame = 0; srcFrame < totalSrcFrames; srcFrame += FRAME_STRIDE) {
    const targetTime = srcFrame / srcFps;

    // ── Seek to frame ──────────────────────────────────────────────────────
    // We use 'seeked' event only — requestVideoFrameCallback is unreliable
    // for scrubbing on iOS because it fires for painted frames, not seeked frames.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        videoEl.onseeked = null;
        resolve(); // don't hard-fail on seek timeout — use whatever frame is current
      }, 3_000);

      videoEl.onseeked = () => {
        clearTimeout(timeout);
        videoEl.onseeked = null;
        resolve();
      };

      // Setting currentTime triggers the seek
      videoEl.currentTime = targetTime;
    });

    // ── Inference: pass video element directly (avoids full-res getImageData) ──
    let detection = null;
    try {
      detection = await inferFrame(videoEl);
    } catch (err) {
      // Inference error on one frame shouldn't abort the whole job
      console.warn(`[onDevice] inferFrame failed at frame ${srcFrame}:`, err);
    }

    // ── Update pipeline state ──────────────────────────────────────────────
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

    // ── Draw output frame ─────────────────────────────────────────────────
    outCtx.drawImage(videoEl, 0, 0);
    if (lastKpts && lastConfs) {
      drawFrame(outCtx, lastKpts, lastConfs, currentAngle,
                lastRepCount, exerciseType, overlayMode, w, h, lastInRep);
    }

    // ── Encode frame ──────────────────────────────────────────────────────
    const frameTimestampUs = Math.round(encodedFrames * (1_000_000 / OUT_FPS));
    const frameDurationUs  = Math.round(1_000_000 / OUT_FPS);

    if (videoEncoder) {
      const vf = new VideoFrame(outCanvas, {
        timestamp: frameTimestampUs,
        duration:  frameDurationUs,
      });
      videoEncoder.encode(vf, { keyFrame: encodedFrames % (OUT_FPS * 2) === 0 });
      vf.close();
    } else if (recorder === null) {
      // Start MediaRecorder on first actual frame
      const stream = outCanvas.captureStream(OUT_FPS);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
      recorder.start();
    }

    encodedFrames++;

    // ── Yield to browser + report progress ─────────────────────────────────
    const inferIdx = Math.floor(srcFrame / FRAME_STRIDE);
    if (inferIdx % 5 === 0 || srcFrame + FRAME_STRIDE >= totalSrcFrames) {
      // rAF gives iOS Safari a chance to repaint UI and not mark JS as frozen
      await new Promise(resolve => requestAnimationFrame(resolve));
      onProgress?.({
        phase: 'processing',
        framesProcessed: inferIdx + 1,
        totalFrames: totalInferFrames,
        device,
      });
    }
  }

  // ── 6. Finalize recording ──────────────────────────────────────────────────
  URL.revokeObjectURL(videoUrl);

  let outputBlob;
  if (videoEncoder && muxer) {
    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();
    outputBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
  } else if (recorder) {
    recorder.stop();
    await new Promise(resolve => { recorder.onstop = resolve; });
    outputBlob = new Blob(recordedChunks, { type: 'video/webm' });
  } else {
    throw new Error('No output was recorded — encoder was never initialized.');
  }

  // ── 7. Compute stats & return ──────────────────────────────────────────────
  const stats = computeStats(repCounter, allAngles, allConfidences, duration, exerciseType);

  return {
    signed_url: URL.createObjectURL(outputBlob),
    metadata: {
      rep_count:                repCounter.repCount,
      duration_sec:             duration,
      exercise_type:            exerciseType,
      detected_exercise_type:   null,
      exercise_confidence:      null,
      camera_angle_warnings:    [],
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
