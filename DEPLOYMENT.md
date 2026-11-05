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
- `FACE_BUCKET`: `employee-face-photos` (optional; matches the private bucket created by the Supabase migration and the service default)
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

Redeploy the website after saving its variables. The Android app's `EXPO_PUBLIC_API_BASE_URL` must point to `https://hrms-bmhx.vercel.app`, not the Face API.

The attendance and employee-enrollment routes limit photos to 4 MB to stay under Vercel Functions' 4.5 MB request-body limit. The mobile camera capture quality is reduced to help stay within that limit.

## Android release

The Android app signs in to the same Supabase project and calls the website's Next.js API. It must not call the Face API directly or contain `FACE_API_TOKEN` or `SUPABASE_SECRET_KEY`.

1. From `Mobile/`, copy `.env.example` to `.env.local` for local development. Keep `EXPO_PUBLIC_API_BASE_URL` set to `https://hrms-bmhx.vercel.app`.
2. Install the EAS CLI (`npm install --global eas-cli`) and sign in (`eas login`). Link this app to your Expo account (`eas build:configure`); this adds an Expo project ID to `app.json`.
3. Add `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_API_BASE_URL` to the Expo project's `preview` and `production` environments. These `EXPO_PUBLIC_` values are bundled into the app and must be treated as public. Do not upload `.env`/`.env.local` as a substitute for cloud build variables.
4. Build and install an internal test APK with `eas build --platform android --profile preview`.
5. For Google Play, build an Android App Bundle with `eas build --platform android --profile production`. Review the package ID `com.peopleops.hrmsattendance` and app listing before first submission. Set up Play Console and Android signing when prompted; then submit with `eas submit --platform android --profile production`.

The project currently targets Expo SDK 58 and has preview/APK and production/AAB EAS profiles in `Mobile/eas.json`. Test sign-in, dashboard loading, camera permission/selfie capture, GPS permission/geofence, attendance, and history on physical Android devices before distributing the production bundle.

## Threshold and liveness

Set `FACE_MATCH_THRESHOLD` only after testing genuine and non-matching employee image pairs for the deployed model version and capture conditions. The API reports `status: ready` only when both model files are present and a valid threshold is configured. Image matching does not provide liveness detection; the API reports `liveness: not_implemented`.

## Alternative container host

If Vercel does not enable the Container runtime for this project or its deployment fails, use the Render Blueprint in `render.yaml` instead. That alternative creates a paid 1 CPU / 2 GB service; review Render's current price before applying it. If using Render, change the website project's `FACE_API_URL` to the Render service base URL.
