# Production deployment

The Next.js site and the Python face API are separate services. The Vercel project that currently returns FastAPI JSON is pointed at the Face API; it is not the HRMS website.

## 1. Deploy the Face API on Render

This repository includes a Render Blueprint at `render.yaml`. In Render, create a new Blueprint from `akhilainfotech/HRMS` on branch `main` and review the service before applying it. The blueprint creates a Docker web service in Singapore on the Starter plan. Applying it may create a paid resource; review Render's current price and billing terms in your account before confirming.

The Docker build downloads the official YuNet and SFace ONNX files and checks their SHA-256 digests. The model paths are baked into the image. Render prompts for `FACE_API_TOKEN`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` when creating the service. Use the current Supabase project URL and a newly rotated Supabase secret key. Generate a new random `FACE_API_TOKEN` and save the same value in Render and Vercel.

After the first deploy, visit `https://<render-service-host>/health`. It should show `models_ready: true`. It will continue to show `threshold_configured: false` until a threshold has been calibrated. Keep attendance verification disabled until that calibration is completed with representative, consented images.

## 2. Deploy the website on Vercel

In Vercel, set the HRMS site's Root Directory to `Web` and deploy it as a Next.js project. The site can use the existing `hrms-psi-two.vercel.app` domain after the Root Directory is changed; that URL will then serve the website instead of the Face API.

Set these Vercel environment variables for Production:

- `NEXT_PUBLIC_SUPABASE_URL`: the Supabase project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the Supabase publishable key
- `SUPABASE_SECRET_KEY`: the newly rotated Supabase secret key
- `FACE_API_URL`: the Render service base URL, without `/health` or a trailing slash
- `FACE_API_TOKEN`: the same new random token set in Render

Redeploy the Vercel project after saving its variables. The Android app's `EXPO_PUBLIC_API_URL` must point to this Vercel website URL, not to the Face API host.

The attendance route limits selfies to 4 MB to remain below Vercel Functions' 4.5 MB request-body ceiling. The mobile camera capture quality is reduced to help stay within that limit.

## 3. Calibrate before enabling attendance

Set `FACE_MATCH_THRESHOLD` in Render only after testing genuine and non-matching employee image pairs for the deployed model version and capture conditions. The API reports `status: ready` only when both model files are present and a valid threshold is configured. Image matching does not provide liveness detection; the current API reports `liveness: not_implemented`.
