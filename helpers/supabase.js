import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export function rowToProfile(row) {
  if (!row) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': row.google_id,
    identifier: row.google_id,
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
