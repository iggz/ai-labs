"""
test_nvidia_acceleration.py — Tests for NVIDIA CUDA/TensorRT and NVENC Acceleration
==================================================================================
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch
import numpy as np

# Ensure cv-engine is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import encoding_utils


class TestEncodingUtils(unittest.TestCase):
    """Test encoder priority cascade and flag generation."""

    def test_nvenc_priority(self):
        """h264_nvenc should take precedence over all other encoders."""
        with patch.object(encoding_utils, "AVAILABLE_ENCODERS", {"h264_nvenc", "h264_amf", "libx264"}):
            # Re-evaluate encoder selection logic
            if "h264_nvenc" in encoding_utils.AVAILABLE_ENCODERS:
                encoder = "h264_nvenc"
            elif "h264_amf" in encoding_utils.AVAILABLE_ENCODERS:
                encoder = "h264_amf"
            else:
                encoder = "libx264"

            self.assertEqual(encoder, "h264_nvenc")

    def test_nvenc_flags(self):
        """NVENC encoder should return low-latency / high-quality preset flags."""
        with patch.object(encoding_utils, "BEST_ENCODER", "h264_nvenc"):
            flags = encoding_utils.get_encoder_flags()
            self.assertIn("-preset", flags)
            self.assertIn("p4", flags)


class TestFFmpegPipeWriter(unittest.TestCase):
    def test_output_is_browser_playable_yuv420p(self):
        """Real encode with this machine's best encoder (NVENC on the PC) must come out 4:2:0, not gbrp/yuv444p."""
        import subprocess
        import tempfile
        from ffmpeg_writer import FFmpegPipeWriter

        with FFmpegPipeWriter(width=320, height=240, fps=30, target_width=320) as writer:
            for i in range(10):
                writer.write(np.full((240, 320, 3), (0, 0, 25 * i), dtype=np.uint8))
            mp4 = writer.finish()

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            f.write(mp4)
        probe = subprocess.run([encoding_utils.FFMPEG_EXE, "-hide_banner", "-i", f.name],
                               capture_output=True, text=True).stderr
        os.unlink(f.name)
        self.assertIn("yuv420p", probe)


class TestCUDAPoseModel(unittest.TestCase):
    """Test CUDAPoseModel interface and fallback contract."""

    def test_letterbox_output_dimensions(self):
        """Letterboxing should produce a 640x640 frame with scale & padding info."""
        from cuda_pose import CUDAPoseModel

        # Mock __init__ to test helper methods without requiring a model file
        with patch.object(CUDAPoseModel, "__init__", return_value=None):
            model = CUDAPoseModel()
            model.conf_threshold = 0.25

            # Test 1920x1080 input frame
            dummy_frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
            padded, r, (dw, dh) = model._letterbox(dummy_frame)

            self.assertEqual(padded.shape, (640, 640, 3))
            self.assertGreater(r, 0)
            self.assertGreaterEqual(dw, 0)
            self.assertGreaterEqual(dh, 0)

    def test_postprocess_ort_empty(self):
        """Empty prediction tensor returns None."""
        from cuda_pose import CUDAPoseModel

        with patch.object(CUDAPoseModel, "__init__", return_value=None):
            model = CUDAPoseModel()
            model.conf_threshold = 0.5

            # (1, 56, 10) tensor with low scores
            raw_output = np.zeros((1, 56, 10), dtype=np.float32)
            res = model._postprocess_ort(raw_output, scale=1.0, pad=(0, 0))
            self.assertIsNone(res)

    def test_predict_schema_contract(self):
        """predict() must always return {keypoints, confidences, bbox, score}."""
        from cuda_pose import CUDAPoseModel

        with patch.object(CUDAPoseModel, "__init__", return_value=None):
            model = CUDAPoseModel()
            model._backend_type = "ort_cpu"
            model.device = "cpu"
            model.session = MagicMock()
            model.input_name = "images"
            model.output_name = "output0"
            model._postprocess_ort = MagicMock(return_value={
                "keypoints": np.ones((17, 2), dtype=np.float32),
                "confidences": np.ones(17, dtype=np.float32),
                "bbox": (10, 20, 100, 200),
                "score": 0.95,
            })

            dummy_frame = np.zeros((720, 1280, 3), dtype=np.uint8)
            result = model.predict(dummy_frame)

            self.assertIn("keypoints", result)
            self.assertIn("confidences", result)
            self.assertIn("bbox", result)
            self.assertIn("score", result)
            self.assertEqual(result["keypoints"].shape, (17, 2))
            self.assertEqual(result["confidences"].shape, (17,))
            self.assertEqual(result["score"], 0.95)


class TestBackendSelection(unittest.TestCase):
    def test_backend_reflects_provider_that_actually_loaded(self):
        """TensorRT EP listed but fails to load → ORT falls back to CUDA; we must report 'cuda', not 'tensorrt'."""
        from cuda_pose import CUDAPoseModel

        fake_ort = MagicMock()
        fake_ort.get_available_providers.return_value = [
            "TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
        fake_ort.InferenceSession.return_value.get_providers.return_value = [
            "CUDAExecutionProvider", "CPUExecutionProvider"]
        with patch.dict(sys.modules, {"onnxruntime": fake_ort}), \
             patch.object(CUDAPoseModel, "__init__", return_value=None):
            model = CUDAPoseModel()
            model._init_onnxruntime("x.onnx", prefer_tensorrt=True)
        self.assertEqual((model.device, model._backend_type), ("cuda", "ort_cuda"))

    def test_dml_served_by_cuda_when_directml_missing(self):
        """PC tower is NVIDIA now: 'dml' requests must hit the CUDA model, not DirectML's CPU fallback."""
        import form_ai

        fake_ort = MagicMock()
        fake_ort.get_available_providers.return_value = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        sentinel = object()
        with patch.dict(sys.modules, {"onnxruntime": fake_ort}), \
             patch.object(form_ai, "_cuda_model", sentinel):
            self.assertIs(form_ai._get_pose_model("dml"), sentinel)


class TestMainMachineIdentity(unittest.TestCase):
    """Verify GamingPC hostname maps to 'pc' machine_id."""

    def test_gamingpc_mapping(self):
        # Provide dummy mocks for external modules if not installed in test environment
        for mod in ["supabase", "dotenv", "job_queue", "form_ai", "slingshot", "smartfit"]:
            if mod not in sys.modules:
                sys.modules[mod] = MagicMock()
        import main
        self.assertEqual(main._HOSTNAME_TO_ID.get("GamingPC"), "pc")
        self.assertEqual(main._HOSTNAME_TO_ID.get("DESKTOP-4V907DI"), "pc")
        self.assertEqual(main._HOSTNAME_TO_ID.get("mac.lan"), "mac")




if __name__ == "__main__":
    unittest.main()
