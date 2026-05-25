# Inspekto

Inspekto is a complaint intake, review, mission-order, and inspection workflow system for business violations. It combines a React/Vite frontend with Supabase for authentication, database access, realtime updates, storage, and edge functions.

## What the app does

- Public users submit regular complaints through `/complaint`.
- Special agencies or authorized complainants use `/special-complaint`.
- Directors review complaints, send special complaint links, and approve or decline mission orders.
- Head Inspectors create and assign mission orders.
- Inspectors complete inspection slips and submit inspection results.
- Users can track complaint progress through `/track-complaint`.

## Frontend Architecture

The frontend is a single-page React app built with Vite.

### Routing and entry flow

- [src/App.jsx](/c:/Users/Drei/Documents/InspektoVersion2/my-app/src/App.jsx) acts as the route switch.
- It maps `window.location.pathname` to page components instead of using React Router.
- It performs early auth and role checks for protected dashboard routes using Supabase Auth plus the `profiles` table as fallback for role resolution.

### Main frontend areas

- `src/modules/complaints_module/`
  Public complaint submission, special complaint submission, verification pages, complaint review, and complaint viewing.
- `src/modules/dashboard_module/`
  Director, Head Inspector, and Inspector dashboards, reports, notifications, and admin tools.
- `src/modules/mission_order_module/`
  Mission order creation and director review.
- `src/modules/inspection_slip_module/`
  Inspection slip creation and review.
- `src/modules/tracking_module/`
  Public complaint status tracking.
- `src/lib/`
  Shared client helpers for Supabase, API wrappers, geocoding/batch geocoding calls, metrics, notifications, and inspection helpers.

### Frontend data access pattern

- Direct table access uses the shared Supabase client in [src/lib/supabase.js](/c:/Users/Drei/Documents/InspektoVersion2/my-app/src/lib/supabase.js).
- Sensitive or privileged operations go through edge functions, usually via helpers in [src/lib/api.js](/c:/Users/Drei/Documents/InspektoVersion2/my-app/src/lib/api.js) and [src/lib/complaints.js](/c:/Users/Drei/Documents/InspektoVersion2/my-app/src/lib/complaints.js).
- Dashboard pages read domain tables directly for list/detail views, then use edge functions for email sending, address verification, geocoding jobs, and document verification.

### Frontend state model

- Most pages use local React state and `useEffect` data loading.
- Shared cross-page state is minimal; route params and Supabase queries drive most views.
- Realtime behavior is handled per page by subscribing to Supabase channels where needed.

## Backend Architecture

The backend is primarily Supabase-backed: Postgres tables, Auth, Storage, Realtime, and Edge Functions.

### Core backend layers

- **Auth**
  Supabase Auth manages sessions. App roles are normalized from auth metadata and/or `profiles.role`.
- **Database**
  Postgres stores complaints, businesses, mission orders, inspection reports, assignments, notifications, profiles, and email verification tokens.
- **Storage**
  Supabase Storage stores uploaded complaint evidence and generated files.
- **Realtime**
  Dashboard pages subscribe to table changes for live updates.
- **Edge Functions**
  Server-side logic handles email flows, geocoding, and document verification.

### Main database concepts

- `complaints`
  Source record for public and special complaints.
- `businesses`
  Lookup table for registered businesses and their coordinates.
- `mission_orders`
  Workflow layer between complaint approval and field inspection.
- `inspection_reports`
  Inspector-submitted inspection results.
- `mission_order_assignments`
  Inspector assignment records.
- `profiles`
  Role and profile metadata for authenticated users.
- `notifications`
  In-app notification records.
- `email_verification_tokens`
  One-time links for complaint and special complaint access.

### Edge functions

- `request-email-verification`
  Sends regular or special complaint verification emails.
- `verify-email`
  Validates one-time tokens and redirects users into the correct form flow.
- `send-complaint-confirmation`
  Sends complaint submission confirmation emails.
- `send-special-complaint-form-link`
  Director-only function that emails a secure special complaint access link.
- `verify-business-proximity`
  Geocodes business addresses, checks Manila jurisdiction, and optionally computes reporter-to-business distance.
- `batch-geocode-businesses`
  Populates missing business coordinates in bulk.
- `verify-secretary-document`
  Verifies secretary-side mission-order related documents.

Shared edge-function helpers live in `supabase/functions/_shared/`.

## End-to-End Flow

### 1. Complaint intake

- A user verifies email, opens the correct complaint form, uploads evidence, and submits a `complaints` row.
- The frontend may call `verify-business-proximity` before final submission to validate location and jurisdiction.
- A confirmation email is sent after successful complaint creation.

### 2. Director review

- Directors load pending complaints from `complaints`.
- Approval or decline updates the complaint status and audit fields.
- Approval triggers notification flow for Head Inspectors.

### 3. Mission order workflow

- Head Inspectors create mission orders linked to approved complaints.
- Directors review submitted mission orders.
- Approved mission orders move into inspection-ready states and can be assigned to inspectors.

### 4. Inspection workflow

- Inspectors open assigned work, complete inspection slips, and write to `inspection_reports`.
- Director and Head Inspector dashboards read inspection progress from report status rather than only from mission order status.

### 5. Public tracking

- The tracking page loads the complaint plus related mission orders and inspection reports to build a timeline view.

## Geocoding and Email Notes

- Geocoding now uses `geocode.maps.co` through shared helper logic in `supabase/functions/_shared/geocodeMaps.ts`.
- The expected server secret is `GEOCODE_MAPS_API_KEY`.
- Complaint verification and special complaint access both depend on email token issuance through edge functions.

## Local Development

### Frontend

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Required client env vars

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Important server/env secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEOCODE_MAPS_API_KEY`
- `APP_BASE_URL`
- `GMAIL_SMTP_USERNAME`
- `GMAIL_SMTP_APP_PASSWORD`
- `GMAIL_SMTP_FROM`
- `SUPPORT_EMAIL`
- `EMAIL_TOKEN_TTL_MINUTES`
- `TURNSTILE_SECRET_KEY`

## Codebase Summary

- The frontend is module-oriented and page-driven.
- The backend is Supabase-centric, with edge functions used only where secrets, privileged access, or nontrivial server-side workflows are required.
- The core domain pipeline is:
  `complaint -> director decision -> mission order -> inspection -> tracking/reporting`
