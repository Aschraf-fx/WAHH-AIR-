const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function esc(v = '') { return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c])); }
function verifyState(state) {
  const secret = process.env.TIKTOK_STATE_SECRET || process.env.TIKTOK_CLIENT_SECRET;
  if (!secret || !state || !state.includes('.')) throw new Error('OAuth state tidak sah.');
  const [body, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('OAuth state tidak sah.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.uid || !payload.ts || Date.now() - Number(payload.ts) > 10 * 60 * 1000) throw new Error('OAuth state tamat tempoh. Cuba connect semula.');
  return payload;
}
function page(res, ok, message) {
  const origin = (() => { try { return new URL(process.env.TIKTOK_REDIRECT_URI).origin; } catch { return 'https://www.wahhair.com'; } })();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(ok ? 200 : 400).send(`<!doctype html><html><head><meta charset="utf-8"><title>TikTok Connection</title></head><body style="font-family:Arial,sans-serif;padding:32px"><h2>${ok ? 'TikTok berjaya disambungkan' : 'TikTok connection gagal'}</h2><p>${esc(message)}</p><p>Window ini boleh ditutup.</p><script>try{window.opener&&window.opener.postMessage({type:'wahh-tiktok-oauth',ok:${ok ? 'true' : 'false'},message:${JSON.stringify(String(message))}},${JSON.stringify(origin)});}catch(e){}setTimeout(()=>window.close(),800);</script></body></html>`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return page(res, false, 'Method not allowed');
  try {
    const { code, state, error, error_description: errorDescription } = req.query || {};
    if (error) throw new Error(errorDescription || error);
    if (!code) throw new Error('Authorization code TikTok tidak diterima.');
    const payload = verifyState(String(state || ''));

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI;
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!clientKey || !clientSecret || !redirectUri) throw new Error('TikTok environment variables belum lengkap.');
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase server environment belum lengkap.');

    const tokenBody = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: String(code),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    });
    const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const tokenData = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || `Token exchange gagal (HTTP ${tokenResp.status})`);

    const userResp = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const userData = await userResp.json().catch(() => ({}));
    if (!userResp.ok || userData?.error?.code && userData.error.code !== 'ok') throw new Error(userData?.error?.message || `TikTok user info gagal (HTTP ${userResp.status})`);
    const tiktokUser = userData?.data?.user || {};
    const openId = tokenData.open_id || tiktokUser.open_id;
    if (!openId) throw new Error('TikTok open_id tidak diterima.');

    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const accountName = tiktokUser.display_name || 'TikTok WAHH AIR';
    let accountId = null;
    const { data: existingAccount } = await service.from('social_accounts').select('id').eq('platform', 'tiktok').eq('external_account_id', openId).maybeSingle();
    if (existingAccount?.id) {
      accountId = existingAccount.id;
      const { error: accountUpdateErr } = await service.from('social_accounts').update({ account_name: accountName, active: true, metadata: { avatar_url: tiktokUser.avatar_url || null, union_id: tiktokUser.union_id || null }, updated_at: new Date().toISOString() }).eq('id', accountId);
      if (accountUpdateErr) throw accountUpdateErr;
    } else {
      const { data: account, error: accountErr } = await service.from('social_accounts').insert({ platform: 'tiktok', account_name: accountName, external_account_id: openId, active: true, metadata: { avatar_url: tiktokUser.avatar_url || null, union_id: tiktokUser.union_id || null }, created_by: payload.uid }).select('id').single();
      if (accountErr) throw accountErr;
      accountId = account.id;
    }

    const now = Date.now();
    const scopes = String(tokenData.scope || '').split(',').map(s => s.trim()).filter(Boolean);
    const row = {
      platform: 'tiktok',
      account_id: accountId,
      open_id: openId,
      union_id: tiktokUser.union_id || null,
      display_name: accountName,
      avatar_url: tiktokUser.avatar_url || null,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      scopes,
      access_expires_at: tokenData.expires_in ? new Date(now + Number(tokenData.expires_in) * 1000).toISOString() : null,
      refresh_expires_at: tokenData.refresh_expires_in ? new Date(now + Number(tokenData.refresh_expires_in) * 1000).toISOString() : null,
      connected_by: payload.uid,
      updated_at: new Date().toISOString()
    };
    const { error: upsertErr } = await service.from('social_oauth_connections').upsert(row, { onConflict: 'platform,open_id' });
    if (upsertErr) throw upsertErr;

    await service.from('ai_activity_logs').insert({ actor_user_id: payload.uid, action: 'tiktok_connected', details: { open_id: openId, display_name: accountName, scopes } });
    return page(res, true, `Akaun ${accountName} telah disambungkan ke WAHH AIR.`);
  } catch (e) {
    console.error('TikTok callback error', e);
    return page(res, false, e.message || 'TikTok connection gagal.');
  }
};
