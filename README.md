
# CareCircle

CareCircle is a responsive MERN care-coordination application for seniors and their approved family members, caregivers, and administrators. It connects a React/Vite client to an Express API, MongoDB persistence, JWT authentication, and authenticated Socket.IO events.

> The brief refers to “all 54 APIs” without providing a canonical 54-route contract. This project implements a shared REST resource API for 22 care record types, plus dedicated authentication, dashboard, relationship approval, emergency, report, and video-signaling routes. If an external 54-endpoint specification exists, it is still needed to map and verify one-for-one coverage.

## Run locally

Requirements: Node.js 20 or later and a MongoDB instance (local MongoDB or an Atlas connection string).

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Configure the API:

   ```powershell
   Copy-Item server\.env.example server\.env
   ```

   Edit `server/.env`. Set `MONGODB_URI` and replace `JWT_SECRET` with a random value of at least 32 characters. Keep `.env` files private; they are ignored by Git.

3. Start both applications:

   ```sh
   npm run dev
   ```

   The API is at `http://localhost:4000`; the client is at `http://localhost:5173`. In development, Vite proxies `/api` and Socket.IO to the API, avoiding cross-origin issues when the client is opened through `localhost` or `127.0.0.1`. The API `/api/health` endpoint reports whether MongoDB is connected. The API fails to start if MongoDB is unreachable or required secrets are missing.

4. Register a Senior account, then register a Family or Caregiver account. On the senior account, approve the care-circle connection request before linked users can access private care records. The public registration flow intentionally cannot create an administrator; create admin access through a trusted operator/seed process.

For production, define `VITE_API_URL` in `client/.env.local` if the API is not served from the same origin (for example, `https://api.example.test/api`). Set `VITE_SOCKET_URL` when Socket.IO uses a different origin from the API; otherwise it is derived from `VITE_API_URL` or the current origin. Configure the matching frontend origin(s) in the API's comma-separated `CLIENT_ORIGIN` setting. If registration cannot reach the API, verify the API is running and `http://localhost:4000/api/health` reports a connected database.

Video calling uses authenticated Socket.IO invitation/accept/reject, SDP offer/answer, ICE candidate, and end-call events. `/api/video/ice-servers` returns the STUN/TURN configuration to signed-in users. For production networks that require TURN, configure `TURN_URLS` and a strong `TURN_SHARED_SECRET` in `server/.env`; credentials are short-lived and generated per authenticated user using Coturn REST authentication. Never expose the shared TURN secret in a `VITE_*` variable or static frontend bundle. A TURN server must be separately provisioned; STUN-only calls can fail across restrictive NATs/firewalls.

Registration requires a phone number and supports an optional unique username. Sign-in accepts either email or username. Password reset requires a configured SMTP provider: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `server/.env` (optionally set `SMTP_SECURE=true` for implicit TLS). Without these settings, the reset request returns an explicit provider-not-configured error; it does not claim an email was sent. See [server/README.md](./server/README.md) for request contracts and the reset-token lifecycle.

Signed-in users can update their name and phone number from Profile & settings and change their password after confirming the current password. Profile changes and password changes are validated and saved by authenticated API endpoints; notification preferences remain separately stored per account.

## Seed accounts and sample records

Optional sample data can be created with environment-provided credentials; the script never embeds a password:

```powershell
$env:SEED_SENIOR_EMAIL = "senior@example.test"
$env:SEED_SENIOR_PASSWORD = "a-private-password-of-12-chars"
$env:SEED_FAMILY_EMAIL = "family@example.test"
$env:SEED_FAMILY_PASSWORD = "another-private-password"
$env:SEED_CAREGIVER_EMAIL = "caregiver@example.test"
$env:SEED_CAREGIVER_PASSWORD = "caregiver-private-password"
$env:SEED_ADMIN_EMAIL = "admin@example.test"
$env:SEED_ADMIN_PASSWORD = "admin-private-password"
npm run seed -w server
```

The seed script inserts sample schedules, tasks, a shift, a safe-zone example, and a check-in. The safe-zone coordinates are illustrative sample data, not a real person’s location. Existing users are not overwritten.

## Implemented workflows

