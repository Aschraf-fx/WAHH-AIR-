const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API_BASE = 'https://open.tiktokapis.com';
const SCOPES = ['user.info.basic', 'video.publish'];
const MAX_TEST_VIDEO_BYTES = 64 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

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

async function getConnection(service) {
  const { data, error } = await service
    .from('social_oauth_connections')
    .select('id,account_id,platform,open_id,display_name,avatar_url,access_token,refresh_token,scopes,access_expires_at,refresh_expires_at,connected_at,updated_at')
    .eq('platform', 'tiktok')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('TikTok belum disambungkan.');
  if (!(data.scopes || []).includes('video.publish')) throw new Error('TikTok connection tiada scope video.publish. Connect semula selepas scope diaktifkan.');
  if (data.access_expires_at && new Date(data.access_expires_at).getTime() <= Date.now()) throw new Error('TikTok access token telah tamat tempoh. Connect semula TikTok.');
  return data;
}

async function tiktokPost(path, accessToken, body = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  const apiError = data?.error;
  if (!r.ok || (apiError?.code && apiError.code !== 'ok')) {
    throw new Error(apiError?.message || apiError?.code || `TikTok API gagal (HTTP ${r.status})`);
  }
  return data?.data || {};
}

async function queryCreatorInfo(connection) {
  return tiktokPost('/v2/post/publish/creator_info/query/', connection.access_token, {});
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

    if (action === 'creator_info') {
      const connection = await getConnection(service);
      const creator = await queryCreatorInfo(connection);
      return send(res, 200, { ok: true, creator });
    }

    if (action === 'init_test_post') {
      const connection = await getConnection(service);
      const caption = String(req.body?.caption || '').trim();
      const fileSize = Number(req.body?.file_size || 0);
      const fileType = String(req.body?.file_type || '').toLowerCase();
      const privacyLevel = String(req.body?.privacy_level || '').trim();
      const allowComment = req.body?.allow_comment === true;
      const allowDuet = req.body?.allow_duet === true;
      const allowStitch = req.body?.allow_stitch === true;

      if (!caption) throw new Error('Caption diperlukan.');
      if (caption.length > 2200) throw new Error('Caption terlalu panjang. Maksimum 2200 aksara untuk test ini.');
      if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error('Saiz video tidak sah.');
      if (fileSize > MAX_TEST_VIDEO_BYTES) throw new Error('Test Post V1 dihadkan kepada video maksimum 64MB.');
      if (!ALLOWED_VIDEO_TYPES.has(fileType)) throw new Error('Format video mesti MP4, MOV atau WebM.');
      if (!privacyLevel) throw new Error('Pilih privacy TikTok terlebih dahulu.');

      // TikTok requires the latest creator info to be used when rendering and validating
      // privacy/interactions immediately before Direct Post initialization.
      const creator = await queryCreatorInfo(connection);
      const privacyOptions = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
      if (!privacyOptions.includes(privacyLevel)) throw new Error('Privacy yang dipilih tidak lagi tersedia. Buka semula Test TikTok Post dan cuba lagi.');

      const creatorCommentDisabled = creator.comment_disabled === true;
      const creatorDuetDisabled = creator.duet_disabled === true;
      const creatorStitchDisabled = creator.stitch_disabled === true;
      const privatePost = privacyLevel === 'SELF_ONLY';

      const disableComment = creatorCommentDisabled || !allowComment;
      const disableDuet = creatorDuetDisabled || privatePost || !allowDuet;
      const disableStitch = creatorStitchDisabled || privatePost || !allowStitch;

      const payload = {
        post_info: {
          title: caption,
          privacy_level: privacyLevel,
          disable_duet: disableDuet,
          disable_comment: disableComment,
          disable_stitch: disableStitch
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize,
          total_chunk_count: 1
        }
      };
      const init = await tiktokPost('/v2/post/publish/video/init/', connection.access_token, payload);
      if (!init.publish_id || !init.upload_url) throw new Error('TikTok tidak pulangkan publish_id atau upload_url.');

      const { data: post, error: postErr } = await service.from('social_posts').insert({
        account_id: connection.account_id,
        platform: 'tiktok',
        title: 'TikTok Test Post',
        caption,
        status: 'scheduled',
        approval_status: 'approved',
        external_post_id: init.publish_id,
        created_by: user.id
      }).select('id').single();
      if (postErr) throw postErr;

      await service.from('social_publish_logs').insert({
        post_id: post.id,
        action: 'tiktok_test_init',
        status: 'initialized',
        provider_response: {
          publish_id: init.publish_id,
          privacy_level: privacyLevel,
          allow_comment: !disableComment,
          allow_duet: !disableDuet,
          allow_stitch: !disableStitch,
          file_size: fileSize,
          file_type: fileType
        }
      });

      return send(res, 200, {
        ok: true,
        post_id: post.id,
        publish_id: init.publish_id,
        upload_url: init.upload_url,
        privacy_level: privacyLevel
      });
    }

    if (action === 'publish_status') {
      const connection = await getConnection(service);
      const publishId = String(req.body?.publish_id || '').trim();
      const postId = String(req.body?.post_id || '').trim();
      if (!publishId) throw new Error('publish_id diperlukan.');
      const statusData = await tiktokPost('/v2/post/publish/status/fetch/', connection.access_token, { publish_id: publishId });
      const status = String(statusData.status || 'UNKNOWN');
      const failReason = statusData.fail_reason || null;

      if (postId) {
        const patch = {};
        if (status === 'PUBLISH_COMPLETE') {
          patch.status = 'posted';
          patch.posted_at = new Date().toISOString();
          patch.error_message = null;
        } else if (status === 'FAILED') {
          patch.status = 'failed';
          patch.error_message = failReason || 'TikTok publish gagal';
        } else {
          patch.status = 'scheduled';
        }
        await service.from('social_posts').update(patch).eq('id', postId).eq('external_post_id', publishId);
        if (status === 'PUBLISH_COMPLETE' || status === 'FAILED') {
          await service.from('social_publish_logs').insert({
            post_id: postId,
            action: 'tiktok_test_status',
            status: status === 'PUBLISH_COMPLETE' ? 'posted' : 'failed',
            provider_response: statusData,
            error_message: failReason
          });
        }
      }

      return send(res, 200, { ok: true, status: statusData });
    }

    return send(res, 400, { error: 'Action tidak sah' });
  } catch (e) {
    console.error('TikTok API error', e);
    return send(res, 500, { error: e.message || 'TikTok integration gagal' });
  }
};
