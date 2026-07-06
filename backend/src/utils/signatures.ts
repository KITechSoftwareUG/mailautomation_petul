import type { SupabaseClient } from "@supabase/supabase-js";

// Letzter Rückfallwert, falls die Tabelle "hotel_signatures" leer ist oder die DB nicht erreichbar ist.
const FALLBACK_SIGNATURE = `
--
Mit freundlichen Grüßen

Petul Hotels GmbH
`;

/**
 * Signatur für ein Hotel laden (konfigurierbar im Dashboard unter /settings, Tabelle "hotel_signatures").
 * Fällt zurück auf die "DEFAULT"-Zeile, wenn kein Hotel identifiziert wurde oder keine hotelspezifische
 * Signatur existiert, und auf FALLBACK_SIGNATURE, wenn selbst das fehlschlägt.
 */
export async function getSignature(supabase: SupabaseClient, hotelId: string | null | undefined): Promise<string> {
    const lookupId = hotelId || "DEFAULT";

    const { data } = await supabase
        .from("hotel_signatures")
        .select("signature")
        .eq("hotel_id", lookupId)
        .maybeSingle();
    if (data?.signature) return data.signature;

    if (lookupId !== "DEFAULT") {
        const { data: defaultRow } = await supabase
            .from("hotel_signatures")
            .select("signature")
            .eq("hotel_id", "DEFAULT")
            .maybeSingle();
        if (defaultRow?.signature) return defaultRow.signature;
    }

    return FALLBACK_SIGNATURE;
}