- Registration and login for Senior, Family, and Caregiver; administrator accounts are provisioned separately.
- Hashed passwords, expiring signed JWTs, authenticated routes, role checks, and senior-level access scopes.
- Explicit senior approval before a Family/Caregiver account is linked to sensitive records.
- Care-circle dashboard, alerts, medications, medication adherence events, health profiles, vitals and trends, appointments, visibility-scoped care notes, caregiver tasks and shifts, location updates, geofences, check-in scheduling, activity, reports and CSV export, organization records, team membership/invitations, invoices, payment-event records, contacts, and notification preferences.
- Browser geolocation sharing after explicit user action; geofence evaluation on saved location updates.
- Fall alerts can be recorded by an authorized user. Inactivity alerts are generated for senior accounts that have not sent app presence for the configured interval.
- Medication plans can schedule a daily in-app reminder for a selected time in the user's browser time zone. Reminder records are persisted, deduplicated per medication/day, and broadcast to connected care-circle members.
- Emergency action persists a critical alert and emits it to authorized in-app care-circle sockets.
- Authenticated Socket.IO rooms for care updates and restricted WebRTC signaling messages.
- Authenticated one-to-one video invitations with accept/reject, scoped WebRTC SDP/ICE signaling, call expiry, disconnect cleanup, and short-lived Coturn REST credentials when TURN is configured.
- Per-device API keys (hashed at rest and revealed only once), rate-limited device event ingestion, duplicate event protection, and alert-rule severity selection.
- Date-filtered seven-day activity summaries, vital history/trends, and bounded CSV care-report exports.
- Organization owner settings and in-app invitations for existing caregiver/family accounts; organization access does not bypass senior-specific care-circle approval.
- Invoice line items and auditable offline-payment status updates that require a reference; payment collection is not processed.
- Configurable in-app notification preferences.
- Demo seed script, responsive mobile navigation, loading/error/empty states, and input validation.

## API overview

Every route is prefixed with `/api`. Authenticated record resources support:

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/:resource` | List a paginated set of authorized records |
| POST | `/:resource` | Validate and create a record |
| GET | `/:resource/:id` | Read one authorized record |
| PATCH | `/:resource/:id` | Update status or validated record data |
| DELETE | `/:resource/:id` | Remove an allowed record (audit activity is immutable) |

Resource names: `alerts`, `medications`, `medicationEvents`, `tasks`, `shifts`, `locations`, `geofences`, `checkins`, `reports`, `healthProfiles`, `vitals`, `appointments`, `careNotes`, `devices`, `alertRules`, `organizations`, `invoices`, `paymentEvents`, `invitations`, `notifications`, `activity`, and `contacts`.

Additional routes include:

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `POST /auth/link-senior`, `GET /auth/link-requests`, `POST /auth/link-requests/:id/approve`
- `GET /dashboard`, `GET /people`, `GET /resources`
- `GET /notification-preferences`, `PATCH /notification-preferences`
- `GET /organization`, `POST /organization`, `PATCH /organization`
- `GET /organizations/members`, `POST /organizations/invitations`, `GET /organizations/invitations/mine`
- `POST /organizations/invitations/:id/accept`, `POST /organizations/invitations/:id/decline`, `DELETE /organizations/members/:userId`
- `POST /integrations/devices/:id/events` (device-key authentication; no user JWT)
- `POST /medications/:id/events`, `GET /vitals/trends`
- `POST /emergency`
- `GET /reports/summary`
- `GET /reports/export.csv`
- `POST /video/signal` (legacy relay kept for existing API clients; the current UI uses authenticated Socket.IO call events instead)
- `GET /video/ice-servers` (authenticated STUN/TURN configuration; TURN credentials are short-lived)
- `GET /health`

Send the JWT as `Authorization: Bearer <token>`. JSON validation errors use HTTP 400, unauthenticated calls use 401, forbidden actions use 403, and missing resources use 404.

## Tests and build

```sh
npm test
npm run build
```

`npm test` covers senior ownership access, API route precedence, and device-key route placement. `npm run build` builds the production React client and syntax-checks the API. Exercise authenticated CRUD and Socket.IO workflows against a configured MongoDB instance before deploying.

## Integrations and production work still required

This repository does not claim external integrations that are not configured:

- **Wearable fall detection:** registered devices can authenticate and post fall/inactivity event payloads to `/api/integrations/devices/:id/events`; no wearable/vendor integration is included to detect events automatically.
- **Medication reminders:** in-app reminders require the API process to be running. No push, SMS, email, or operating-system delivery provider is configured; missed doses are not inferred automatically.
- **Emergency delivery:** alerts reach authorized users in the running app. SMS, telephone, and emergency-services delivery require a configured and tested provider and must not be presumed delivered.
- **Video:** appointments are persisted and the UI includes peer-to-peer WebRTC calling over authenticated Socket.IO signaling. Calls use browser camera/microphone permission and a public STUN service; restrictive networks require a separately provisioned TURN relay configured with `TURN_URLS` and `TURN_SHARED_SECRET`. Calls are not recorded or persisted, and production connectivity, consent, and privacy review are still required. Static long-lived TURN credentials must never be bundled into the frontend.
- **Billing:** invoice records, line items, payment-event records, and referenced offline-payment status updates are supported. No payment processor, payment collection, tax calculation, or recurring billing is configured.
- **Maps:** the location screen shows shared coordinates and links to an external map; no map SDK or continuous background tracking is configured. Geofence alerts are evaluated only when an authorized location update is submitted.
- **Organization administration:** organization settings and in-app membership invitations for existing accounts are available. Email delivery, independent tenant administration, organization-wide senior provisioning, and broader production tenant lifecycle still need implementation and review.

For production, configure TLS, a production-grade secret manager, MongoDB backups and retention, monitoring, explicit organization tenancy, consent and data-retention rules, provider credentials, and a security/privacy review. This project is not a certification or guarantee of regulatory compliance.
