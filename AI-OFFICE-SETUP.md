# WAHH AIR AI Office — Setup V1

## 1. Database
Run this migration in Supabase SQL Editor:

`supabase/18-ai-office-foundation.sql`

It creates the AI Office foundation for only these V1 agents:

- Chief AI
- Marketing AI
- Accounting AI

The existing WAHH AIR accounting, sales, event, auth and stock tables are reused rather than duplicated.

## 2. Vercel Environment Variables
Add these variables in Vercel. Never place the API key in frontend JavaScript.

```text
ROOTSYS_BASE_URL=https://rootsys.cloud/v1
ROOTSYS_API_KEY=<private provider key>
```

The server endpoint currently uses the OpenAI-compatible path:

`POST {ROOTSYS_BASE_URL}/chat/completions`

If Rootsys uses a different request format, only `api/ai-office.js` needs to be adapted; the AI staff/database/UI architecture does not need to be rebuilt.

Optional model fallbacks can also be configured through Vercel:

```text
ROOTSYS_CHIEF_MODEL=<model name>
ROOTSYS_MARKETING_MODEL=<model name>
ROOTSYS_ACCOUNTING_MODEL=<model name>
```

Alternatively, leave these unset and enter each model name from Admin → AI Office. The API key remains server-side in both cases.

## 3. Security
The AI Office UI is available only to the admin role. The API validates the current Supabase access token and confirms that the caller has an active admin profile before any AI request is sent.

The Rootsys API key and Supabase secret key are used only in the Vercel server function.

Marketing AI does not receive accounting data. Accounting AI is read-only and receives financial figures calculated through existing deterministic WAHH AIR accounting RPCs.

## 4. First connection test
After migration + Vercel environment setup:

1. Login as Admin.
2. Open **AI Office**.
3. Enter the exact provider model name for Chief, Marketing and/or Accounting.
4. Click **Simpan**.
5. Click **Test Connection**.

If Rootsys is OpenAI-compatible, the expected result is `WAHH AIR AI CONNECTION OK`.

If it returns an HTTP/provider-format error, keep the error message. The provider adapter can then be adjusted without changing the rest of AI Office.
