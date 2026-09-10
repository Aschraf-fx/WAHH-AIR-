module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return res.status(500).json({ error: 'Missing Supabase environment variables' });
  return res.status(200).json({ supabaseUrl, supabaseAnonKey });
};
