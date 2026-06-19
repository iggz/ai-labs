#!/usr/bin/env python3
"""Export YOLOv8s-pose to ONNX for OpenCV DNN inference."""
from ultralytics import YOLO

model = YOLO("yolov8s-pose.pt")
model.export(
    format="onnx",
    opset=12,          # Broadest OpenCV DNN compatibility
    simplify=True,     # onnx-simplifier for layer fusion
    dynamic=False,     # Fixed 640x640 input = faster inference
    imgsz=640,
)
print("Exported: yolov8s-pose.onnx")
