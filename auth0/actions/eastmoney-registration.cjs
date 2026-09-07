// Auth0 pre-user-registration Action, scoped to the existing email connection.
exports.onExecutePreUserRegistration = async (event, api) => {
  if (event.connection.name !== 'eastmoney-email') return;
  if (!/^[^@\s]+@18\.cn$/i.test(String(event.user.email || '').trim())) {
    return api.access.deny('email_domain_not_allowed', '仅支持使用 18.cn 邮箱注册');
  }
  const body = event.request?.body || {};
  const clean = (value, limit) => typeof value === 'string' && value.trim().length > 0
    && value.trim().length <= limit && !/[\u0000-\u001f\u007f<>]/.test(value) ? value.trim() : null;
  const name = clean(body['ulp-name'], 50);
  const department = clean(body['ulp-department'], 100);
  if (!name) return api.validation.error('invalid_name', '请填写姓名，最多 50 个字符');
  if (!department) return api.validation.error('invalid_department', '请填写部门，最多 100 个字符');
  api.user.setUserMetadata('name', name);
  api.user.setUserMetadata('department', department);
  // Only this server-controlled marker triggers initial root-profile synchronization.
  api.user.setAppMetadata('eastmoney_signup_profile_pending', true);
};
