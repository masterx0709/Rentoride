// Shared Supabase client — used by login.html, customer-dashboard.html, owner-dashboard.html
// Loaded via <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
// before this file.

const SUPABASE_URL = 'https://ftaljlznpvaeceawjzvj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_OTNDEjcGYqVts5Y4hupz0A_QLcSfHrp';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Redirects an unauthenticated visitor to the login page.
// Call this at the top of any page that requires a signed-in user.
async function requireAuth(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session){
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

// Fetches (or lazily creates) the profile row for the current user.
async function getMyProfile(userId){
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) console.error('getMyProfile error:', error.message);
  return data;
}
