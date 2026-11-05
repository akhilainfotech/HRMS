# Production deployment

Use the two existing Vercel projects as separate apps:

- HRMS website: `hrms-bmhx.vercel.app`, Root Directory `Web`.
- Face API: `hrms-psi-two.vercel.app`, Root Directory `services/face-api`.

The Face API project must build the Dockerfile. `services/face-api/vercel.json` selects Vercel's Container framework; the Docker build downloads the official YuNet and SFace ONNX files and verifies their SHA-256 digests. This Container runtime is currently in beta and uses Vercel's usage-based function billing.

## Face API Vercel project

Keep its Root Directory as `services/face-api`. Set these Production environment variables:

- `FACE_API_TOKEN`: a new random token that is also set on the website project
- `SUPABASE_URL`: the Supabase project URL
- `SUPABASE_SECRET_KEY`: a newly rotated Supabase secret key
- `FACE_BUCKET`: `employee-faces` (optional; this is the code default)
- `MAX_IMAGE_BYTES`: `4194304` (optional; this is the code default)

Remove any stale `FACE_DETECTOR_MODEL` or `FACE_RECOGNITION_MODEL` overrides unless they match `/models/face_detection_yunet_2023mar.onnx` and `/models/face_recognition_sface_2021dec.onnx`. The Dockerfile provides those paths and installs the files.

After deploying, visit `https://hrms-psi-two.vercel.app/health`. The API's `/` route intentionally returns `{"detail":"Not Found"}`. `/health` should show `models_ready: true`; it will show `threshold_configured: false` until a threshold is calibrated. Keep attendance verification disabled until that calibration is completed with representative, consented images.

## HRMS website Vercel project

Keep its Root Directory as `Web` and deploy it as a Next.js project. Set these Production environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`: the Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key
- `SUPABASE_SECRET_KEY`: the newly rotated Supabase secret key
- `FACE_API_URL`: `https://hrms-psi-two.vercel.app` (no `/health` or trailing slash)
- `FACE_API_TOKEN`: the same new random token set in the Face API project

Redeploy the website after saving its variables. The Android app's `EXPO_PUBLIC_API_URL` must point to `https://hrms-bmhx.vercel.app`, not the Face API.

The attendance and employee-enrollment routes limit photos to 4 MB to stay under Vercel Functions' 4.5 MB request-body limit. The mobile camera capture quality is reduced to help stay within that limit.

## Threshold and liveness

Set `FACE_MATCH_THRESHOLD` only after testing genuine and non-matching employee image pairs for the deployed model version and capture conditions. The API reports `status: ready` only when both model files are present and a valid threshold is configured. Image matching does not provide liveness detection; the API reports `liveness: not_implemented`.

## Alternative container host

If Vercel does not enable the Container runtime for this project or its deployment fails, use the Render Blueprint in `render.yaml` instead. That alternative creates a paid 1 CPU / 2 GB service; review Render's current price before applying it. If using Render, change the website project's `FACE_API_URL` to the Render service base URL.
