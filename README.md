# WAHH AIR! Management System

Vanilla **HTML/CSS/JavaScript** frontend, **Supabase** for Authentication/Postgres/Storage, **Vercel** hosting/serverless admin action, and GitHub deployment.

## Included

- Public landing page with WAHH AIR branding/logo, posters, flavour stock and public Rider/Ejen IDs.
- Login roles: Rider / Ejen / Admin. Public registration is Rider/Ejen only.
- Per-user private data enforced with Supabase RLS + security-definer RPCs.
- Rider/Ejen stock, sales, commission and private profile.
- Auto sales settlement invoice generated on every finalized sale; invoice center is Admin-only.
- Admin stock allocation, HQ stock correction, flavours/prices, materials/recipes, weighted-average material purchase cost, expenses and sales-on-behalf.
- Management accounting: Revenue, COGS, Gross Profit, Commission Expense, Operating Expenses, Net Profit, stock purchases and inventory value.
- Partner profit sharing with configurable percentages, reserve and distribution snapshots.
- Poster upload using Supabase Storage.
- Account suspension and secure account deletion through a Vercel serverless endpoint. Passwords and Auth UUIDs are never shown in the Admin UI.
- Audit log for key operations.

## 1) Supabase

Create a **new Supabase project**, open SQL Editor and run:

`supabase/schema.sql`

Then register your own account from the web as Rider or Ejen and promote it to Admin with the SQL shown at the bottom of `schema.sql`.

Recommended Auth settings:

- Email/password enabled.
- For testing, you can disable Confirm Email. For production, keep email confirmation enabled and set the Site URL / Redirect URLs to your Vercel domain.

## 2) Vercel Environment Variables

Add these in Vercel Project → Settings → Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

`SUPABASE_SERVICE_ROLE_KEY` is server-only and is used only by `/api/admin-delete-user.js`. Never put it in HTML or client-side JS.

## 3) Deploy with GitHub + Vercel

Import this GitHub repository into Vercel. Framework Preset can be **Other**. No build command is required. Vercel will serve `index.html` and the `/api` serverless functions.

Every later push to the selected production branch will auto-deploy.

## Accounting model

This project uses management accounting rather than treating every stock purchase as an immediate P&L expense:

`Net Profit = Revenue - COGS - Commission - Operating Expenses`

Raw-material purchases increase inventory value. Weighted-average material cost is updated on purchase. A flavour's COGS is calculated from its recipe; if a recipe has no usable cost yet, `manual_unit_cogs` is used as a fallback.

Partner distribution uses **Net Profit**, optionally subtracts a Business Reserve, then splits the distributable amount according to active partner percentages.

## Invoice behavior

Invoices are immutable sales snapshots generated automatically in the database when a sale is finalized. Rider/Ejen do not have invoice access. Admin can open an invoice and use **Print / Save PDF**.

## Security notes

- RLS is enabled on all business tables.
- Users cannot directly update their own role/status.
- Admin operations involving another user's account accept Public IDs such as `WR-000001`, not the underlying Auth UUID.
- Admin account deletion is verified server-side using the logged-in access token plus the service role key.
- Supabase Auth passwords are never readable by this app.
