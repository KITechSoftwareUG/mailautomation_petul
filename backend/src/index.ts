/**
 * PETUL – Standalone Node.js Mail Automation
 *
 * Ablauf bei eingehender Mail:
 * 1. Parsen & normalisieren
 * 2. In Supabase speichern (RPC process_incoming_email)
 * 3. KI-Pipeline: Intent → Policy → Action Agent (lädt PMS-Daten via Tools selbst)
 * 4. Ergebnis (inkl. geplanter Mutation) in Supabase schreiben, Status: "processing"
 * 5. Mensch genehmigt im Dashboard → Status: "approved"
 * 6. processOutbound führt Mutation aus, sendet E-Mail, Status: "sent"
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import * as dotenv from "dotenv";
import { processIntent } from "./agents/01_intentAgent";
import { checkPolicy } from "./agents/02_policyAgent";
import { determineAction } from "./agents/03_actionAgent";
import {
    HOTELS,
    identifyHotel,
    query3RPMS,
    getReservationByCode,
    searchReservationsByEmail,
    getInventory,
    getHotelSettings,
} from "./utils/threerpms";
import { getSignature } from "./utils/signatures";

dotenv.config();

// ─── Helpers: Normalization ───────────────────────────────────────────────────

function cleanId(val: string | null | undefined): string | null {
    if (!val) return null;
    return val.replace(/[<>]/g, "").trim();
}

function getMessageId(parsed: any): string | null {
    let id =
        parsed.messageId ||
        parsed.headers?.get?.("message-id") ||
        parsed.headers?.get?.("Message-ID") ||
        null;

    id = cleanId(id);

    if (!id) {
        id =
            (parsed.from?.text || "") +
            "_" +
            (parsed.date ? parsed.date.toISOString() : "") +
            "_" +
            (parsed.subject || "");
    }

    return id;
}

function extractEmails(field: any): string[] {
    if (!field) return [];
    if (field.value && Array.isArray(field.value)) {
        return field.value.map((v: any) => v.address).filter(Boolean);
    }
    if (typeof field === "string") return [field];
    return [];
}

// ─── Env Validation ───────────────────────────────────────────────────────────

const imapHost = process.env.IMAP_HOST;
const imapUser = process.env.IMAP_USER;
const imapPassword = process.env.IMAP_PASSWORD;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!imapHost || !imapUser || !imapPassword || !supabaseUrl || !supabaseKey) {
    console.error("❌ Kritische Umgebungsvariablen fehlen in der .env!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const transporter = nodemailer.createTransport({
    host: process.env.IMAP_HOST,
    port: 465,
    secure: true,
    auth: { user: imapUser!, pass: imapPassword! },
});

// ─── Hotel Product Cache (einmalig beim Start geladen) ────────────────────────

const hotelProductsCache: Record<string, any> = {};
const pipelineInProgress = new Set<string>(); // verhindert doppelte Verarbeitung

async function warmProductCache() {
    console.log("🗂️  Produkt-Cache: Lade Hotel-Settings aus 3RPMS...");
    for (const hotel of HOTELS) {
        if (!hotel.key) continue;
        try {
            const settings = await getHotelSettings(hotel.key);
            hotelProductsCache[hotel.id] = settings;
            console.log(`   ✅ ${hotel.name}: Settings geladen`);
        } catch (err: any) {
            console.warn(`   ⚠️  ${hotel.name}: Settings nicht verfügbar (${err.message})`);
        }
    }
}

// ─── KI Pipeline ──────────────────────────────────────────────────────────────

type PmsLookupResult = { attempted: boolean; data: any | null; error?: string };

// Schreibt ein Pipeline-Ergebnis nur, wenn die Mail nicht zwischenzeitlich erneut
// angestoßen wurde (Dashboard-Klick während dieser Lauf noch läuft). Sonst würde
// ein veralteter Auto-Lauf das Ergebnis eines frischen "Neu prüfen"/"Trotzdem
// bearbeiten"-Klicks kommentarlos überschreiben — genau das sorgt für den Eindruck,
// dass Klicks im Dashboard "nichts bewirken".
// Die Prüfung ist Teil des UPDATE selbst (WHERE agent_logs->>queued_at = erwartet),
// nicht ein separates SELECT davor — sonst bliebe ein kurzes Zeitfenster für genau
// das Race, das diese Funktion eigentlich verhindern soll.
async function writeResultIfCurrent(mailId: string, expectedQueuedAt: string | null | undefined, updateFields: Record<string, any>): Promise<boolean> {
    let query = supabase.from("emails").update(updateFields).eq("mail_id", mailId);
    if (expectedQueuedAt) {
        query = query.eq("agent_logs->>queued_at", expectedQueuedAt);
    }
    const { data, error } = await query.select("id");

    if (error) {
        console.error(`❌ DB-Update fehlgeschlagen (${mailId}):`, error.message);
        return false;
    }
    if (expectedQueuedAt && (!data || data.length === 0)) {
        console.log(`⏭️  ${mailId}: zwischenzeitlich erneut angestoßen — verwerfe veraltetes Pipeline-Ergebnis`);
        return false;
    }
    return true;
}

async function runAiPipeline(mailData: any, threadId: string | null) {
    if (pipelineInProgress.has(mailData.mail_id)) {
        console.log(`⏭️  Pipeline läuft bereits für ${mailData.mail_id} – überspringe`);
        return;
    }
    pipelineInProgress.add(mailData.mail_id);
    console.log(`🤖 KI Pipeline startet für mail_id: ${mailData.mail_id}`);

    // Langen E-Mail-Text kürzen — reduziert Kontext für alle 3 LLM-Calls
    const bodyText = (mailData.body_text || "").slice(0, 3000);
    const queuedAt = mailData.queued_at ?? null;
    let intentData: any = null;
    let policyData: any = null;

    try {
        // 0. Früher Start: 3RPMS E-Mail-Lookup SOFORT starten (parallel zu History + Intent)
        //    Hotel aus Header deterministisch bestimmen — kein AI-Output nötig
        const hotelEarly = identifyHotel(mailData.empfaenger, mailData.forward_target, null);
        const earlyEmailLookup: Promise<PmsLookupResult> =
            (hotelEarly?.key && mailData.absender)
                ? searchReservationsByEmail(hotelEarly.key, mailData.absender)
                    .then(r => r
                        ? (console.log(`   ✅ [Early] Gast per E-Mail gefunden`), { attempted: true, data: r })
                        : { attempted: false, data: null }
                    )
                    .catch((err: any) => (
                        console.warn(`   ⚠️  [Early] E-Mail-Suche Fehler: ${err.message}`),
                        { attempted: true, data: null, error: err.message }
                    ))
                : Promise.resolve({ attempted: false, data: null });

        // 1. Thread History laden (parallel zum frühen Lookup)
        let historyText = "Keine Historie vorhanden.";
        if (threadId) {
            const { data: historyRows } = await supabase
                .from("emails")
                .select("body_text, received_at, senders!inner(email)")
                .eq("thread_id", threadId)
                .order("received_at", { ascending: false })
                .limit(3);

            if (historyRows && historyRows.length > 1) {
                historyText = historyRows
                    .map((r: any) => `[${new Date(r.received_at).toLocaleString()}] Von: ${r.senders.email}\n${r.body_text?.slice(0, 500) || ""}`)
                    .join("\n\n---\n\n");
            }
        }

        // 2. Agent 1: Intent
        console.log("   - [Step 1] Intent Agent arbeitet...");
        intentData = await processIntent({ ...mailData, body_text: bodyText }, historyText);
        console.log(`   → Intent: ${intentData.kategorie}`);

        const IGNORE_CATEGORIES = ["Spam/Irrelevant", "Portal-Benachrichtigung", "System-Benachrichtigung"];
        if (IGNORE_CATEGORIES.includes(intentData.kategorie) && !mailData.force_process) {
            await writeResultIfCurrent(mailData.mail_id, queuedAt, {
                status: "ignored",
                intent: intentData.kategorie,
            });
            console.log(`🗑️  ${intentData.kategorie} – als ignored markiert.`);
            return;
        }
        if (intentData.kategorie === "Spam/Irrelevant" && mailData.force_process) {
            console.log("⚠️  Spam/Irrelevant-Klassifizierung — force_process aktiv, Bearbeitung fortgesetzt.");
        }

        // 3. Hotel identifizieren
        // Manuelle Auswahl im Dashboard (agent_logs.ai_force_hotel, gesetzt von updateHotel())
        // hat absoluten Vorrang — die Rezeptionistin greift damit gezielt ein, wenn Header
        // und KI-Vermutung beide schon gescheitert sind (genau deshalb war der Selector nötig).
        // Ohne diesen Vorrang würde derselbe erneute Pipeline-Lauf wieder dieselbe Mehrdeutigkeit
        // produzieren und die manuelle Auswahl folgenlos verpuffen.
        const forcedHotel = mailData.ai_force_hotel
            ? HOTELS.find(h => h.name === mailData.ai_force_hotel) || null
            : null;
        const hotel = forcedHotel || identifyHotel(
            mailData.empfaenger,
            mailData.forward_target,
            intentData.extracted_entities.hotel_identifiziert
        );
        const hotelApiKey = hotel?.key || "";
        const resolvedHotel = hotel?.name || "Unbekannt / Petul";
        const hotelSource = forcedHotel
            ? "manuell (Dashboard)"
            : hotel
                ? (mailData.forward_target && hotel.email && mailData.forward_target.toLowerCase().includes(hotel.email) ? "email-header" : "ai-oder-keyword")
                : "unbekannt";
        console.log(`   → Hotel: ${resolvedHotel} (Quelle: ${hotelSource})`);

        // 4. Policy + 3RPMS-Lookup parallel — spart ~3-5s
        console.log("   - [Step 2] Policy + PMS-Lookup parallel...");
        const resNum = intentData.extracted_entities?.reservierungsnummer;
        const ankunft = intentData.extracted_entities?.ankunft;
        const abreise = intentData.extracted_entities?.abreise;

        const [policyResult, pmsLookupResult, prefetchedInventory] = await Promise.all([
            checkPolicy(intentData, bodyText),

            // 3RPMS: per Code (mit Priorität) oder früh gestarteter E-Mail-Lookup (meist schon fertig)
            (async (): Promise<PmsLookupResult> => {
                if (!hotelApiKey) return { attempted: false, data: null };
                if (resNum) {
                    try {
                        const res = await getReservationByCode(hotelApiKey, resNum);
                        const node = res?.reservations?.edges?.[0]?.node;
                        if (node) { console.log(`   ✅ Reservierung per Code gefunden: ${node.code}`); return { attempted: true, data: node }; }
                        console.warn(`   ⚠️  [3RPMS] Code-Suche: Reservierung "${resNum}" nicht gefunden`);
                        return { attempted: true, data: null };
                    } catch (err: any) {
                        console.warn(`   ⚠️  [3RPMS] Code-Suche Fehler: ${err.message}`);
                        return { attempted: true, data: null, error: err.message };
                    }
                }
                // Kein Code → früh gestarteten E-Mail-Lookup abwarten (meist schon fertig)
                return await earlyEmailLookup;
            })(),

            // 3RPMS: Verfügbarkeit (bei Reservierungsanfrage oder Umbuchung mit Datum)
            (async () => {
                if (!hotelApiKey || !["Reservierungsanfrage", "Umbuchung"].includes(intentData.kategorie)) return null;
                if (!ankunft || !abreise) return null;
                try {
                    const inv = await getInventory(hotelApiKey, ankunft, abreise);
                    console.log(`   ✅ Verfügbarkeit geladen`);
                    return inv;
                } catch (err: any) {
                    console.warn(`   ⚠️  [3RPMS] Verfügbarkeit: ${err.message}`);
                    return null;
                }
            })(),
        ]);
        policyData = policyResult;

        if (policyData.is_spam && !mailData.force_process) {
            await writeResultIfCurrent(mailData.mail_id, queuedAt, {
                status: "ignored",
                intent: intentData.kategorie,
                policy_decision_reason: "SPAM erkannt",
            });
            console.log("🗑️  Echter SPAM erkannt – als ignored markiert.");
            return;
        }
        if (policyData.is_spam && mailData.force_process) {
            console.log("⚠️  SPAM erkannt — force_process aktiv, Bearbeitung fortgesetzt.");
        }

        // PMS-Daten auflösen — bei fehlgeschlagenem Lookup sofort stoppen
        const prefetchedPmsData = pmsLookupResult.data;
        if (pmsLookupResult.attempted && !pmsLookupResult.data) {
            const errorMsg = pmsLookupResult.error
                ? `3RPMS Schnittstellenfehler: ${pmsLookupResult.error}`
                : resNum
                    ? `Reservierung "${resNum}" nicht im 3RPMS gefunden — bitte manuell prüfen`
                    : `Kein Gast für die Absender-E-Mail im 3RPMS gefunden — bitte manuell prüfen`;

            console.warn(`   ⚠️  PMS-Daten fehlen — kein Entwurf erstellt: ${errorMsg}`);
            await writeResultIfCurrent(mailData.mail_id, queuedAt, {
                status: "failed",
                intent: intentData.kategorie,
                policy_decision_allowed: policyData.policy_passed,
                policy_decision_reason: policyData.policy_decision_reason,
                draft_reply: null,
                api_action: null,
                agent_logs: {
                    intentData,
                    policyData,
                    pipeline_errors: [errorMsg],
                    target_hotel: resolvedHotel,
                    hotel_source: hotelSource,
                    forward_target: mailData.forward_target || null,
                    empfaenger: mailData.empfaenger || null,
                    queued_at: queuedAt,
                } as any,
            });
            return;
        }

        // 5. Action Agent — PMS-Daten bereits vorhanden, kein extra Lookup-Step nötig
        console.log("   - [Step 3] Action Agent formuliert Antwort...");
        const productCatalog = hotel ? (hotelProductsCache[hotel?.id ?? ""] ?? null) : null;
        const finalActionData = await determineAction(
            intentData,
            policyData,
            { ...mailData, body_text: bodyText },
            hotelApiKey,
            productCatalog,
            null,
            prefetchedPmsData,
            prefetchedInventory,
        );
        console.log(`   → Geplante Aktion: ${finalActionData.api_action}`);

        // 6. DB Update — determineAction wirft bei Fehlern (s. catch unten), liefert sonst immer einen Entwurf
        const wrote = await writeResultIfCurrent(mailData.mail_id, queuedAt, {
            status: "processing",
            intent: intentData.kategorie,
            policy_decision_allowed: policyData.policy_passed,
            policy_decision_reason: policyData.policy_decision_reason,
            api_action: finalActionData.api_action,
            draft_reply: finalActionData.antwort_entwurf,
            agent_logs: {
                intentData,
                policyData,
                actionData: finalActionData,
                threeRpmsData: finalActionData.threeRpmsData,
                inventoryData: finalActionData.inventoryData,
                target_hotel: resolvedHotel,
                hotel_source: hotelSource,
                forward_target: mailData.forward_target || null,
                empfaenger: mailData.empfaenger || null,
                queued_at: queuedAt,
            } as any,
        });

        if (wrote) console.log(`✅ Pipeline abgeschlossen – wartet auf Freigabe im Dashboard`);

    } catch (err: any) {
        console.error(`❌ Pipeline Fehler (${mailData.mail_id}):`, err.stack || err.message || err);
        await writeResultIfCurrent(mailData.mail_id, queuedAt, {
            status: "failed",
            intent: intentData?.kategorie ?? null,
            agent_logs: {
                intentData,
                policyData,
                pipeline_errors: [`Unerwarteter Fehler: ${err.message || String(err)}`],
                forward_target: mailData.forward_target || null,
                empfaenger: mailData.empfaenger || null,
                queued_at: queuedAt,
            } as any,
        });
    } finally {
        pipelineInProgress.delete(mailData.mail_id);
    }
}

// ─── Outbound: Mutation ausführen + E-Mail senden (nach menschlicher Freigabe) ─

async function processOutbound() {
    try {
        // WICHTIG: empfaenger/forward_target sind KEINE Spalten der emails-Tabelle,
        // sie liegen nur in agent_logs (JSONB). Ein Query mit diesen Spaltennamen
        // schlägt serverseitig fehl (400) und wurde bisher hier still verschluckt —
        // dadurch wurde nie eine genehmigte Mail tatsächlich versendet.
        const { data: approvedMails, error } = await supabase
            .from("emails")
            .select("id, mail_id, betreff, draft_reply, agent_logs, senders!inner(email)")
            .eq("status", "approved");

        if (error) {
            console.error("❌ processOutbound: Laden der genehmigten Mails fehlgeschlagen:", error.message);
            return;
        }
        if (!approvedMails || approvedMails.length === 0) return;

        for (const mail of approvedMails) {
            try {
                const recipientEmail = (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email;
                if (!recipientEmail) {
                    console.error(`❌ Sende-Fehler (${mail.mail_id}): kein Absender-E-Mail hinterlegt — als failed markiert`);
                    await supabase.from("emails").update({ status: "failed" }).eq("id", mail.id).eq("status", "approved");
                    continue;
                }

                // Atomar als "sent" beanspruchen, BEVOR tatsächlich gesendet wird — der
                // WHERE-status=approved-Guard sorgt dafür, dass nur ein Zyklus gewinnt,
                // falls processOutbound sich je überlappt. Schlägt das Senden danach doch
                // fehl, wird unten zurück auf "approved" gesetzt (Retry beim nächsten Zyklus).
                const { data: claimed, error: claimError } = await supabase
                    .from("emails")
                    .update({ status: "sent" })
                    .eq("id", mail.id)
                    .eq("status", "approved")
                    .select("id");
                if (claimError) {
                    console.error(`❌ processOutbound: Claim fehlgeschlagen (${mail.mail_id}):`, claimError.message);
                    continue;
                }
                if (!claimed || claimed.length === 0) {
                    console.log(`⏭️  ${mail.mail_id}: bereits von einem anderen Zyklus übernommen`);
                    continue;
                }

                const empfaenger = (mail.agent_logs as any)?.empfaenger || "";
                const forwardTarget = (mail.agent_logs as any)?.forward_target || "";

                // Geplante 3RPMS-Mutation ausführen
                const actionData = (mail.agent_logs as any)?.actionData;
                if (actionData?.graphql_mutation && actionData.graphql_mutation !== "none") {
                    const hotel = identifyHotel(
                        empfaenger,
                        forwardTarget,
                        (mail.agent_logs as any)?.target_hotel || null
                    );
                    if (hotel?.key) {
                        try {
                            const variables = typeof actionData.graphql_variables === "string"
                                ? JSON.parse(actionData.graphql_variables)
                                : (actionData.graphql_variables || {});
                            await query3RPMS(hotel.key, actionData.graphql_mutation, variables);
                            console.log(`✅ 3RPMS Mutation ausgeführt: ${mail.mail_id} (${actionData.api_action})`);
                        } catch (mutErr: any) {
                            // Mutation fehlgeschlagen – E-Mail trotzdem senden (Mensch hat genehmigt)
                            console.error(`⚠️  Mutation Fehler (${mail.mail_id}): ${mutErr.message} — E-Mail wird trotzdem gesendet`);
                        }
                    }
                }

                // E-Mail senden
                const hotelId = identifyHotel(
                    empfaenger,
                    forwardTarget,
                    (mail.agent_logs as any)?.target_hotel || null
                )?.id ?? null;
                const signature = await getSignature(supabase, hotelId);
                const bodyWithSignature = `${(mail as any).draft_reply}${signature}`;

                await transporter.sendMail({
                    from: `"Petulia AI Agent" <${process.env.IMAP_USER}>`,
                    to: recipientEmail,
                    subject: `Re: ${(mail as any).betreff}`,
                    text: bodyWithSignature,
                });

                console.log(`✅ Outbound gesendet: ${mail.mail_id}`);
            } catch (err: any) {
                console.error(`❌ Sende-Fehler (${mail.mail_id}) — auf "approved" zurückgesetzt für Retry:`, err.message);
                // War bereits als "sent" beansprucht, das Senden ist aber gescheitert —
                // zurücksetzen, damit der nächste Zyklus es erneut versucht.
                await supabase.from("emails").update({ status: "approved" }).eq("id", mail.id).eq("status", "sent");
            }
        }
    } catch (err: any) {
        console.error("❌ processOutbound: unerwarteter Fehler:", err?.message || err);
    }
}

// ─── Watcher: Mails mit Status 'queued' abholen ──────────────────────────────
// Läuft für automatisch getriggerte Mails (Sofort-Pipeline bei Eingang) genauso
// wie für Dashboard-Klicks (Neu prüfen / Trotzdem bearbeiten / Hotel ändern) —
// beide setzen status="queued", dieser Poller ist außerdem das Sicherheitsnetz
// falls ein PM2-Neustart eine laufende Pipeline mitten im Lauf abbricht.

async function watchNewMails() {
    try {
        // Nur die tatsächlich benötigten Spalten — body_html wird hier nie verwendet und
        // war bei diesem alle 1,5s laufenden Poller ein unnötig großer Egress-Treiber.
        const { data: newMails, error } = await supabase
            .from("emails")
            .select("mail_id, betreff, body_text, thread_id, agent_logs, senders!inner(email, name)")
            .eq("status", "queued")
            .limit(5);

        if (error) {
            console.error("❌ watchNewMails Fehler:", error.message);
            return;
        }
        if (!newMails || newMails.length === 0) return;

        for (const mail of newMails) {
            console.log(`🔄 Watcher: Pipeline-Trigger für ${mail.mail_id}`);
            const mailData = {
                mail_id: mail.mail_id,
                betreff: mail.betreff,
                body_text: mail.body_text,
                absender: (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email || "system",
                empfaenger: (mail.agent_logs as any)?.empfaenger || "",
                forward_target: (mail.agent_logs as any)?.forward_target || "",
                force_process: !!(mail.agent_logs as any)?.force_process,
                queued_at: (mail.agent_logs as any)?.queued_at || null,
                ai_force_hotel: (mail.agent_logs as any)?.ai_force_hotel || null,
            };
            await runAiPipeline(mailData, mail.thread_id);
        }
    } catch (err: any) {
        console.error("❌ watchNewMails: unerwarteter Fehler:", err?.message || err);
    }
}

// ─── Fallback: Supabase nicht erreichbar (z.B. Egress-Kontingent überschritten) ──
// Ohne DB kann weder ein KI-Entwurf gespeichert noch von der Rezeptionistin freigegeben
// werden. Statt die Mail stillschweigend zu verlieren, schickt der Bot in diesem Fall
// eine einfache statische Eingangsbestätigung — kein KI-Entwurf, keine PMS-Daten, nichts,
// was inhaltlich falsch sein könnte. Sobald process_incoming_email wieder funktioniert,
// läuft automatisch wieder die normale Pipeline — kein Code-Revert nötig.
async function sendFallbackAcknowledgement(mailData: any) {
    const hotel = identifyHotel(mailData.empfaenger, mailData.forward_target, null);
    const hotelName = hotel?.name || "Petul Hotels";

    // Grobe Spam/Portal/System-Filterung per KI (kein DB-Zugriff nötig) — verhindert, dass
    // Newsletter/Systembenachrichtigungen automatisch eine "Danke für Ihre Anfrage" bekommen.
    try {
        const intentData = await processIntent(
            { ...mailData, body_text: (mailData.body_text || "").slice(0, 3000) },
            "Keine Historie vorhanden."
        );
        const IGNORE_CATEGORIES = ["Spam/Irrelevant", "Portal-Benachrichtigung", "System-Benachrichtigung"];
        if (IGNORE_CATEGORIES.includes(intentData.kategorie)) {
            console.log(`   ⏭️  Fallback: ${intentData.kategorie} — keine automatische Antwort`);
            return;
        }
    } catch (err: any) {
        console.warn(`   ⚠️  Fallback: Intent-Check fehlgeschlagen (${err.message}) — sende Vorlage trotzdem`);
    }

    const body = `Vielen Dank für Ihre Nachricht an ${hotelName}.

Wir haben Ihre E-Mail erhalten und melden uns so schnell wie möglich persönlich bei Ihnen zurück.

---

Thank you for your message to ${hotelName}.

We have received your e-mail and will personally get back to you as soon as possible.

Mit freundlichen Grüßen / Best regards
Ihr Team von ${hotelName}`;

    try {
        await transporter.sendMail({
            from: `"${hotelName}" <${process.env.IMAP_USER}>`,
            to: mailData.absender,
            subject: `Re: ${mailData.betreff}`,
            text: body,
        });
        console.log(`   ✉️  Fallback-Vorlage gesendet an ${mailData.absender}`);
    } catch (err: any) {
        console.error(`   ❌ Fallback-Mail fehlgeschlagen (${mailData.mail_id}):`, err.message);
    }
}

// ─── IMAP Listener ────────────────────────────────────────────────────────────

async function startListener() {
    const client = new ImapFlow({
        host: imapHost!,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        auth: { user: imapUser!, pass: imapPassword! },
        logger: false,
    });

    console.log("📨 Petul: Verbinde zum Mailserver...");
    await client.connect();

    const mailbox = await client.getMailboxLock("INBOX");

    try {
        console.log("✅ Petul: Verbunden & IDLE aktiv. Warte auf Mails...");

        client.on("exists", async (data) => {
            console.log(`\n✨ Neue Mail im Postfach erkannt (Index: ${data.count})`);

            const messages = await client.fetch(data.count.toString(), {
                envelope: true,
                source: true,
                flags: true,
            });

            for await (const msg of messages) {
                if (msg.flags && msg.flags.has("\\\\Seen")) continue;

                const parsed = await simpleParser(msg.source as Buffer);
                const p = parsed as any;
                let mail_id = getMessageId(p);
                if (!mail_id) mail_id = `fallback_${Date.now()}`;

                const rawHeaders = p.headers || new Map();
                const absender = extractEmails(p.from)[0] || "";
                const to_list = extractEmails(p.to);
                const forwardHeader = (
                    rawHeaders.get("x-forwarded-to") ||
                    rawHeaders.get("delivered-to") ||
                    rawHeaders.get("x-original-to") ||
                    ""
                );
                const forwardTarget = typeof forwardHeader === "string"
                    ? forwardHeader
                    : (Array.isArray(forwardHeader) ? forwardHeader[0] : "");

                const mailData = {
                    mail_id,
                    betreff: p.subject || "",
                    body_text: p.text || "",
                    body_html: p.html || p.textAsHtml || "",
                    absender,
                    empfaenger: to_list.join(", "),
                    forward_target: forwardTarget,
                    received_at: p.date?.toISOString() || new Date().toISOString(),
                    in_reply_to: cleanId(p.inReplyTo),
                    has_attachments: Array.isArray(p.attachments) && p.attachments.length > 0,
                };

                const { data: dbResult, error: dbError } = await supabase.rpc("process_incoming_email", {
                    p_mail_id: mailData.mail_id,
                    p_betreff: mailData.betreff,
                    p_body_text: mailData.body_text,
                    p_body_html: mailData.body_html || "",
                    p_absender: mailData.absender,
                    p_received_at: mailData.received_at,
                    p_in_reply_to: mailData.in_reply_to,
                    p_reference_last: null,
                    p_has_attachments: mailData.has_attachments,
                    p_attachment_count: Array.isArray(p.attachments) ? p.attachments.length : 0,
                });

                if (dbError) {
                    console.error("❌ RPC Fehler:", dbError.message);
                    await sendFallbackAcknowledgement(mailData);
                    await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
                    continue;
                }

                if (dbResult?.status === "success") {
                    // Thread-ID aus DB lesen (wird vom RPC gesetzt)
                    const { data: storedMail } = await supabase
                        .from("emails")
                        .select("thread_id")
                        .eq("mail_id", mailData.mail_id)
                        .maybeSingle();

                    const queuedAt = new Date().toISOString();

                    // Sofort in Pipeline — kein Dashboard-Klick nötig
                    await supabase.from("emails").update({
                        status: "queued",
                        agent_logs: {
                            empfaenger: mailData.empfaenger,
                            forward_target: mailData.forward_target,
                            queued_at: queuedAt,
                        },
                    }).eq("mail_id", mailData.mail_id);

                    console.log(`   ✅ Mail gespeichert — Pipeline startet sofort`);

                    runAiPipeline({
                        mail_id: mailData.mail_id,
                        betreff: mailData.betreff,
                        body_text: mailData.body_text,
                        absender: mailData.absender,
                        empfaenger: mailData.empfaenger,
                        forward_target: mailData.forward_target,
                        force_process: false,
                        queued_at: queuedAt,
                    }, storedMail?.thread_id || null).catch(console.error);
                }

                await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
            }
        });
    } catch (err) {
        console.error("❌ Fataler Fehler:", err);
    } finally {
        mailbox.release();
    }

    client.on("close", () => {
        console.log("⚠️  Verbindung verloren. Reconnect in 10 Sekunden...");
        setTimeout(startListener, 10000);
    });
}

// ─── Archivierung: verhindert erneuten Rückstau ──────────────────────────────
// Mails, die > 30 Tage in new/processing/failed hängen (nie ausgewählt, nie
// freigegeben, nie erneut versucht), werden automatisch archiviert. Nichts wird
// gelöscht — nur aus der aktiven Dashboard-Ansicht entfernt. Verhindert, dass sich
// der historische Rückstau (2158 Mails, teils 4,5 Monate alt) wieder aufbaut.

const ARCHIVE_AFTER_DAYS = 30;

async function archiveStaleMails() {
    const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 24 * 3600 * 1000).toISOString();

    // Erst Kandidaten laden (nur nach received_at gefiltert) statt direkt per UPDATE zu
    // filtern — sonst würde eine Mail archiviert, die zwar vor > 30 Tagen EINTRAF, aber
    // gerade erst (z.B. "Trotzdem bearbeiten") erneut angestoßen wurde und einen frischen,
    // noch unbestätigten Entwurf hat. agent_logs.queued_at ist das verlässlichere "zuletzt
    // angefasst"-Signal, received_at bleibt sonst für immer der Eingangszeitpunkt.
    const { data: candidates, error } = await supabase
        .from("emails")
        .select("id, agent_logs")
        .in("status", ["new", "processing", "failed"])
        .lt("received_at", cutoff);

    if (error) {
        console.error("❌ archiveStaleMails Fehler:", error.message);
        return;
    }
    if (!candidates || candidates.length === 0) return;

    const staleIds = candidates
        .filter((row: any) => {
            const queuedAt = row.agent_logs?.queued_at;
            return !queuedAt || queuedAt < cutoff;
        })
        .map((row: any) => row.id);

    if (staleIds.length === 0) return;

    const { error: updateError } = await supabase
        .from("emails")
        .update({ status: "archived" })
        .in("id", staleIds);

    if (updateError) {
        console.error("❌ archiveStaleMails Update-Fehler:", updateError.message);
        return;
    }
    console.log(`🗄️  ${staleIds.length} Mail(s) älter als ${ARCHIVE_AFTER_DAYS} Tage archiviert (nie bearbeitet/freigegeben).`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled:", reason));

warmProductCache().then(() => {
    setInterval(processOutbound, 10000);
    // watchNewMails ist nur noch Sicherheitsnetz (neue Mails triggern die Pipeline direkt im
    // IMAP-Handler) — 1,5s war unnötig aggressiv und hat spürbar zum Supabase-Egress-Verbrauch
    // beigetragen. 5s ist als Wartezeit nach einem Dashboard-Klick immer noch unauffällig kurz.
    setInterval(watchNewMails, 5000);
    setInterval(archiveStaleMails, 6 * 3600 * 1000); // alle 6h
    archiveStaleMails().catch(console.error);
    startListener().catch(console.error);
});
