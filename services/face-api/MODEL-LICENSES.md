# Face model sources and licenses

The container build downloads these exact OpenCV Zoo model files and verifies their SHA-256 digests before packaging them:

- YuNet detector: `face_detection_yunet_2023mar.onnx`, SHA-256 `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`. The upstream model directory states MIT licensing.
- SFace recognizer: `face_recognition_sface_2021dec.onnx`, SHA-256 `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`. The upstream model directory states Apache-2.0 licensing.

Upstream model documentation:

- https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface

Review each upstream license and your organization's biometric-data requirements before using employee images in production.
