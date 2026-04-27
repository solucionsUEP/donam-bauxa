import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'placeholder';

export const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : (() => {
      const mock = {
        auth: { getUser: () => ({ data: { user: null }, error: null }) },
        from: () => mock,
        select: () => mock,
        eq: () => mock,
        single: () => ({ data: null }),
        order: () => mock,
        limit: () => mock,
        insert: () => mock,
        update: () => mock,
        delete: () => mock,
        then: (cb) => cb({ data: [], error: null }) // Handles awaiting the chain
      };
      return mock;
    })();

export function rowToProfile(row) {
  if (!row) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': row.id,
    identifier: row.id,
    name: row.name,
    email: row.email,
    image: row.image || '',
    jobTitle: row.role,
    description: row.description || '',
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'displayName', value: row.display_name || row.name }
    ],
    dateCreated: row.created_at
  };
}
