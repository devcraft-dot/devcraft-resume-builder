# Plan: profile-based extension auth

## Goals

- **Stop** unplanned resume generation: only clients with a valid **API token** can call protected APIs when `JWT_SECRET` is set.
- **Admin** defines canonical resumes on the server: **`RegisteredProfile`** = `name` + `profile_text`.
- **Extension** uses a **client username** (chosen in Profiles) + the **profile names** the user wants to link. Server mints a **stateless JWT** listing allowed profile names; extension stores it as **`manualJd_accessToken`** (same key as today).
- **No Account tab** — token mint + “pull texts from server” live under **Profiles**.
- **Adding/removing profiles** (on Save) **re-mints** the token with the current set of non-empty profile names.
- **Generate/manual**: when authed, **`profile_text` is taken from the server** for that `profile_name` if it is registered (client-supplied text is ignored for security).

## Optional hardening

- **`EXTENSION_MINT_SECRET`**: if set, `POST /api/auth/extension-token` must include the same `mint_secret` (extension stores it from Profiles).

## Dashboard

- **Email/password removed.** Gate with **`ADMIN_API_KEY`** (`X-Admin-Key` header) stored in `localStorage`.
- **Server profiles** UI: CRUD `GET/POST/PATCH/DELETE /api/admin/registered-profiles`.

## Data model

- **`registered_profiles`**: id, name (unique), profile_text, created_at.
- **`generations.client_username`**: string scope for extension users (nullable for legacy rows).
- **`application_screenshots.client_username`**: same.
- **`users` / `user_id`**: left nullable for old DB rows; new writes use `client_username` only.

## API summary

| Endpoint | Auth |
|----------|------|
| `POST /api/auth/extension-token` | Public; optional `mint_secret` |
| `GET /api/extension/profiles` | Bearer extension JWT |
| `GET /api/auth/config` | Public |
| `GET /api/auth/whoami` | Bearer extension JWT |
| `GET/POST/PATCH/DELETE /api/admin/registered-profiles` | `X-Admin-Key` |
| Generate / upload / generations / dashboard | Bearer extension JWT **or** `X-Admin-Key` (admin sees all) |

This file is the plan; implementation follows in code.
