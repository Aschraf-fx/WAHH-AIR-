const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');

const ALLOWED = new Set(['image/jpeg','image/png','image/webp']);

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase server environment variables');
  return createClient(url, key, { auth:{ persistSession:false, autoRefreshToken:false } });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const supabase = getAdminClient();

    if (req.method === 'POST') {
      const contentType = String(req.body?.contentType || '').toLowerCase();
      if (!ALLOWED.has(contentType)) {
        return res.status(400).json({ error:'Gambar mesti dalam format JPG, PNG atau WEBP.' });
      }

      const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
      const path = `pending/${Date.now()}-${randomUUID()}.${ext}`;
      const { data, error } = await supabase.storage.from('rider-profiles').createSignedUploadUrl(path);
      if (error) throw error;
      return res.status(200).json({ path, token:data.token });
    }

    if (req.method === 'DELETE') {
      const path = String(req.body?.path || '');
      if (!/^pending\/[A-Za-z0-9._-]+$/.test(path)) return res.status(400).json({ error:'Invalid path' });
      const { error } = await supabase.storage.from('rider-profiles').remove([path]);
      if (error) throw error;
      return res.status(200).json({ ok:true });
    }

    res.setHeader('Allow','POST, DELETE');
    return res.status(405).json({ error:'Method not allowed' });
  } catch (err) {
    console.error('Rider profile upload error:', err);
    return res.status(500).json({ error:'Tidak dapat menyediakan upload gambar Rider.' });
  }
};
