"use server";

import { supabaseAdmin } from "@/utils/supabase/server";
import { EMAIL_LIST_SELECT, ACTIVE_STATUSES, DONE_STATUSES, DASHBOARD_SHOW_SINCE } from "./constants";

export async function fetchEmails() {
    const [activeResult, doneResult] = await Promise.all([
        supabaseAdmin
            .from("emails")
            .select(EMAIL_LIST_SELECT)
            .in("status", ACTIVE_STATUSES)
            .gte("received_at", DASHBOARD_SHOW_SINCE)
            .order("received_at", { ascending: false })
            .limit(300),
        supabaseAdmin
            .from("emails")
            .select(EMAIL_LIST_SELECT)
            .in("status", DONE_STATUSES)
            .gte("received_at", DASHBOARD_SHOW_SINCE)
            .order("received_at", { ascending: false })
            .limit(50),
    ]);

    if (activeResult.error) console.error("fetchEmails (aktiv) Fehler:", activeResult.error.message);
    if (doneResult.error) console.error("fetchEmails (erledigt) Fehler:", doneResult.error.message);

    // Die beiden Queries laufen parallel — wechselt der Status einer Mail exakt in diesem
    // Moment (z.B. approved → sent), könnte sie in beiden Ergebnissen auftauchen. Dedupe by id.
    const merged = [...(activeResult.data ?? []), ...(doneResult.data ?? [])];
    return Array.from(new Map(merged.map((e: any) => [e.id, e])).values());
}

// Body wird nur für die gerade ausgewählte Mail nachgeladen, nicht für die ganze Liste
// (siehe Kommentar bei EMAIL_LIST_SELECT — das war der Haupttreiber für den Egress-Überlauf).
export async function fetchEmailBody(emailId: string) {
    const { data, error } = await supabaseAdmin
        .from("emails")
        .select("id, body_text, body_html")
        .eq("id", emailId)
        .maybeSingle();

    if (error) {
        console.error("fetchEmailBody Fehler:", error.message);
        return null;
    }
    return data;
}

// queued_at markiert jede Neu-Anstoß-Aktion mit einem frischen Zeitstempel.
// Das Backend vergleicht diesen Wert vor dem Schreiben des Pipeline-Ergebnisses:
// läuft noch eine ältere Analyse für dieselbe Mail, wird ihr (dann veraltetes)
// Ergebnis verworfen statt den frischen Klick hier stillschweigend zu überschreiben.

export async function selectMail(emailId: string, currentAgentLogs?: any) {
    const { error } = await supabaseAdmin
        .from("emails")
        .update({
            status: "queued",
            // agent_logs zusammenführen statt überschreiben — empfaenger/forward_target sind
            // der primäre, deterministische Hotel-Erkennungsweg (siehe regenerateDraft-Kommentar
            // unten). Gingen sie hier verloren, fällt identifyHotel auf KI-Raten zurück.
            agent_logs: { ...(currentAgentLogs || {}), queued_at: new Date().toISOString() },
        })
        .eq("id", emailId)
        .eq("status", "new");

    if (error) console.error("selectMail Fehler:", error.message);
    return { error: error?.message ?? null };
}

export async function updateHotel(emailId: string, hotel: string, currentAgentLogs: any) {
    const { error } = await supabaseAdmin
        .from("emails")
        .update({
            status: "queued",
            intent: null,
            agent_logs: { ...currentAgentLogs, target_hotel: hotel, ai_force_hotel: hotel, queued_at: new Date().toISOString() },
        })
        .eq("id", emailId)
        .neq("status", "sent");

    if (error) console.error("updateHotel Fehler:", error.message);
    return { error: error?.message ?? null };
}

export async function regenerateDraft(emailId: string, currentAgentLogs: any) {
    const { error } = await supabaseAdmin
        .from("emails")
        .update({
            status: "queued",
            intent: null,
            api_action: null,
            draft_reply: null,
            agent_logs: {
                target_hotel: currentAgentLogs?.target_hotel || null,
                ai_force_hotel: currentAgentLogs?.ai_force_hotel || null,
                // empfaenger/forward_target sind der primäre, deterministische Hotel-Erkennungsweg
                // (identifyHotel prüft zuerst den forward_target-Header) — ohne sie fällt das Backend
                // auf KI-Raten/Keyword-Matching zurück, was leicht ein falsches Hotel treffen kann.
                empfaenger: currentAgentLogs?.empfaenger || null,
                forward_target: currentAgentLogs?.forward_target || null,
                queued_at: new Date().toISOString(),
            },
        })
        .eq("id", emailId)
        .neq("status", "sent");

    if (error) console.error("regenerateDraft Fehler:", error.message);
    return { error: error?.message ?? null };
}

export async function forceProcess(emailId: string, currentAgentLogs: any) {
    const { error } = await supabaseAdmin
        .from("emails")
        .update({
            status: "queued",
            intent: null,
            api_action: null,
            draft_reply: null,
            agent_logs: {
                target_hotel: currentAgentLogs?.target_hotel || null,
                ai_force_hotel: currentAgentLogs?.ai_force_hotel || null,
                empfaenger: currentAgentLogs?.empfaenger || null,
                forward_target: currentAgentLogs?.forward_target || null,
                force_process: true,
                queued_at: new Date().toISOString(),
            },
        })
        .eq("id", emailId)
        .neq("status", "sent");

    if (error) console.error("forceProcess Fehler:", error.message);
    return { error: error?.message ?? null };
}

export async function approveOrRejectMail(emailId: string, action: "approve" | "reject", editedDraft?: string) {
    const update = action === "approve"
        ? { draft_reply: editedDraft, status: "approved" }
        : { status: "rejected" };

    const { error } = await supabaseAdmin
        .from("emails")
        .update(update)
        .eq("id", emailId)
        .eq("status", "processing"); // nur ein Entwurf, der tatsächlich noch zur Freigabe ansteht

    if (error) console.error("approveOrRejectMail Fehler:", error.message);
    return { error: error?.message ?? null };
}
