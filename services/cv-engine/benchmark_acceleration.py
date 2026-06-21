"""
benchmark_acceleration.py — Performance Benchmarking Tool
==========================================================
Compares CPU vs. AMD GPU execution speeds for both YOLOv8-pose inference
(OpenCV DNN vs. ONNX Runtime DirectML) and video encoding (CPU libx264 vs. GPU hardware).
"""
import os
import sys
import time
import numpy as np
import cv2

# Ensure we can import modules from current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dnn_pose import OpenCVPoseModel
from dml_pose import DMLPoseModel
from ffmpeg_writer import FFmpegPipeWriter
import encoding_utils


def generate_synthetic_frames(num_frames=100, width=1280, height=720):
    """Generate synthetic frames in memory to avoid disk I/O bottlenecks."""
    print(f"Generating {num_frames} synthetic {width}x{height} frames...")
    frames = []
    for i in range(num_frames):
        # Create a blank black frame
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # Draw some shapes moving across the screen to simulate a workout
        cx = int(width / 2 + 200 * np.sin(2 * np.pi * i / 30))
        cy = int(height / 2 + 100 * np.cos(2 * np.pi * i / 30))
        cv2.circle(frame, (cx, cy), 80, (0, 255, 0), -1)  # "head"
        cv2.rectangle(frame, (cx - 40, cy + 80), (cx + 40, cy + 300), (255, 0, 0), -1)  # "torso"
        frames.append(frame)
    return frames


def benchmark_inference(frames):
    """Compare CPU inference (OpenCV DNN) vs AMD GPU inference (DirectML)."""
    onnx_path = "yolov8s-pose.onnx"
    if not os.path.exists(onnx_path):
        print(f"\n[ERROR] Model file '{onnx_path}' not found!")
        print("Please run 'setup_win.ps1' first to export the model.")
        return None

    print("\n" + "="*50)
    print(" 1. YOLOv8-POSE INFERENCE BENCHMARK")
    print("="*50)

    # A. CPU (OpenCV DNN)
    print("Loading OpenCV DNN CPU model...")
    try:
        cpu_model = OpenCVPoseModel(onnx_path)
        # Force CPU execution target
        cpu_model.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        cpu_model.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        cpu_model.device = "cpu"
    except Exception as e:
        print(f"Failed to load OpenCV CPU model: {e}")
        return None

    # Warmup
    print("Warming up CPU model...")
    for _ in range(5):
        _ = cpu_model.predict(frames[0])

    print(f"Running CPU inference over {len(frames)} frames...")
    t0 = time.perf_counter()
    for frame in frames:
        _ = cpu_model.predict(frame)
    t1 = time.perf_counter()
    cpu_time = t1 - t0
    cpu_fps = len(frames) / cpu_time
    cpu_latency = (cpu_time / len(frames)) * 1000
    print(f"  -> CPU Result: {cpu_fps:.2f} FPS | Avg Latency: {cpu_latency:.1f}ms")

    # B. GPU (DirectML ONNX Runtime)
    print("\nLoading ONNX Runtime DirectML model...")
    try:
        gpu_model = DMLPoseModel(onnx_path, use_dml=True)
    except Exception as e:
        print(f"Failed to load DirectML model: {e}")
        return None

    # Warmup
    print("Warming up DirectML model...")
    for _ in range(5):
        _ = gpu_model.predict(frames[0])

    print(f"Running DirectML GPU inference over {len(frames)} frames...")
    t0 = time.perf_counter()
    for frame in frames:
        _ = gpu_model.predict(frame)
    t1 = time.perf_counter()
    gpu_time = t1 - t0
    gpu_fps = len(frames) / gpu_time
    gpu_latency = (gpu_time / len(frames)) * 1000
    print(f"  -> GPU DirectML Result: {gpu_fps:.2f} FPS | Avg Latency: {gpu_latency:.1f}ms")

    speedup = cpu_time / gpu_time
    print(f"\nInference Acceleration Speedup: {speedup:.2f}x")
    return {
        "cpu_fps": cpu_fps,
        "cpu_latency": cpu_latency,
        "gpu_fps": gpu_fps,
        "gpu_latency": gpu_latency,
        "speedup": speedup
    }


