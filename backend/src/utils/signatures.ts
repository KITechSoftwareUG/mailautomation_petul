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
// Erkennt die ausgelieferten Seed-Platzhalter. Gingen sie ungefüllt raus, stünde in
// jeder Mail an einen Gast eine erfundene Anschrift, und die Pflichtangaben nach
// §5 TMG / §35a GmbHG wären unvollständig. Die Prüfung ist bewusst großzügig — ein
// falscher Alarm kostet einen Blick ins Dashboard, ein übersehener Platzhalter geht
// an echte Gäste.
const PLACEHOLDER_PATTERN = /Musterstra|Musterstadt|\[Name\]|\[Nummer\]|\[Telefon\]|\[E-?Mail\]|44000|XXX|TODO/i;

export function hasPlaceholder(signature: string | null | undefined): boolean {
    return PLACEHOLDER_PATTERN.test(signature || "");
}

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
