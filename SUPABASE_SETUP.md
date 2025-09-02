# StarBoard - Supabase Integration Setup Guide

## Overview
StarBoard now uses Supabase as its cloud database provider instead of Firebase. Supabase provides a PostgreSQL database with a generous free tier and excellent Netlify integration.

## Quick Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up for a free account
3. Create a new project (remember your database password)
4. Wait for the project to be provisioned

### 2. Set Up the Database Table

Once your project is ready:

1. Go to the SQL Editor in your Supabase dashboard
2. Run the following SQL command:

```sql
-- Create the main storage table for StarBoard data
CREATE TABLE IF NOT EXISTS starboard_data (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index for faster queries
CREATE INDEX IF NOT EXISTS idx_starboard_id ON starboard_data(id);

-- Optional: Add a trigger to auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_starboard_updated_at 
    BEFORE UPDATE ON starboard_data 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

### 3. Get Your API Credentials

1. In your Supabase project dashboard, go to Settings → API
2. Copy the following values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **Service Role Key** (under "Service role" - this has full access to your database)

⚠️ **Important**: Keep your Service Role Key secret! Never commit it to your repository.

### 4. Configure Netlify Environment Variables

#### Option A: Through Netlify UI
1. Go to your Netlify site dashboard
2. Navigate to Site Settings → Environment Variables
3. Add these variables:
   - `SUPABASE_URL` = Your Project URL
   - `SUPABASE_SERVICE_KEY` = Your Service Role Key

#### Option B: Using Netlify CLI
```bash
netlify env:set SUPABASE_URL "https://xxxxx.supabase.co"
netlify env:set SUPABASE_SERVICE_KEY "your-service-role-key"
```

### 5. Deploy

1. Install dependencies locally:
```bash
npm install
```

2. Deploy to Netlify:
```bash
netlify deploy --prod
```

Or simply push to your connected Git repository and Netlify will auto-deploy.

## How It Works

1. **Primary Storage**: When configured, StarBoard uses Supabase as the primary data store
2. **Fallback**: If Supabase is not configured or unavailable, it falls back to:
   - Netlify Blobs (if available)
   - Local browser storage (IndexedDB + localStorage)
3. **Caching**: Data is cached locally for fast access and offline capability

## Data Structure

The Supabase table stores data in JSONB format with this structure:

```json
{
  "id": "main",
  "data": {
    "classes": {},
    "teachers": {
      "teacher": "starboard"
    },
    "settings": {
      "theme": "dark",
      "soundEnabled": true,
      "autoBackup": true
    },
    "metadata": {
      "version": "2.0",
      "created": "2024-01-01T00:00:00Z",
      "lastModified": "2024-01-01T00:00:00Z",
      "backupCount": 0
    }
  },
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## Benefits of Supabase

- ✅ **Free Tier**: 500MB database, 2GB bandwidth, 50,000 monthly active users
- ✅ **PostgreSQL**: Full SQL database with JSONB support
- ✅ **Real-time**: Built-in real-time subscriptions (can be added later)
- ✅ **Authentication**: Built-in auth system (for future enhancements)
- ✅ **Row Level Security**: Fine-grained access control
- ✅ **Automatic Backups**: Daily backups on free tier
- ✅ **REST API**: Automatic REST API generation
- ✅ **Open Source**: Self-hostable if needed

## Troubleshooting

### Data Not Syncing
1. Check that environment variables are set correctly in Netlify
2. Verify the Supabase project is active (not paused)
3. Check Netlify function logs for errors

### "Supabase not configured" Error
- Ensure both `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in Netlify

### Performance Issues
- The app caches data locally, so initial load might be slower
- Subsequent loads use cached data for instant access

## Migration from Firebase

If you were previously using Firebase:
1. Export your data using the app's export feature
2. Set up Supabase as described above
3. Import your data back into the app
4. The data will automatically sync to Supabase

## Security Notes

- The Service Role Key should only be used server-side (in Netlify Functions)
- Never expose the Service Role Key in client-side code
- Consider implementing Row Level Security (RLS) for additional protection
- The current setup uses a single shared database record for simplicity

## Support

For issues or questions:
- Check the [Supabase documentation](https://supabase.com/docs)
- Review [Netlify Functions documentation](https://docs.netlify.com/functions/overview/)
- Open an issue in the StarBoard repository