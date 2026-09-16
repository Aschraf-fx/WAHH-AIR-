const { createClient } = require('@supabase/supabase-js');

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

async function getClients(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !secret) throw new Error('Supabase server environment belum lengkap.');

  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const service = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return { authClient, service };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return send(res, 401, { error: 'Login diperlukan' });

    const { authClient, service } = await getClients(token);
    const { data: { user }, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !user) return send(res, 401, { error: 'Session tidak sah' });

    const { data: profile, error: profileErr } = await service
      .from('profiles')
      .select('role,status')
      .eq('id', user.id)
      .single();
    if (profileErr || !profile || profile.role !== 'admin' || profile.status !== 'active') {
      return send(res, 403, { error: 'Admin sahaja' });
    }

    const { data: posts, error: postsErr } = await service
      .from('social_posts')
      .select('id,caption,status,approval_status,external_post_id,external_post_url,error_message,created_at,posted_at')
      .eq('platform', 'tiktok')
      .order('created_at', { ascending: false })
      .limit(20);
    if (postsErr) throw postsErr;

    const ids = (posts || []).map(p => p.id);
    let logs = [];
    if (ids.length) {
      const { data, error } = await service
        .from('social_publish_logs')
        .select('id,post_id,action,status,provider_response,error_message,created_at')
        .in('post_id', ids)
        .order('created_at', { ascending: false });
      if (error) throw error;
      logs = data || [];
    }

    const latestLogByPost = new Map();
    for (const log of logs) {
      if (!latestLogByPost.has(log.post_id)) latestLogByPost.set(log.post_id, log);
    }

    const rows = (posts || []).map(post => ({
      ...post,
      latest_log: latestLogByPost.get(post.id) || null
    }));

    const latest = rows[0] || null;
    return send(res, 200, {
      ok: true,
      posts: rows,
      latest,
      summary: {
        total: rows.length,
        posted: rows.filter(x => x.status === 'posted').length,
        processing: rows.filter(x => x.status === 'scheduled').length,
        failed: rows.filter(x => x.status === 'failed').length
      }
    });
  } catch (e) {
    console.error('TikTok history API error', e);
    return send(res, 500, { error: e.message || 'Gagal mendapatkan TikTok Post History' });
  }
};
