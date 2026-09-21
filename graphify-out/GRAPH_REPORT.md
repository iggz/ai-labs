# Graph Report - ai-labs  (2026-09-19)

## Corpus Check
- 87 files · ~68,710 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 688 nodes · 975 edges · 51 communities (41 shown, 10 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 52 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d3362b4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 48|Community 48]]

## God Nodes (most connected - your core abstractions)
1. `UnifiedDebugLogger` - 27 edges
2. `fetch()` - 19 edges
3. `_process_form_ai_sync()` - 18 edges
4. `FFmpegPipeWriter` - 14 edges
5. `CVJobQueue` - 13 edges
6. `DebugLogger` - 13 edges
7. `KalmanSmoother` - 12 edges
8. `OpenCVPoseModel` - 10 edges
9. `processVideoOnDevice()` - 10 edges
10. `CUDAPoseModel` - 9 edges

## Surprising Connections (you probably didn't know these)
- `fetchBenchmarks()` --calls--> `fetch()`  [INFERRED]
  web/src/pages/BenchmarkPage.jsx → src/index.js
- `allocateBatchId()` --calls--> `fetch()`  [INFERRED]
  web/src/lib/inference/testAllOrchestrator.js → src/index.js
- `saveBatchMetadata()` --calls--> `fetch()`  [INFERRED]
  web/src/lib/inference/testAllOrchestrator.js → src/index.js
- `deleteAnalysis()` --calls--> `fetch()`  [INFERRED]
  web/src/lib/cvApi.js → src/index.js
- `getCVHealth()` --calls--> `fetch()`  [INFERRED]
  web/src/lib/cvApi.js → src/index.js

## Import Cycles
- None detected.

## Communities (51 total, 10 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (34): NAV_LINKS, Navbar(), FormAICoach(), FormAICoachChat(), SlingShotUploader(), GARMENT_ICONS, GARMENT_LABELS, GARMENT_TYPES (+26 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (26): calculateAngle(), EXERCISE_JOINTS, getExerciseAngle(), captureFrames(), createVideoEncoder(), processVideoOnDevice(), _chwBuf, _computeIoU() (+18 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (20): BenchmarkBarChart(), PROTOCOL_COLORS, PROTOCOL_LABELS, BenchmarkDetailCard(), formatBytes(), formatMs(), percentile(), PROTOCOL_COLORS (+12 more)