def benchmark_encoding(frames):
    """Compare CPU libx264 encoding vs GPU hardware accelerated encoding."""
    print("\n" + "="*50)
    print(" 2. VIDEO ENCODING BENCHMARK")
    print("="*50)

    # Store original best encoder
    orig_best_encoder = encoding_utils.BEST_ENCODER
    orig_hw = encoding_utils.USE_HW_ENCODER

    # A. CPU Encoding (libx264)
    print("Testing CPU Encoding (libx264)...")
    encoding_utils.BEST_ENCODER = "libx264"
    encoding_utils.USE_HW_ENCODER = False

    # Warmup / check
    h, w = frames[0].shape[:2]
    try:
        writer = FFmpegPipeWriter(width=w, height=h, fps=30)
        writer.write(frames[0])
        _ = writer.finish()
    except Exception as e:
        print(f"CPU Encoder failed: {e}")
        return None

    t0 = time.perf_counter()
    writer = FFmpegPipeWriter(width=w, height=h, fps=30)
    for frame in frames:
        writer.write(frame)
    _ = writer.finish()
    t1 = time.perf_counter()
    cpu_time = t1 - t0
    cpu_fps = len(frames) / cpu_time
    print(f"  -> CPU Encoder (libx264) Result: {cpu_fps:.2f} FPS | Total Time: {cpu_time:.2f}s")

    # B. GPU Encoding
    hw_encoder = orig_best_encoder
    if not orig_hw or hw_encoder == "libx264":
        print("\n[WARNING] No hardware accelerated video encoder detected (e.g. h264_amf or h264_mf).")
        print("Hardware video encoding benchmark skipped.")
        return None

    print(f"\nTesting GPU Hardware Encoding ({hw_encoder})...")
    encoding_utils.BEST_ENCODER = hw_encoder
    encoding_utils.USE_HW_ENCODER = True

    try:
        writer = FFmpegPipeWriter(width=w, height=h, fps=30)
        writer.write(frames[0])
        _ = writer.finish()
    except Exception as e:
        print(f"GPU Encoder ({hw_encoder}) failed: {e}")
        # Restore original state
        encoding_utils.BEST_ENCODER = orig_best_encoder
        encoding_utils.USE_HW_ENCODER = orig_hw
        return None

    t0 = time.perf_counter()
    writer = FFmpegPipeWriter(width=w, height=h, fps=30)
    for frame in frames:
        writer.write(frame)
    _ = writer.finish()
    t1 = time.perf_counter()
    gpu_time = t1 - t0
    gpu_fps = len(frames) / gpu_time
    print(f"  -> GPU Encoder ({hw_encoder}) Result: {gpu_fps:.2f} FPS | Total Time: {gpu_time:.2f}s")

    # Restore original state
    encoding_utils.BEST_ENCODER = orig_best_encoder
    encoding_utils.USE_HW_ENCODER = orig_hw

    speedup = cpu_time / gpu_time
    print(f"\nEncoding Acceleration Speedup: {speedup:.2f}x")
    return {
        "encoder_name": hw_encoder,
        "cpu_fps": cpu_fps,
        "gpu_fps": gpu_fps,
        "speedup": speedup
    }


def main():
    print("="*60)
    print("   HHB CV Engine GPU Acceleration Benchmark   ")
    print("="*60)

    # Check execution providers
    import onnxruntime as ort
    print(f"ONNX Runtime version: {ort.__version__}")
    print(f"Available Providers: {ort.get_available_providers()}")
    print(f"FFmpeg binary path: {encoding_utils.FFMPEG_EXE}")
    print(f"Detected hardware H.264 encoder: {encoding_utils.get_encoder()}")

    # Use 100 frames for benchmark
    frames = generate_synthetic_frames(num_frames=100, width=1280, height=720)

    inf_res = benchmark_inference(frames)
    enc_res = benchmark_encoding(frames)

    print("\n" + "="*60)
    print("   BENCHMARK SUMMARY")
    print("="*60)

    if inf_res:
        print(f"Inference (YOLOv8-pose 640x640):")
        print(f"  - CPU (OpenCV DNN):    {inf_res['cpu_fps']:6.2f} FPS ({inf_res['cpu_latency']:.1f}ms/frame)")
        print(f"  - GPU (DirectML ORT):  {inf_res['gpu_fps']:6.2f} FPS ({inf_res['gpu_latency']:.1f}ms/frame)")
        print(f"  - Acceleration:        {inf_res['speedup']:.2f}x speedup")

    if enc_res:
        print(f"\nVideo Encoding (H.264 1280x720):")
        print(f"  - CPU (libx264):       {enc_res['cpu_fps']:6.2f} FPS")
        print(f"  - GPU ({enc_res['encoder_name']}):       {enc_res['gpu_fps']:6.2f} FPS")
        print(f"  - Acceleration:        {enc_res['speedup']:.2f}x speedup")
    else:
        print("\nVideo Encoding: Hardware acceleration not evaluated (no GPU encoder or test failed).")

    print("="*60)


if __name__ == "__main__":
    main()
