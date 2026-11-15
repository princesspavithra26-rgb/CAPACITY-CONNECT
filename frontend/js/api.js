/* Shared API client for CAPACITY CONNECT. The frontend is served by the backend on the same origin. */
(() => {
  const API_BASE = window.CAPACITY_CONNECT_API_URL || `${window.location.origin}/api`;

  async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData) && options.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = options.token || localStorage.getItem('capacityConnectToken');
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      headers,
      ...(options.body !== undefined
        ? { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) }
        : {})
    });
    let data;
    try { data = await response.json(); }
    catch (_) { data = { message: 'The server returned an unreadable response.' }; }
    if (!response.ok || data.success === false) {
      if (response.status === 401) clearSession();
      throw new Error(data.message || `Request failed (${response.status}).`);
    }
    return data;
  }

  function saveSession(result) {
    if (!result || !result.token || !result.user) throw new Error('The server did not return a valid login session.');
    localStorage.setItem('capacityConnectToken', result.token);
    localStorage.setItem('capacityConnectUser', JSON.stringify(result.user));
    localStorage.setItem('capacityConnectRole', result.user.role);
  }
  function clearSession() {
    localStorage.removeItem('capacityConnectToken');
    localStorage.removeItem('capacityConnectUser');
    localStorage.removeItem('capacityConnectRole');
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem('capacityConnectUser') || 'null'); }
    catch (_) { return null; }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }
  function qs(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const str = query.toString();
    return str ? `?${str}` : '';
  }

  window.CCAPI = { request, get: (p) => request(p), post: (p, body) => request(p, { method: 'POST', body }),
    put: (p, body) => request(p, { method: 'PUT', body }), patch: (p, body) => request(p, { method: 'PATCH', body }),
    delete: (p) => request(p, { method: 'DELETE' }), upload: (p, formData) => request(p, { method: 'POST', body: formData }), saveSession, clearSession, getUser, escapeHtml, qs, baseUrl: API_BASE };
})();
