const host = window.location.hostname;
export const BACKEND_URL = (host === 'localhost' || host === 'donam-bauxa.vercel.app')
  ? ''
  : 'https://donam-bauxa.vercel.app';

export async function apiFetch(url, options = {}) {
  const res = await fetch(BACKEND_URL + url, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconegut');
  return data;
}
