// Route shim for TikTok OAuth callback.
// Keeps the configured redirect URI at /api/tiktok/callback while reusing
// the existing callback handler implementation.
module.exports = require('../tiktok-callback');
