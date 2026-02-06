const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

let supabase = null;

if (!supabaseUrl || !supabaseServiceKey || supabaseUrl.includes('your-project')) {
  console.warn('⚠️  Supabase not configured - database features disabled');
  console.warn('   Configure SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  
  // Create mock client for testing routes
  supabase = {
    from: () => ({
      select: () => ({ 
        eq: () => ({ 
          single: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
          limit: () => Promise.resolve({ data: [], error: null })
        }),
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
          range: () => Promise.resolve({ data: [], error: null })
        }),
        gte: () => Promise.resolve({ data: [], error: null }),
        limit: () => Promise.resolve({ data: [], error: null })
      }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }) }) }),
      update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      upsert: () => Promise.resolve({ error: null })
    })
  };
} else {
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  console.log('✅ Supabase connected');
}

module.exports = supabase;
