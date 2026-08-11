"use server";

import { supabaseAdmin } from "@/utils/supabase/server";
import { EMAIL_LIST_SELECT, ACTIVE_STATUSES, DONE_STATUSES } from "./constants";

export async function fetchEmails() {
    const [activeResult, doneResult] = await Promise.all([
        supabaseAdmin
            .from("emails")
            .select(EMAIL_LIST_SELECT)
            .in("status", ACTIVE_STATUSES)
            .order("received_at", { ascending: false })
            .limit(300),
        supabaseAdmin
            .from("emails")
            .select(EMAIL_LIST_SELECT)
            .in("status", DONE_STATUSES)
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
/**
 * Was die 3RPMS-Anbindung je Hotel real kann. Wird im Dashboard als Statusleiste
 * angezeigt, damit sichtbar ist, welche Aktionen automatisch laufen und welche
 * (noch) von Hand erledigt werden müssen.
 *
 * Fehlt die Tabelle — die Migration ist optional —, wird still ein leeres Ergebnis
 * geliefert: Die entscheidende Information steht ohnehin pro Mail in agent_logs.
 */
export async function fetchCapabilities() {
    // Quelle ist der Freischaltstand, den das Backend bei jeder verarbeiteten Mail
    // kompakt in agent_logs.caps ablegt. Bewusst so und nicht über eine eigene Tabelle:
    // für DDL fehlen an diesem Supabase-Projekt die Rechte, und so braucht die Anzeige
    // keinen Einrichtungsschritt. Es genügt die jüngste Mail — der Stand ist für alle
    // fünf Häuser identisch und ändert sich nur, wenn 3RPMS etwas freischaltet.
    const { data, error } = await supabaseAdmin
        .from("emails")
        .select("agent_logs")
        .not("agent_logs->caps", "is", null)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !data) return null;

    const c = (data.agent_logs as any)?.caps;
    if (!c) return null;

    return {
        reservierungsApi: !!c.r,
        salesProduct: !!c.s,
        paymentMethod: !!c.p,
        geprueftAm: c.t ?? null,
    };
}

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

    // .select("id") ist hier nicht kosmetisch: ohne die Rückmeldung, ob überhaupt eine
    // Zeile getroffen wurde, lief die Freigabe stumm ins Leere. Hatte eine Kollegin
    // dieselbe Mail Sekunden früher freigegeben (Polling alle 15 s), traf der Filter
    // .eq("status","processing") nichts — die eigenen Textkorrekturen waren weg, die
    // Oberfläche meldete Erfolg und sprang zur nächsten Mail. Gesendet wurde die
    // Version der Kollegin.
    const { data, error } = await supabaseAdmin
        .from("emails")
        .update(update)
        .eq("id", emailId)
        .eq("status", "processing") // nur ein Entwurf, der tatsächlich noch zur Freigabe ansteht
        .select("id");

    if (error) {
        console.error("approveOrRejectMail Fehler:", error.message);
        return { error: error.message };
    }

    if (!data || data.length === 0) {
        return {
            error: "Diese Mail wurde zwischenzeitlich von jemand anderem bearbeitet oder neu analysiert. "
                 + "Bitte die Ansicht aktualisieren und den Entwurf erneut prüfen — deine Änderungen wurden NICHT gesendet.",
        };
    }

    return { error: null };
}
