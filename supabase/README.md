# Supabase setup

Apply the SQL in `migrations/` to a new Supabase project using the SQL editor or Supabase CLI. The schema keeps face vectors in a service-role-only table and enrollment photos in a private Storage bucket. Client apps do not receive database service-role credentials.

Create the first Admin through Supabase Auth, then link the Auth UUID to `profiles.user_id` using the SQL editor (replace the values with that user's Auth UUID, name, and department):

```sql
insert into public.profiles (user_id, role, full_name, department)
values ('AUTH-USER-UUID', 'ADMIN', 'Admin Name', 'Administration');
```

Do not expose role assignment to a client form. HR can add employees from the web workspace; onboarding stores the consented photo against that employee ID, creates the employee Auth invitation, and links the Auth UUID to the profile.

Configure Auth email delivery and recovery before inviting employees. Keep the Supabase secret key in the web server and Python face-service environment only; it bypasses RLS and must never be shipped in the mobile bundle or browser.

## Production prerequisites

- A Supabase project and deployment of this migration.
- A protected HTTPS deployment of the Python face service. Vercel must be able to reach its public HTTPS endpoint; the API's server-to-server bearer token protects enrollment and verification routes.
- A commercial-use-cleared face model and separately calibrated match threshold.
- A liveness/spoof policy. The current face service skeleton performs 1:1 similarity only; it does not implement liveness, so it is not sufficient to protect production attendance from replay attacks.
- HTTPS for the web app. Browser geolocation is only available in secure contexts (localhost during development or HTTPS in production).
- A consent notice, retention/deletion schedule, and a manual review path for face-match failures before enrolling real employees.

Set the environment values in `Web/.env.local`, `Mobile/.env.local`, and the face-service deployment using the corresponding `.env.example` files. Use Supabase's publishable key in client apps and its secret key only in the Next.js server and Python face-service. The Next.js server must be able to reach the face service over HTTPS; the mobile app must point to the public HTTPS URL of the Next.js app. Use a unique random `FACE_API_TOKEN` in the web and face-service environments. The Docker image downloads the OpenCV Zoo YuNet/SFace model files during build and verifies their SHA-256 digests; see `services/face-api/MODEL-LICENSES.md`.

After creating the Admin and configuring email delivery, sign in to Web, use **Use my current location** while physically at the office, and save the geofence. Then add employees from the Employees section with their work email, ID, face photo, and recorded consent. Supabase Auth email delivery must be configured so employee invitations can be accepted. Build the Android app with the Expo development/release build workflow for the final production application.

InsightFace's public pretrained model packs are restricted to non-commercial research unless separately licensed. DeepFace's code license does not grant rights to every wrapped model. The current API skeleton references OpenCV Zoo YuNet/SFace model files as a candidate; its published benchmark does not predict this workforce's false-accept or false-reject rates. Obtain legal clearance for model weights and run a consented, representative validation before enabling it.
