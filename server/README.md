# CareCircle API authentication

## Phone number at registration

`POST /api/auth/register` requires `phone` along with name, email, password, and role. The value may use an optional leading `+`, digits, spaces, parentheses, periods, or hyphens; it must contain 7–15 digits. `username` is optional and, when provided, is normalized to lowercase and must be unique (3–30 letters, digits, periods, underscores, or hyphens; it must start and end with a letter or digit). Registration responses include the phone and username (null if none was supplied). Password confirmation is client-side only; the API accepts `password`, not a confirmation field.

`POST /api/auth/login` supports the existing `{ "email": "...", "password": "..." }` request. The `email` value may also be a username for compatibility with clients that use that field as the login identifier. Alternatively, send `{ "username": "...", "password": "..." }`. Matching is case-insensitive. Existing email-only accounts continue to authenticate as before.

Registration and password changes require a password of 10–128 characters containing an uppercase letter, a lowercase letter, and a number. Password confirmation is checked by the client and is never accepted or stored by the API.

Authenticated profile and password settings are available through:

- `PATCH /api/auth/profile` with `{ "name": "...", "phone": "..." }`; only these profile fields may be changed.
- `POST /api/auth/change-password` with `{ "currentPassword": "...", "newPassword": "..." }`; the current password is verified, the new password is hashed, and any outstanding reset token is invalidated.

## Password reset

- `POST /api/auth/forgot-password` accepts `{ "email": "person@example.test" }`.
- `POST /api/auth/reset-password` accepts `{ "token": "...", "password": "a-new-password" }`; email is not required or accepted.

Reset tokens are generated with a cryptographically secure random source, stored only as SHA-256 hashes, expire after one hour, and are consumed atomically when the password is changed. The token is delivered only in the reset email link when an SMTP provider is configured; it is never returned in an API response or logged. Resetting locates the account by the token hash, so the reset request only needs the token and new password. The forgot-password response does not distinguish existing from unknown accounts. Invalid or expired reset attempts receive a generic error. The password is hashed with bcrypt before saving.

When email is configured, a syntactically valid forgot-password request returns HTTP 202:

```json
{ "message": "If an account matches that email and email delivery succeeds, password reset instructions will be sent." }
```

When SMTP is not configured, it returns HTTP 503:

```json
{
  "error": "Password reset email is unavailable because the email provider is not configured.",
  "code": "email_provider_not_configured"
}
```

After a valid, unexpired token is used, reset-password returns HTTP 200:

```json
{ "message": "Password has been reset. Please sign in." }
```

Malformed requests and invalid, expired, or already-used tokens return HTTP 400 with a generic error; a reset token cannot be reused.

Email delivery requires all five SMTP variables below. Without them, forgot-password returns HTTP 503 with code `email_provider_not_configured`; it does not create or disclose a reset token or claim an email was sent. Configure SMTP before enabling this endpoint in production. An SMTP delivery failure does not disclose whether an account exists, and the undelivered reset token is cleared.

### Required SMTP environment variables

Set these in `server/.env` (examples are in `.env.example`):

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP server port, from 1 to 65535 |
| `SMTP_USER` | SMTP authentication username |
| `SMTP_PASS` | SMTP authentication password |
| `SMTP_FROM` | Sender address and optional display name |

`SMTP_SECURE` is optional; set it to `true` for implicit TLS. Port 465 enables implicit TLS by default. The email reset link uses the existing `CLIENT_ORIGIN` setting and points to `/reset-password`; the frontend must provide that screen and submit the reset request to the API.

## WebRTC video calling

Video invitations and signaling use the authenticated Socket.IO connection. The signaling service validates each user's access to the same senior care circle, supports one active call per participant, expires unanswered invitations, and releases calls when a participant disconnects. The signaling events are `video:invite`, `video:incoming`, `video:accept`, `video:accepted`, `video:reject`, `video:rejected`, `video:signal`, and `video:ended`.

The authenticated `GET /api/video/ice-servers` endpoint returns STUN/TURN configuration. Set `STUN_URL` to override the public default. For a provisioned Coturn REST-auth TURN server, set comma-separated `TURN_URLS` and a private `TURN_SHARED_SECRET` in `server/.env`. The API derives one-hour credentials; the shared secret never leaves the backend. Do not put a TURN shared secret or long-lived credential in a `VITE_*` variable. Without a TURN server, STUN-only calls may not connect across restrictive networks.

The older authenticated `POST /api/video/signal` relay remains for compatibility with existing API clients; the current frontend does not call it and uses the stateful Socket.IO call events above.

Set `VITE_SOCKET_URL` in `client/.env.local` only if Socket.IO is hosted at a different origin; otherwise the client derives the socket origin from `VITE_API_URL` or the current origin. Add every deployed frontend origin to the comma-separated `CLIENT_ORIGIN` value in `server/.env`.
