#!/usr/bin/env python3
"""
export_coreml.py — Export YOLOv8s-pose to CoreML (.mlpackage)
==============================================================
Targets Apple Neural Engine (ANE) via coremltools compute_units=ALL.
Run once on the Mac from services/cv-engine/ with the venv active:

    python export_coreml.py

Output: yolov8s-pose.mlpackage  (~100 MB, Mac-only, git-ignored)
"""
from ultralytics import YOLO
import coremltools as ct
import os

MODEL_PT   = "yolov8s-pose.pt"
MODEL_OUT  = "yolov8s-pose.mlpackage"

print("═══════════════════════════════════════════")
print(" YOLOv8s-Pose → CoreML Export")
print(" Target: Apple Neural Engine (ANE)")
print("═══════════════════════════════════════════")

if not os.path.exists(MODEL_PT):
    raise FileNotFoundError(f"Source model not found: {MODEL_PT}")

print(f"\n→ Loading {MODEL_PT}...")
model = YOLO(MODEL_PT)

print("→ Exporting to CoreML (nms=False for manual postprocessing)...")
# nms=False keeps the raw (1, 56, 8400) output tensor,
# matching the ONNX / DML postprocessing pipeline exactly.
export_path = model.export(
    format="coreml",
    nms=False,
    imgsz=640,
    half=False,        # float32 for ANE compatibility
)

print(f"\n→ Export written to: {export_path}")

# Reload with coremltools to verify ANE compute units & inspect I/O names
print("\n→ Verifying model with coremltools...")
ml_model = ct.models.MLModel(MODEL_OUT, compute_units=ct.ComputeUnit.ALL)
spec = ml_model.get_spec()

input_names  = [i.name for i in spec.description.input]
output_names = [o.name for o in spec.description.output]

print(f"  ✓ Input names:  {input_names}")
print(f"  ✓ Output names: {output_names}")
print(f"  ✓ Compute units: ALL (targets ANE + GPU + CPU)")

print("\n═══════════════════════════════════════════")
print(f" ✅ CoreML export complete: {MODEL_OUT}")
print("═══════════════════════════════════════════")
print("\nIMPORTANT: Add these output name(s) to coreml_pose.py if they differ")
print(f"  from 'var_' prefix: {output_names}")
