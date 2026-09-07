// Runs before the existing login/verification Action. Failed synchronization is
// retried on the next login; existing accounts and later profile edits are skipped.
exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== event.secrets.EASTMONEY_CLIENT_ID
    || event.connection.name !== 'eastmoney-email'
    || event.user.app_metadata?.eastmoney_signup_profile_pending !== true) return;
  const name = event.user.user_metadata?.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 50
    || /[\u0000-\u001f\u007f<>]/.test(name)) return api.access.deny('注册姓名无效，请联系管理员');
  const origin = 'https://hasbai.eu.auth0.com';
  try {
    const tokenResponse = await fetch(`${origin}/oauth/token`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: event.secrets.PROFILE_CLIENT_ID,
        client_secret: event.secrets.PROFILE_CLIENT_SECRET, audience: `${origin}/api/v2/` }),
    });
    if (!tokenResponse.ok) throw new Error('token');
    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string' || !token.access_token) throw new Error('token');
    const response = await fetch(`${origin}/api/v2/users/${encodeURIComponent(event.user.user_id)}`, {
      method: 'PATCH', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), nickname: name.trim() }),
    });
    if (!response.ok) throw new Error('profile');
    const profile = await response.json();
    if (profile.name !== name.trim() || profile.nickname !== name.trim()) throw new Error('profile');
    api.user.setAppMetadata('eastmoney_signup_profile_pending', false);
  } catch {
    api.access.deny('暂时无法保存注册资料，请稍后重新登录');
  }
};
