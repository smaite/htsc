// Netlify Function: StarBoard storage using Supabase
// This replaces the Firebase integration with Supabase

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client using environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

export async function handler(event) {
  try {
    // Check if Supabase is configured
    if (!supabaseUrl || !supabaseKey) {
      return json(500, { 
        error: 'Supabase not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.' 
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    if (event.httpMethod === 'GET') {
      // Fetch data from Supabase
      const { data, error } = await supabase
        .from('starboard_data')
        .select('*')
        .eq('id', 'main')
        .single();

      if (error && error.code === 'PGRST116') {
        // No data found, return default
        const defaultData = createDefaultData();
        // Try to insert default data
        await supabase
          .from('starboard_data')
          .insert([{ id: 'main', data: defaultData }]);
        return json(200, defaultData);
      }

      if (error) {
        throw error;
      }

      return json(200, data.data || createDefaultData());
    }

    if (event.httpMethod === 'PUT') {
      const body = event.body || '{}';
      const parsed = JSON.parse(body);
      
      // Validate data structure
      if (!parsed || typeof parsed !== 'object' || !parsed.classes) {
        return json(400, { error: 'Invalid data structure' });
      }

      // Update or insert data in Supabase
      const { error } = await supabase
        .from('starboard_data')
        .upsert([{ 
          id: 'main', 
          data: parsed,
          updated_at: new Date().toISOString()
        }]);

      if (error) {
        throw error;
      }

      return json(200, { success: true });
    }

    if (event.httpMethod === 'OPTIONS') {
      // Handle CORS preflight
      return json(200, {}, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS'
      });
    }

    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT, OPTIONS' });
  } catch (err) {
    console.error('Supabase error:', err);
    return json(500, { error: err.message });
  }
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...headers 
    },
    body: JSON.stringify(body)
  };
}

function createDefaultData() {
  const now = new Date().toISOString();
  return {
    classes: {},
    teachers: { teacher: 'starboard' },
    settings: { theme: 'dark', soundEnabled: true, autoBackup: true },
    metadata: { version: '2.0', created: now, lastModified: now, backupCount: 0 }
  };
}