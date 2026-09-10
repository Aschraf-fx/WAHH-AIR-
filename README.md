# WAHH AIR! Management System

Vanilla **HTML/CSS/JavaScript** frontend, **Supabase** Authentication/Postgres/Storage, **Vercel** hosting/serverless functions, and GitHub deployment.

## Included

- Public landing page with WAHH AIR branding, posters, flavour stock and public Rider/Ejen IDs.
- Login roles: Rider / Ejen / Admin. Public registration is Rider/Ejen only.
- Supabase RLS + security-definer RPCs protect private user data.
- Rider/Ejen stock, sales, commission and private profile.
- Every finalized sale automatically updates stock/accounting and generates an Admin-only Sales Settlement invoice.
- Admin: stock allocation/return/correction, production, flavours, materials, recipes, weighted-average material costs, purchases, expenses, sales-on-behalf, invoices, accounting, partner distribution, posters and audit logs.
- Secure account suspension/deletion. Passwords and Auth UUIDs are never displayed in the Admin UI.

## 1. Supabase setup

Create a new Supabase project. In **SQL Editor**, run these files in this exact order:

1. `supabase/01-schema.sql`
2. `supabase/02-user-rpcs.sql`
3. `supabase/03a-admin-operations.sql`
4. `supabase/03b-admin-finance.sql`
5. `supabase/04-security.sql`

Enable Email/Password authentication. For quick testing you may disable Confirm Email; for production, enable confirmation and set Site URL / Redirect URLs to the Vercel domain.

After deployment, register your own account once as Rider/Ejen. Then run `supabase/ADMIN_SETUP.sql` after replacing `YOUR_ADMIN_EMAIL` with your email. That promotes the account to `WA-000001` Admin.

## 2. Vercel environment variables

Supabase now recommends the newer publishable/secret API key system. Add these under Vercel Project → Settings → Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

The app also accepts the legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` names as fallbacks.

`SUPABASE_SECRET_KEY` / legacy service-role key is server-only. Never expose it in HTML or browser JavaScript.

## 3. GitHub + Vercel

Import this repository into Vercel with Framework Preset **Other**. No build command is needed. Vercel serves `index.html` and `/api/*` serverless functions. Once connected, pushes to the production branch auto-deploy.

## Accounting model

`Net Profit = Revenue - COGS - Commission - Operating Expenses`

Raw-material purchases increase inventory value rather than being treated as an immediate P&L expense. Material purchases update weighted-average cost. Product COGS comes from recipes/current material costs, falling back to `manual_unit_cogs` when no usable recipe cost exists.

Partner distribution uses Net Profit, subtracts an optional Business Reserve, then splits distributable profit according to active partner percentages. Default seed is two partners at 50/50 and can be edited by Admin.

## Invoice behavior

Invoices are immutable sale snapshots created automatically at finalization. Rider/Ejen do not have invoice access. Admin can view them and use **Print / Save PDF**. If an invoice is voided before commission is paid, the sale is voided and stock is returned to the seller with an audit trail.

## Security

- RLS is enabled across business tables.
- Users cannot directly change their role or account status.
- Rider/Ejen self-service operations are scoped by `auth.uid()`.
- Admin operations accept Public IDs such as `WR-000001`; the Admin UI does not expose Auth UUIDs.
- Account deletion is server-side and verifies the logged-in Admin before using the Supabase secret/service-role key.
- Supabase Auth passwords are never readable by the app.
