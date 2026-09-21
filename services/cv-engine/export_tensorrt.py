#!/usr/bin/env python3
"""
export_tensorrt.py — Export YOLO Pose Models to TensorRT / ONNX for NVIDIA GPUs
=============================================================================
Exports Ultralytics YOLO11/YOLOv8 pose models to NVIDIA TensorRT engine format
with FP16 precision and fixed 640x640 input resolution for maximum Blackwell
Tensor Core throughput.

Usage:
  python export_tensorrt.py --model yolo11x-pose.pt --format engine --half
  python export_tensorrt.py --model yolo11m-pose.pt --format onnx
"""

import argparse
import sys
import os

try:
    from ultralytics import YOLO
except ImportError:
    print("[ERROR] Ultralytics is required. Run: pip install ultralytics>=8.3.0")
    sys.exit(1)


def export_model(model_name: str = "yolo11x-pose.pt", export_format: str = "engine", half: bool = True, imgsz: int = 640):
    print(f"Loading base model: {model_name}...")
    model = YOLO(model_name)

    print(f"Exporting to format='{export_format}', half={half}, imgsz={imgsz}...")
    export_args = {
        "format": export_format,
        "imgsz": imgsz,
        "dynamic": False,
    }

    if export_format == "engine":
        export_args["half"] = half
        export_args["device"] = 0
    elif export_format == "onnx":
        export_args["opset"] = 14
        export_args["simplify"] = True

    output_path = model.export(**export_args)
    print(f"\n[OK] Model successfully exported: {output_path}")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Export YOLO Pose model to TensorRT or ONNX")
    parser.add_argument(
        "--model",
        type=str,
        default="yolo11x-pose.pt",
        help="Model weight name or path (e.g. yolo11x-pose.pt, yolo11m-pose.pt, yolov8s-pose.pt)",
    )
    parser.add_argument(
        "--format",
        type=str,
        choices=["engine", "onnx"],
        default="engine",
        help="Export target format (engine=TensorRT, onnx=ONNX)",
    )
    parser.add_argument(
        "--half",
        action="store_true",
        default=True,
        help="Export with FP16 half precision for Tensor Cores (default: True)",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Input image resolution (default: 640)",
    )
    args = parser.parse_args()

    export_model(
        model_name=args.model,
        export_format=args.format,
        half=args.half,
        imgsz=args.imgsz,
    )


if __name__ == "__main__":
    main()
