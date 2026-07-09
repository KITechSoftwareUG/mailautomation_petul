import { createClient } from "@supabase/supabase-js";

// Serverseitiger Supabase-Client mit Service-Role-Key.
// NIEMALS aus einer "use client"-Datei importieren — der Key darf nicht ins Browser-Bundle gelangen.
// Alle Lese-/Schreibzugriffe des Dashboards laufen über Server Actions/Components, die diesen Client nutzen;
// die einzige Zugriffskontrolle ist das Passwort-Cookie aus proxy.ts (kein Supabase Auth im Einsatz).

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen in der Umgebung.");
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
