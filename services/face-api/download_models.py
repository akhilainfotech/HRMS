"""Fetch pinned, checksummed OpenCV Zoo models during the container build."""

from __future__ import annotations

import hashlib
import urllib.request
from pathlib import Path


MODELS = (
    (
        "face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    ),
    (
        "face_recognition_sface_2021dec.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    ),
)


def main() -> None:
    model_dir = Path("/models")
    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, url, expected_sha256 in MODELS:
        destination = model_dir / filename
        request = urllib.request.Request(url, headers={"User-Agent": "HRMS-face-api-build"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read()
        actual_sha256 = hashlib.sha256(data).hexdigest()
        if actual_sha256 != expected_sha256:
            raise RuntimeError(f"SHA-256 mismatch for {filename}; refusing the model file")
        destination.write_bytes(data)
        print(f"Installed verified face model: {filename}")


if __name__ == "__main__":
    main()
