const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return res.status(500).json({ error: 'Server environment belum lengkap' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const publicClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await publicClient.auth.getUser(token);
  if (userError || !userData.user) return res.status(401).json({ error: 'Invalid session' });

  const { data: actor } = await adminClient.from('profiles').select('id,role,status').eq('id', userData.user.id).single();
  if (!actor || actor.role !== 'admin' || actor.status !== 'active') return res.status(403).json({ error: 'Admin access required' });

  const publicId = String(req.body?.publicId || '').trim();
  if (!publicId) return res.status(400).json({ error: 'publicId required' });
  const { data: target, error: targetError } = await adminClient.from('profiles').select('id,role,public_id').eq('public_id', publicId).single();
  if (targetError || !target) return res.status(404).json({ error: 'Account tidak ditemui' });
  if (target.role === 'admin') return res.status(403).json({ error: 'Admin account tidak boleh dipadam melalui endpoint ini' });
  if (target.id === actor.id) return res.status(400).json({ error: 'Tidak boleh delete akaun sendiri' });

  const { data: location } = await adminClient.from('stock_locations').select('id').eq('user_id', target.id).maybeSingle();
  if (location) {
    const { data: balances } = await adminClient.from('inventory_balances').select('quantity').eq('location_id', location.id).gt('quantity', 0).limit(1);
    if (balances?.length) return res.status(409).json({ error: 'Akaun masih mempunyai stok. Return/adjust stok dahulu sebelum delete.' });
  }
  const { data: unsettled } = await adminClient.from('sales').select('id').eq('seller_id', target.id).eq('status', 'finalized').neq('commission_status', 'paid').gt('commission_amount', 0).limit(1);
  if (unsettled?.length) return res.status(409).json({ error: 'Masih ada komisen belum Paid. Selesaikan komisen dahulu sebelum delete.' });

  const { error: delError } = await adminClient.auth.admin.deleteUser(target.id);
  if (delError) return res.status(500).json({ error: delError.message });
  return res.status(200).json({ ok: true, publicId });
};
