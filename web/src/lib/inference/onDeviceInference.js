import { loadModel, inferFrame } from './onnxPoseInference.js';
import { KalmanSmoother } from './kalmanSmoother.js';
import { getExerciseAngle } from './angleCalculator.js';
import { RepCounter } from './repCounter.js';
import { drawFrame } from './skeletonRenderer.js';
import { computeStats } from './statsCalculator.js';

/**
 * Process a video entirely on-device using ONNX Runtime Web.
 *
 * Replaces onDeviceShim.js — signature changed from 3 positional args
 * to 2 args with an options object (onProgress merged in).
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
  // ── Read output format from Settings localStorage ──
  let outputFormat = 'webm';
  try {
    outputFormat = localStorage.getItem('formai_output_format') || 'webm';
  } catch { /* ignore — storage may be unavailable */ }

  // ── 1. Load video metadata ──
  const videoEl = document.createElement('video');
  videoEl.muted = true;
  videoEl.playsInline = true;
  const videoUrl = URL.createObjectURL(file);
  videoEl.src = videoUrl;

  await new Promise((resolve, reject) => {
    videoEl.onloadedmetadata = resolve;
    videoEl.onerror = () => reject(new Error('Failed to load video metadata'));
  });

  const { videoWidth: w, videoHeight: h, duration } = videoEl;
  const fps = 30;
  const totalFrames = Math.floor(duration * fps);

  onProgress?.({ phase: 'loading_model', framesProcessed: 0, totalFrames });

  // ── 2. Warm up ONNX model ──
  const { device } = await loadModel();

  // ── 3. Init pipeline components ──
  const smoother    = new KalmanSmoother();
  const repCounter  = new RepCounter(exerciseType);
  const allAngles        = [];
  const allConfidences   = [];

  // Source canvas (read frames from video)
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });

  // Output canvas (video + overlay)
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d');

  // ── 4. Recording setup ──
  let recorder      = null;
  let muxer         = null;
  let muxerTarget   = null;
  let videoEncoder  = null;
  const recordedChunks = [];

  if (outputFormat === 'mp4' && typeof VideoEncoder !== 'undefined') {
    // MP4 path: use VideoEncoder + mp4-muxer (WebCodecs API)
    const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
    muxerTarget = new ArrayBufferTarget();
    muxer = new Muxer({
      target: muxerTarget,
      video: {
        codec: 'avc',
        width: w,
        height: h,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });

    // VideoEncoder for H.264
    const encInit = await new Promise((resolve, reject) => {
      const enc = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: reject,
      });
      enc.configure({
        codec: 'avc1.42001f',
        width: w,
        height: h,
        bitrate: 4_000_000,
        framerate: fps,
      });
      resolve(enc);
    });
    videoEncoder = encInit;
  } else {
    // WebM path (MediaRecorder — widely supported)
    outputFormat = 'webm';  // force webm if VideoEncoder unavailable
    const stream = outCanvas.captureStream(fps);
    const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
      ? 'video/webm; codecs=vp9'
      : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    recorder.start();
  }

  // ── 5. Frame loop ──
  // Use requestVideoFrameCallback if available (Chrome, Safari 15.4+),
  // else fall back to seeked event
  const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let currentAngle = null;

  for (let frame = 0; frame < totalFrames; frame++) {
    const targetTime = frame / fps;

    // Seek to frame
    videoEl.currentTime = targetTime;
    await new Promise(resolve => {
      if (useRVFC) {
        videoEl.requestVideoFrameCallback(resolve);
      } else {
        videoEl.onseeked = resolve;
      }
    });

    // Draw video frame to source canvas
    srcCtx.drawImage(videoEl, 0, 0);
    const imageData = srcCtx.getImageData(0, 0, w, h);

    // Inference
    const detection = await inferFrame(imageData);

    let smoothedKpts = null;
    let smoothedConfs = null;
    let repCount = repCounter.repCount;
    let inRep = repCounter.inRep;

    if (detection) {
      const { smoothed, occlusionRatio } = smoother.update(
        detection.keypoints, detection.confidences
      );
      smoothedKpts  = smoothed;
      smoothedConfs = detection.confidences;

      const angleResult = getExerciseAngle(smoothed, smoothedConfs, exerciseType);
      if (angleResult) {
        currentAngle = angleResult.angle;
        allAngles.push(currentAngle);
        allConfidences.push(angleResult.confidence);
        const rep = repCounter.update(currentAngle);
        repCount = rep.repCount;
        inRep    = rep.inRep;
      }
    }

    // Draw output frame: original video + skeleton overlay
    outCtx.drawImage(videoEl, 0, 0);
    if (smoothedKpts && smoothedConfs) {
      drawFrame(outCtx, smoothedKpts, smoothedConfs, currentAngle,
                repCount, exerciseType, overlayMode, w, h, inRep);
    }

    // Encode frame
    if (videoEncoder) {
      // MP4 path: encode via VideoEncoder
      const videoFrame = new VideoFrame(outCanvas, {
        timestamp: Math.round(frame * (1_000_000 / fps)),  // microseconds
        duration:  Math.round(1_000_000 / fps),
      });
      const isKey = frame % 60 === 0;  // keyframe every ~2s
      videoEncoder.encode(videoFrame, { keyFrame: isKey });
      videoFrame.close();
    }
    // WebM path: MediaRecorder captures from canvas stream automatically

    // Progress callback — yield to browser every 3 frames to avoid blocking
    if (frame % 3 === 0 || frame === totalFrames - 1) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      onProgress?.({
        phase: 'processing',
        framesProcessed: frame + 1,
        totalFrames,
        device,
      });
    }
  }

  // ── 6. Finalize ──
  URL.revokeObjectURL(videoUrl);

  let outputBlob;
  if (videoEncoder && muxer) {
    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();
    outputBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
  } else {
    recorder.stop();
    await new Promise(resolve => { recorder.onstop = resolve; });
    outputBlob = new Blob(recordedChunks, { type: 'video/webm' });
  }

  // ── 7. Compute stats ──
  const stats = computeStats(repCounter, allAngles, allConfidences, duration, exerciseType);

  // ── 8. Return result (matches server response shape) ──
  return {
    signed_url: URL.createObjectURL(outputBlob),
    metadata: {
      rep_count: repCounter.repCount,
      duration_sec: duration,
      exercise_type: exerciseType,
      detected_exercise_type: null,
      exercise_confidence: null,
      camera_angle_warnings: [],
      stats,
    },
    processing_log: {
      on_device: true,
      output_format: outputFormat,
      total_frames_processed: totalFrames,
      device,
    },
  };
}
