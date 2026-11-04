# HRMS attendance

This workspace contains a Next.js Admin/HR web app and an Expo SDK 58 Android employee app. Supabase provides Auth, Postgres, and private Storage. A separately deployed Python face service handles employee-ID-scoped face matching.

## Current flows

- **Admin web:** capture the current browser location to set the office geofence, review GPS accuracy, and manage HR section permissions.
- **HR web:** add an employee with work email, employee ID, details, a consented face photo, and invitation; review attendance; process existing on-duty requests; export attendance.
- **Employee Android app:** sign in with Supabase work credentials, check current GPS against the office geofence, scan a selfie, and check in once per local day.
- **Server checks:** derive employee identity from the authenticated profile, compare the selfie against the face template enrolled to that employee ID, validate GPS accuracy/distance, and write the attendance record server-side.

The mobile app requests camera/location only while in use and stores the Supabase session with Expo SecureStore. Employee selfie images are sent to the private face service for matching and are not saved as attendance photos. Enrollment photos are kept in a private Supabase Storage bucket.

## Local setup

1. Apply [the Supabase migration](supabase/migrations/202611040001_production_foundation.sql) and follow [the Supabase setup notes](supabase/README.md). Create the initial Admin profile through a trusted database session.
2. Copy `Web/.env.example` to `Web/.env.local`; set the Supabase project URL, publishable key, server-only secret key, and private face-service URL/token.
3. Copy `Mobile/.env.example` to `Mobile/.env.local`; set the Supabase project URL/key and the HTTPS URL of the Next.js server. The default `10.0.2.2` address is only for an Android emulator.
4. Deploy `services/face-api` privately with the service environment from its `.env.example` and licensed face model files mounted at the configured paths.
5. Configure Supabase Auth email delivery, then run `npm install && npm run dev` in `Web/` and `npm install && npx expo start` in `Mobile/`.
6. In the web app, sign in as Admin and set the geofence while physically at the office. HR can then enroll employees and send account invitations.

## Production gates

This is a production-oriented source foundation; it is not ready to accept real employee biometric data until the external configuration and review steps below are complete. The face matching threshold is intentionally unset, so attendance verification returns unavailable until it has been calibrated against a consented, representative validation set. Obtain commercial-use clearance for the selected model weights. Image similarity alone does not provide liveness or spoof protection; add and validate liveness before relying on this as the sole attendance control. GPS accuracy/distance checks are performed server-side, but a mobile client cannot prove that an Android device is not using mocked location; consider Play Integrity or a documented manual-review policy.

See [Supabase setup and deployment prerequisites](supabase/README.md). Do not put the Supabase secret key or face-service token in `Mobile/` or any `EXPO_PUBLIC_` variable.
