"use server";

import { supabaseAdmin } from "@/utils/supabase/server";

export async function fetchSignatures() {
    const { data, error } = await supabaseAdmin
        .from("hotel_signatures")
        .select("id, hotel_id, hotel_name, signature")
        .order("hotel_id", { ascending: true });

    if (error) {
        console.error("fetchSignatures Fehler:", error.message);
        return [];
    }
    return data ?? [];
}

export async function saveSignature(id: string, signature: string) {
    const { error } = await supabaseAdmin
        .from("hotel_signatures")
        .update({ signature, updated_at: new Date().toISOString() })
        .eq("id", id);

    if (error) console.error("saveSignature Fehler:", error.message);
    return { error: error?.message ?? null };
}