### Community 3 - "Community 3"
Cohesion: 0.15
Nodes (17): _angle_deg(), _avg_shoulder_y_frac(), ExerciseClassifier, _max_angle(), _mean_angle(), _min_angle(), exercise_classifier.py — Heuristic Exercise Auto-Detector ======================, Minimum 3-point angle across confident frames. (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (17): FeatureDisclosure(), FEATURES_AVAILABLE, FEATURES_UNAVAILABLE, FormAIAudioEngine, CAMERA_ANGLE_GUIDANCE, CAMERA_ANGLES, ConfigureAndUploadStep(), EXERCISES (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (43): BackgroundTasks, BaseModel, analyze_form(), analyze_slingshot(), analyze_smartfit(), _checkpoint(), crawl_exercise(), CrawlRequest (+35 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (6): captureBattery(), captureDeviceInfo(), captureMemory(), ErrorCodes, hashVideoFile(), UnifiedDebugLogger

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (30): benchmark_encoding(), benchmark_inference(), generate_synthetic_frames(), main(), benchmark_acceleration.py — Performance Benchmarking Tool ======================, Compare CPU libx264 encoding vs GPU hardware accelerated encoding., Generate synthetic frames in memory to avoid disk I/O bottlenecks., Compare CPU inference (OpenCV DNN) vs AMD GPU inference (DirectML). (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (17): CVJobQueue, Job, JobStatus, QueueFullError, job_queue.py — Bounded Asyncio Job Queue ===================================== S, Return current status of a job by ID., Current number of pending jobs., Main loop — processes one job at a time sequentially. (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (42): calculate_angle(), compute_angle_confidence(), compute_session_stats(), compute_symmetry_metrics(), _compute_tempo_phases(), correct_joint_angle(), count_reps(), _empty_tempo_result() (+34 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (24): bytes_to_mp4(), bytes_to_mp4_piped(), compress_video_hardware(), compress.py — Hardware Video Encoding ====================================== Wra, Re-encode video bytes via FFmpeg stdin→stdout pipes.     Zero temp files on disk, Re-encode a video using hardware acceleration when available.      Args:, Re-encode raw video bytes → hardware-compressed MP4 bytes.     Uses named temp f, _detect_available_encoders() (+16 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (14): cardStyle, fmt(), linkStyle, loadingStyle, METHOD_COLORS, METHOD_LABELS, pageStyle, shareButtonStyle (+6 more)

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (8): CUDAPoseModel, cuda_pose.py — High-Performance NVIDIA CUDA/TensorRT YOLO Pose Inference =======, Resize with aspect-ratio-preserving padding to 640x640., Parse YOLO pose raw output tensor (1, 56, 8400)., Run inference on a single BGR frame., Hardware-accelerated YOLO pose estimation on NVIDIA GPUs.     Supports ONNX Runt, Load via Ultralytics YOLO with CUDA acceleration., Load via ONNX Runtime with TensorRT / CUDA execution provider.

### Community 14 - "Community 14"
Cohesion: 0.14
Nodes (17): create_neon_skeleton_frame(), draw_rep_counter(), draw_rom_gauge(), draw_speed_hud(), draw_velocity_trail(), fast_glow_blur(), _gauge_pct(), overlay.py — Premium Visual Overlay Renderers ================================== (+9 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (9): AngleHeatmap(), MemoryProfile(), DEFAULT_FILTERS, deleteLogEntry(), fetchBatches(), fetchDebugLog(), fetchDebugLogs(), safeJson() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (11): OpticalFlowTracker, optical_flow_tracker.py — Lucas-Kanade Optical Flow Keypoint Tracker ===========, Reset internal state (e.g. between different video clips or subjects)., Sparse optical flow tracker for pose keypoints.      Uses the Lukas-Kanade pyram, Merge YOLO detections with optical flow estimates.          For each keypoint:, KeypointSmoother, smoother.py — Kalman Filter Keypoint Smoother ==================================, Reset smoother state (call between videos). (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.20
Nodes (8): CoreMLPoseModel, coreml_pose.py — CoreML YOLOv8-Pose Inference via Apple Neural Engine ==========, Parse YOLOv8-pose raw output tensor (1, 56, 8400) → keypoints dict.         Iden, Run CoreML/ANE inference on a single BGR frame.         Returns the same dict fo, YOLOv8-pose inference via CoreML + Apple Neural Engine.      Produces the same (, Aspect-ratio-preserving resize + gray padding to MODEL_INPUT_SIZE.          Retu, BGR letterboxed frame → float32 NCHW RGB tensor in [0, 1].         Shape: (1, 3,, ndarray

### Community 23 - "Community 23"
Cohesion: 0.22
Nodes (8): AngleDetectionResult, CameraAngleDetector, camera_angle.py — Heuristic Camera Angle Auto-Detector =========================, Detect camera angle from keypoint horizontal spread., Compute the horizontal spread ratio for a single frame.          Takes the maxim, Detects camera angle from the first ≤30 frames of a pose sequence.      Usage::, ClassificationResult, NamedTuple

### Community 25 - "Community 25"
Cohesion: 0.25
Nodes (4): METHOD_COLORS, SORT_LABELS, SORT_MODES, TimingChart()

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (6): LensCorrector, lens_correction.py — Phone Camera Lens Distortion Correction ===================, Apply lens undistortion to a full video frame using precomputed remap         ta, Heuristically select a distortion preset based on the frame aspect         ratio, Corrects barrel distortion from phone cameras using OpenCV remap tables.      Re, Apply lens undistortion to an array of 2-D keypoint coordinates.          NaN ke

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (4): fmtBw(), getSegments(), NetworkWaterfall(), SEGMENTS

### Community 29 - "Community 29"
Cohesion: 0.43
Nodes (6): atomicIncrement(), COEP_HEADERS, CORS_HEADERS, fetch(), generateRunName(), jsonResponse()

### Community 30 - "Community 30"
Cohesion: 0.33
Nodes (3): LatencyPercentiles(), METHOD_COLORS, METHOD_LABELS

### Community 31 - "Community 31"
Cohesion: 0.33
Nodes (3): METHOD_COLORS, METHOD_LABELS, RegressionDetector()

### Community 33 - "Community 33"
Cohesion: 0.40
Nodes (3): BatchExplorer(), METHOD_PILLS, STATUS_BADGE

### Community 34 - "Community 34"
Cohesion: 0.40
Nodes (4): ConfidenceDrift(), METHOD_COLORS, PADDING, Y_TICKS

### Community 35 - "Community 35"
Cohesion: 0.40
Nodes (4): ALL_METHODS, DashboardFilters(), DEFAULT_FILTERS, METHOD_META

### Community 38 - "Community 38"
Cohesion: 0.40
Nodes (3): METHOD_ABBR, METHOD_COLORS, SummaryCards()

### Community 39 - "Community 39"
Cohesion: 0.24
Nodes (9): apply_watermark(), Alpha-blend a pre-loaded BGRA watermark onto the bottom-right corner.      Args:, _load_watermark(), process_slingshot(), slingshot.py — SlingShot Video Pipeline ========================================, Load and scale the HHB watermark to 22% of the cropped video width., Processor for the SlingShot pipeline. Accepts a payload dict with:         video, Two-pass pipeline:       Pass 1 — Track object centers to find the optimal horiz (+1 more)

### Community 40 - "Community 40"
Cohesion: 0.50
Nodes (3): BatteryImpact(), METHOD_COLORS, METHOD_LABELS

### Community 41 - "Community 41"
Cohesion: 0.50
Nodes (3): CostAllocator(), METHOD_COLORS, METHOD_LABELS

### Community 42 - "Community 42"
Cohesion: 0.50
Nodes (3): METHOD_COLORS, METHOD_LABELS, ThermalIndicator()

## Knowledge Gaps
- **84 isolated node(s):** `setup.sh script`, `COEP_HEADERS`, `CORS_HEADERS`, `DebugComparePage`, `DebugDashboardPage` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fetch()` connect `Community 29` to `Community 0`, `Community 2`, `Community 6`, `Community 15`, `Community 16`?**
  _High betweenness centrality (0.132) - this node is a cross-community bridge._
- **Why does `submitAnalysis()` connect `Community 0` to `Community 4`, `Community 29`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `_process_form_ai_sync()` connect `Community 9` to `Community 3`, `Community 10`, `Community 14`, `Community 20`, `Community 23`, `Community 26`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `fetch()` (e.g. with `.send()` and `allocateBatchId()`) actually correct?**
  _`fetch()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `_process_form_ai_sync()` (e.g. with `compute_session_stats()` and `count_reps()`) actually correct?**
  _`_process_form_ai_sync()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `FFmpegPipeWriter` (e.g. with `benchmark_encoding()` and `_process_form_ai_sync()`) actually correct?**
  _`FFmpegPipeWriter` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `angle_utils.py — Biomechanical Angle Utilities =================================`, `Compute the angle at vertex B formed by vectors BA and BC.      Args:         a,`, `Estimates camera elevation angle from femur/tibia segment ratio.      A level ca` to the rest of the system?**
  _226 weakly-connected nodes found - possible documentation gaps or missing edges._