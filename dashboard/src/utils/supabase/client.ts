import { createClient } from "@supabase/supabase-js";

// This is a client-side Supabase instance.
// Note: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.
// For internal admin dashboards, we might just inject the SUPABASE_URL and Service Role if NOT exposed to public.
// Since this is a server-side rendered admin UI, we can use the regular env vars safely in server components.
// For client components, we use public vars.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

export const supabase = createClient(supabaseUrl, supabaseKey);
