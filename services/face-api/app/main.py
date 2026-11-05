from __future__ import annotations

import hmac
import os
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import PurePosixPath
from typing import Annotated

import cv2
import httpx
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")
    face_api_token: str
    supabase_url: str
    supabase_secret_key: str
    face_detector_model: str
    face_recognition_model: str
    face_model_id: str = "opencv-yunet-sface-v1"
    face_match_threshold: float | None = None
    face_bucket: str = "employee-face-photos"
    max_image_bytes: int = 4 * 1024 * 1024


@lru_cache
def settings() -> Settings:
    return Settings()


app = FastAPI(title="HRMS Face Service", docs_url=None, redoc_url=None)
EMPLOYEE_ID = re.compile(r"^[A-Z0-9][A-Z0-9_-]{1,31}$")
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
MIN_FACE_CONFIDENCE = 0.75
MAX_DETECTION_EDGE = 1600


def require_service_token(authorization: Annotated[str | None, Header()] = None) -> None:
    configured = settings().face_api_token
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not configured or not hmac.compare_digest(supplied, configured):
        raise HTTPException(status_code=401, detail="Unauthorized")


@lru_cache(maxsize=1)
def get_models():
    cfg = settings()
    if not os.path.isfile(cfg.face_detector_model) or not os.path.isfile(cfg.face_recognition_model):
        raise HTTPException(status_code=503, detail="Licensed face model files are not configured")
    detector = cv2.FaceDetectorYN_create(cfg.face_detector_model, "", (320, 320), 0.75, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF_create(cfg.face_recognition_model, "")
    return detector, recognizer


async def read_image(file: UploadFile) -> tuple[bytes, np.ndarray]:
    cfg = settings()
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPEG or PNG image")
    raw = await file.read(cfg.max_image_bytes + 1)
    if not raw or len(raw) > cfg.max_image_bytes:
        max_megabytes = max(1, cfg.max_image_bytes // (1024 * 1024))
        raise HTTPException(status_code=413, detail=f"Image must be between 1 byte and {max_megabytes} MB")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise HTTPException(status_code=400, detail="Image could not be decoded")
    return raw, image


def extract_single_face(image: np.ndarray) -> np.ndarray:
    detector, recognizer = get_models()
    height, width = image.shape[:2]
    longest_edge = max(width, height)
    if longest_edge > MAX_DETECTION_EDGE:
        scale = MAX_DETECTION_EDGE / longest_edge
        image = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, detections = detector.detect(image)
    if detections is None or len(detections) != 1:
        raise HTTPException(status_code=422, detail="Image must contain exactly one clear face")
    detection = detections[0]
    x, y, face_width, face_height = detection[:4]
    if float(detection[-1]) < MIN_FACE_CONFIDENCE:
        raise HTTPException(status_code=422, detail="Face is unclear. Use a front-facing, well-lit photo with one visible face")
    if face_width * face_height < width * height * 0.06:
        raise HTTPException(status_code=422, detail="Face occupies too little of the photo. Move closer and retry")
    aligned = recognizer.alignCrop(image, detection.reshape(1, -1))
    embedding = recognizer.feature(aligned).astype(np.float32).flatten()
    if embedding.shape != (128,) or not np.isfinite(embedding).all():
        raise HTTPException(status_code=503, detail="Face model returned an invalid embedding")
    norm = float(np.linalg.norm(embedding))
    if norm == 0:
        raise HTTPException(status_code=422, detail="Could not create a face template")
    return embedding / norm


def supabase_headers(prefer: str | None = None) -> dict[str, str]:
    cfg = settings()
    # Secret API keys belong in apikey; unlike legacy service_role JWTs, they
    # are not access tokens and must not be sent as Authorization bearer tokens.
    headers = {"apikey": cfg.supabase_secret_key, "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    return headers


def supabase_url(path: str) -> str:
    return f"{settings().supabase_url.rstrip('/')}{path}"


async def require_employee(employee_id: str) -> None:
    if not EMPLOYEE_ID.fullmatch(employee_id):
        raise HTTPException(status_code=400, detail="Invalid employee ID")
    async with httpx.AsyncClient(timeout=8) as client:
        response = await client.get(
            supabase_url("/rest/v1/employees"),
            params={"employee_id": f"eq.{employee_id}", "select": "employee_id", "limit": "1"},
            headers=supabase_headers(),
        )
    if response.status_code != 200 or not response.json():
        raise HTTPException(status_code=404, detail="Employee ID was not found")


@app.get("/health")
def health():
    cfg = settings()
    models_ready = os.path.isfile(cfg.face_detector_model) and os.path.isfile(cfg.face_recognition_model)
    threshold_ready = cfg.face_match_threshold is not None and 0 < cfg.face_match_threshold < 1
    return {"status": "ready" if models_ready and threshold_ready else "not_configured", "model_id": cfg.face_model_id, "models_ready": models_ready, "threshold_configured": threshold_ready, "liveness": "not_implemented"}


@app.post("/internal/employees/{employee_id}/enrollment", dependencies=[Depends(require_service_token)])
async def enroll_face(
    employee_id: str,
    enrolled_by: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
):
    await require_employee(employee_id)
    raw, decoded = await read_image(image)
    embedding = extract_single_face(decoded)
    cfg = settings()
    suffix = ".png" if image.content_type == "image/png" else ".jpg"
    photo_path = str(PurePosixPath(employee_id) / f"enrollment{suffix}")
    storage_headers = supabase_headers()
    storage_headers.update({"Content-Type": image.content_type or "image/jpeg", "x-upsert": "true"})
    async with httpx.AsyncClient(timeout=20) as client:
        photo_response = await client.put(supabase_url(f"/storage/v1/object/{cfg.face_bucket}/{photo_path}"), content=raw, headers=storage_headers)
        if photo_response.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail="Could not store enrollment photo in the private bucket")
        rpc_response = await client.post(
            supabase_url("/rest/v1/rpc/upsert_employee_face_template"),
            json={"p_employee_id": employee_id, "p_embedding": embedding.tolist(), "p_model_id": cfg.face_model_id, "p_enrolled_by": enrolled_by},
            headers=supabase_headers(),
        )
        if rpc_response.status_code >= 300:
            raise HTTPException(status_code=502, detail="Could not bind face template to employee ID")
        employee_response = await client.patch(
            supabase_url("/rest/v1/employees"), params={"employee_id": f"eq.{employee_id}"},
            json={"enrollment_photo_path": photo_path, "face_enrolled_at": datetime.now(timezone.utc).isoformat(), "face_model_id": cfg.face_model_id},
            headers=supabase_headers("return=minimal"),
        )
        if employee_response.status_code >= 300:
            raise HTTPException(status_code=502, detail="Face template saved but employee enrollment status was not updated")
    return {"employee_id": employee_id, "enrolled": True, "model_id": cfg.face_model_id}


@app.delete("/internal/employees/{employee_id}/enrollment", dependencies=[Depends(require_service_token)])
async def delete_face_enrollment(employee_id: str):
    if not EMPLOYEE_ID.fullmatch(employee_id):
        raise HTTPException(status_code=400, detail="Invalid employee ID")
    cfg = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        employee = await client.get(supabase_url("/rest/v1/employees"), params={"employee_id": f"eq.{employee_id}", "select": "enrollment_photo_path", "limit": "1"}, headers=supabase_headers())
        if employee.status_code >= 300:
            raise HTTPException(status_code=502, detail="Could not read employee enrollment path")
        template = await client.delete(supabase_url("/rest/v1/face_templates"), params={"employee_id": f"eq.{employee_id}"}, headers=supabase_headers())
        if template.status_code >= 300:
            raise HTTPException(status_code=502, detail="Could not remove face template")
        rows = employee.json()
        if rows and rows[0].get("enrollment_photo_path"):
            stored = await client.delete(supabase_url(f"/storage/v1/object/{cfg.face_bucket}"), json={"prefixes": [rows[0]["enrollment_photo_path"]]}, headers=supabase_headers())
            if stored.status_code >= 300:
                raise HTTPException(status_code=502, detail="Could not remove stored enrollment image")
    return {"employee_id": employee_id, "deleted": True}


@app.post("/internal/employees/{employee_id}/verify", dependencies=[Depends(require_service_token)])
async def verify_face(employee_id: str, image: Annotated[UploadFile, File()]):
    await require_employee(employee_id)
    cfg = settings()
    if cfg.face_match_threshold is None or not 0 < cfg.face_match_threshold < 1:
        raise HTTPException(status_code=503, detail="Face match threshold must be calibrated before check-in is enabled")
    _, decoded = await read_image(image)
    candidate = extract_single_face(decoded)
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(supabase_url("/rest/v1/rpc/match_employee_face"), json={"p_employee_id": employee_id, "p_embedding": candidate.tolist()}, headers=supabase_headers())
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail="Face comparison is unavailable")
    matches = response.json()
    if not matches:
        raise HTTPException(status_code=409, detail="No face is enrolled for this employee ID")
    match = matches[0]
    if match["model_id"] != cfg.face_model_id:
        raise HTTPException(status_code=409, detail="Enrolled face uses a different model; re-enrollment is required")
    similarity = float(match["similarity"])
    return {"employee_id": employee_id, "matched": similarity >= cfg.face_match_threshold, "similarity": similarity, "model_id": cfg.face_model_id}

