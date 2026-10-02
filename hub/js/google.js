// Google sign-in (Google Identity Services token flow) + Drive appDataFolder
// sync. The appDataFolder is private to this app: it is hidden from the
// user's normal Drive and other apps cannot read it.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'ai-hub-state.json';

let gisLoading;
let tokenClient, tokenClientId;
let token = null; // { access_token, expiresAt }

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

// Must be called from a click handler (it opens Google's popup).
export async function requestToken(clientId, { hint, silent } = {}) {
  await loadGis();
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = resp => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = { access_token: resp.access_token, expiresAt: Date.now() + (resp.expires_in - 60) * 1000 };
      resolve(token);
    };
    tokenClient.error_callback = err => reject(new Error(err?.message || err?.type || 'Sign-in cancelled.'));
    tokenClient.requestAccessToken({ prompt: silent ? '' : 'select_account', login_hint: hint });
  });
}

export const hasValidToken = () => !!token && Date.now() < token.expiresAt;

export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
}

async function api(url, init = {}) {
  if (!hasValidToken()) throw Object.assign(new Error('Google session expired.'), { expired: true });
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token.access_token}` } });
  if (res.status === 401) { token = null; throw Object.assign(new Error('Google session expired.'), { expired: true }); }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

export async function getProfile() {
  const p = await (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json();
  return { id: `google:${p.sub}`, email: p.email, name: p.name || p.email, picture: p.picture || '' };
}

let fileId = null;

async function findFile() {
  if (fileId) return fileId;
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await (await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
  fileId = r.files?.[0]?.id || null;
  return fileId;
}

export async function pullState() {
  const id = await findFile();
  if (!id) return null;
  return (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
}

export async function pushState(state) {
  const body = JSON.stringify(state);
  const id = await findFile();
  if (id) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body,
    });
    return;
  }
  const boundary = `aihub${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\ncontent-type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await (await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: multipart,
  })).json();
  fileId = r.id;
}

export function resetFileCache() { fileId = null; }
