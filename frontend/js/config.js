if (!window.supabase) {
  console.error('[config] window.supabase no definit! El script CDN no ha carregat.');
}
const { createClient } = window.supabase;

const SUPABASE_URL = 'https://bczgsjpqbterxwegqgho.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_pC8DdXjqtBwsCbqz8sFjww_Dh34Jb7Z';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
console.log('[config] Supabase client creat OK');

export const BACKEND_URL = '';

export async function apiFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(BACKEND_URL + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error desconegut');
  return data;
}
