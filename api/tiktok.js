const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const SCOPES = ['user.info.basic', 'video.publish'];

function send(res, status, body) { return res.status(status).json(body); }
function b64url(input) { return Buffer.from(input).toString('base64url'); }
function getRedirectUri() {
  const raw = String(process.env.TIKTOK_REDIRECT_URI || '').trim();
  if (!raw) return '';
  return raw.replace('/api/tiktok/callback', '/api/tiktok-callback');
}
function signState(payload) {
  const secret = process.env.TIKTOK_STATE_SECRET || process.env.TIKTOK_CLIENT_SECRET;
  if (!secret) throw new Error('TIKTOK_CLIENT_SECRET belum ditetapkan.');
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

async function getClients(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !secret) throw new Error('Supabase server environment belum lengkap.');
  const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return { authClient, service };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return send(res, 401, { error: 'Login diperlukan' });
    const { authClient, service } = await getClients(token);
    const { data: { user }, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !user) return send(res, 401, { error: 'Session tidak sah' });
    const { data: profile } = await service.from('profiles').select('role,status').eq('id', user.id).single();
    if (!profile || profile.role !== 'admin' || profile.status !== 'active') return send(res, 403, { error: 'Admin sahaja' });

    const action = String(req.body?.action || 'status');

    if (action === 'status') {
      const { data, error } = await service
        .from('social_oauth_connections')
        .select('platform,open_id,display_name,avatar_url,scopes,access_expires_at,refresh_expires_at,connected_at,updated_at')
        .eq('platform', 'tiktok')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return send(res, 200, { connected: !!data, connection: data || null });
    }

    if (action === 'start') {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      const redirectUri = getRedirectUri();
      if (!clientKey || !process.env.TIKTOK_CLIENT_SECRET || !redirectUri) throw new Error('TikTok environment variables belum lengkap.');
      const state = signState({ uid: user.id, ts: Date.now(), nonce: crypto.randomBytes(16).toString('hex') });
      const u = new URL(AUTH_URL);
      u.searchParams.set('client_key', clientKey);
      u.searchParams.set('scope', SCOPES.join(','));
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('state', state);
      return send(res, 200, { ok: true, authorize_url: u.toString(), scopes: SCOPES });
    }

    return send(res, 400, { error: 'Action tidak sah' });
  } catch (e) {
    console.error('TikTok API error', e);
    return send(res, 500, { error: e.message || 'TikTok integration gagal' });
  }
};
