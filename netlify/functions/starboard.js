// Netlify Function: StarBoard storage using Netlify Blobs
// Methods:
// - GET: returns current JSON data
// - PUT: replaces JSON data with request body

import { getStore } from '@netlify/blobs';

export async function handler(event) {
  try {
    const store = getStore('starboard');
    const key = 'data.json';

    if (event.httpMethod === 'GET') {
      const value = await store.get(key, { type: 'json' });
      const data = value || createDefaultData();
      return json(200, data, { 'Cache-Control': 'no-store' });
    }

    if (event.httpMethod === 'PUT') {
      const body = event.body || '{}';
      const parsed = JSON.parse(body);
      // Lightweight validation
      if (!parsed || typeof parsed !== 'object' || !parsed.classes) {
        return json(400, { error: 'Invalid data' });
      }
      await store.setJSON(key, parsed);
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, PUT' });
  } catch (err) {
    return json(500, { error: err.message });
  }
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
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

