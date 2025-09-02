# StarBoard - Student Star Rating System with Supabase

## 🎯 Overview

StarBoard is a student star rating and leaderboard system that now uses **Supabase** for cloud data storage instead of Firebase. This provides a more modern, PostgreSQL-based solution with excellent Netlify integration.

## 🚀 What's Changed

### Previous Setup (Firebase)
- Used Firebase Firestore for cloud storage
- Required complex Firebase configuration
- Dynamic imports of Firebase SDK

### New Setup (Supabase)
- Uses Supabase (PostgreSQL) for cloud storage
- Simpler configuration through Netlify environment variables
- Better integration with Netlify Functions
- Automatic fallback to local storage if not configured

## 📋 Features

- **Dual Interface**: Public leaderboard view and teacher management portal
- **Cloud Storage**: Automatic sync with Supabase when configured
- **Offline Capable**: Falls back to local storage when offline
- **Multiple Storage Layers**:
  1. Primary: Supabase (when configured)
  2. Secondary: Netlify Blobs (legacy support)
  3. Fallback: Local browser storage (IndexedDB + localStorage)

## 🛠️ Setup Instructions

### Quick Start

1. **Clone/Deploy to Netlify**
   - Deploy this repository to Netlify
   - The app will work immediately with local storage

2. **Set Up Supabase (Optional but Recommended)**
   - Follow the instructions in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)
   - This enables cloud sync across devices

### Environment Variables

Add these to your Netlify site settings:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### Database Schema

Run this SQL in your Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS starboard_data (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_starboard_id ON starboard_data(id);
```

## 📁 Project Structure

```
starboard/
├── index.html              # Main application
├── script.js              # Updated with Supabase integration
├── styles.css             # Glassmorphism UI styles
├── netlify.toml           # Netlify configuration
├── package.json           # Dependencies (includes @supabase/supabase-js)
├── SUPABASE_SETUP.md      # Detailed Supabase setup guide
├── test-supabase.html     # Test page for Supabase integration
└── netlify/
    └── functions/
        ├── starboard.js           # Legacy Netlify Blobs function
        └── supabase-starboard.js  # New Supabase function
```

## 🔄 Data Flow

1. **Read Operation**:
   - Check memory cache first (instant)
   - Try Supabase via Netlify Function
   - Fall back to Netlify Blobs
   - Fall back to local storage

2. **Write Operation**:
   - Update memory cache immediately
   - Save to Supabase (if configured)
   - Fall back to Netlify Blobs
   - Fall back to local storage
   - Always update localStorage cache

## 🧪 Testing

1. **Local Testing** (without Supabase):
   - Open `index.html` directly
   - Data will be stored locally in browser

2. **Supabase Integration Testing**:
   - Deploy to Netlify
   - Configure environment variables
   - Open `test-supabase.html` on your deployed site
   - Run the test suite to verify connection

## 🔐 Security

- Service Role Key is only used server-side (Netlify Functions)
- No API keys exposed in client-side code
- Data validation on both client and server
- Automatic sanitization of user inputs

## 📊 Benefits of Supabase

| Feature | Supabase | Firebase |
|---------|----------|----------|
| Database Type | PostgreSQL | NoSQL |
| Free Tier | 500MB + 2GB bandwidth | Limited |
| Real-time | Built-in | Yes |
| Authentication | Built-in | Yes |
| Open Source | Yes | No |
| Self-hostable | Yes | No |
| SQL Support | Full SQL | No |

## 🔧 Troubleshooting

### "Supabase not configured" Error
- Ensure environment variables are set in Netlify
- Check that your Supabase project is active

### Data Not Syncing
1. Check Netlify Function logs
2. Verify Supabase credentials
3. Ensure database table exists
4. Check network connectivity

### Performance Issues
- Initial load may be slower (fetching from cloud)
- Subsequent loads use cached data
- Consider enabling Supabase connection pooling

## 📝 Migration from Firebase

If you were using the Firebase version:

1. Export your data using the app's export feature
2. Set up Supabase following the guide
3. Import your data back
4. Remove Firebase configuration

## 🤝 Contributing

Contributions are welcome! The codebase is vanilla JavaScript with no build process required.

## 📄 License

MIT License - feel free to use this in your educational institution!

## 🆘 Support

- **Supabase Issues**: Check [Supabase docs](https://supabase.com/docs)
- **Netlify Issues**: Check [Netlify docs](https://docs.netlify.com)
- **App Issues**: Open an issue in this repository

## 🎉 Acknowledgments

- Built with vanilla JavaScript - no frameworks required!
- Glassmorphism UI design
- Powered by Supabase and Netlify

---

**Note**: The app works perfectly fine without Supabase configuration - it will simply use local browser storage. Supabase is recommended for multi-device sync and data backup.