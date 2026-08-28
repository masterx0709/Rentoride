// Shared Supabase client — used by customer-dashboard.html, owner-dashboard.html,
// auth-callback.html, reset-password.html, index.html.
// Must be loaded AFTER:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>

const SUPABASE_URL = 'https://ftaljlznpvaeceawjzvj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OTNDEjcGYqVts5Y4hupz0A_QLcSfHrp';

let supabaseClient;
if (window.supabase && typeof window.supabase.createClient === 'function'){
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
} else {
  // The CDN script (supabase-js) didn't load before this file ran — this is
  // the root cause of "supabaseClient is not defined" errors downstream.
  // Check: script order in <head>, CDN reachability, ad-blockers, and that
  // this file itself deployed correctly (no 404 on /supabase-client.js).
  console.error('Supabase SDK failed to load from CDN — supabaseClient was not created.');
}

// Redirects an unauthenticated visitor to the login page.
// Call this at the top of any page that requires a signed-in user.
async function requireAuth(){
  if (!supabaseClient){ window.location.href = 'login.html'; return null; }
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session){
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// Fetches (or lazily creates) the profile row for the current user.
async function getMyProfile(userId){
  if (!supabaseClient) return null;
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) console.error('getMyProfile error:', error.message);
  return data;
}
