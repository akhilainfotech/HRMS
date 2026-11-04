FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    FACE_DETECTOR_MODEL=/models/face_detection_yunet_2023mar.onnx \
    FACE_RECOGNITION_MODEL=/models/face_recognition_sface_2021dec.onnx \
    FACE_MODEL_ID=opencv-yunet-sface-v1

WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY download_models.py ./download_models.py
RUN python download_models.py && rm download_models.py
COPY app ./app
USER 10001:10001
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
