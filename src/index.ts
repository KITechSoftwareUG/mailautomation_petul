/**
 * PETUL – Standalone Node.js Mail Automation
 * 
 * Dieses Script hält eine dauerhafte Verbindung zum Mail-Server (IMAP IDLE).
 * Sobald eine Mail ankommt, wird sie:
 * 1. Geparst und normalisiert
 * 2. In Supabase gespeichert/dedupliziert (RPC process_incoming_email)
 * 3. Die Historie aus Supabase geladen
 * 4. Der Petul OpenAI Agent für eine Antwortentscheidung aufgerufen
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { processIntent } from "./agents/01_intentAgent";
import { checkPolicy } from "./agents/02_policyAgent";
import { determineAction } from "./agents/03_actionAgent";
import { getReservationByCode, getRoomStays, getApiKeyForHotel, resolveHotelName, query3RPMS } from "./utils/threerpms";

dotenv.config();

// -- helpers: Normalization --

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

function extractThreadInfo(parsed: any): { in_reply_to: string | null; reference_last: string | null } {
    let inReplyTo =
        parsed.inReplyTo ||
        parsed.headers?.get?.("in-reply-to") ||
        parsed.headers?.get?.("In-Reply-To") ||
        null;

    inReplyTo = cleanId(inReplyTo);

    let references =
        parsed.references ||
        parsed.headers?.get?.("references") ||
        parsed.headers?.get?.("References") ||
        null;

    let referenceLast = null;

    if (Array.isArray(references)) {
        referenceLast = cleanId(references[references.length - 1]);
    } else if (typeof references === "string") {
        const refArray = references.split(" ").map((r: string) => r.trim()).filter(Boolean);
        referenceLast = cleanId(refArray[refArray.length - 1]);
    }

    return { in_reply_to: inReplyTo, reference_last: referenceLast };
}

// -- AI Setup --
// AI agents are now imported from src/agents/

// -- main --

async function startListener() {
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

    const client = new ImapFlow({
        host: imapHost,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        auth: { user: imapUser, pass: imapPassword },
        logger: false
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
                flags: true
            });

            for await (const msg of messages) {
                if (msg.flags && msg.flags.has("\\\\Seen")) continue; // Already processed

                // 1. Normalise
                const parsed = await simpleParser(msg.source as Buffer);
                const p = parsed as any;

                let mail_id = getMessageId(p);
                if (!mail_id) {
                    mail_id = `fallback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }

                const rawHeaders = p.headers || new Map();
                // DEBUG: Alle Header ausgeben um Weiterleitungs-Adressen zu finden
                console.log(`✉️  HEADERS für Mail ${mail_id}:`, JSON.stringify(Object.fromEntries(rawHeaders)));

                const absender = extractEmails(p.from)[0] || "";
                const to_list = extractEmails(p.to);
                const cc_list = extractEmails(p.cc);

                // -- NEU: Header für Weiterleitungen prüfen --
                // Manche Mailserver setzen X-Forwarded-To, Delivered-To oder X-Original-To
                const forwardHeader = (rawHeaders.get('x-forwarded-to') || rawHeaders.get('delivered-to') || rawHeaders.get('x-original-to') || "");
                const forwardTarget = typeof forwardHeader === 'string' ? forwardHeader : (Array.isArray(forwardHeader) ? forwardHeader[0] : "");

                let isoDate = null;
                if (p.date) {
                    try { isoDate = new Date(p.date).toISOString(); } catch { isoDate = null; }
                }

                const threadInfo = extractThreadInfo(p);

                const mailData = {
                    mail_id,
                    betreff: p.subject || "",
                    body_text: p.text || "",
                    body_html: p.textAsHtml ?? (p.html || ""),
                    absender: absender,
                    empfaenger: to_list.join(", "),
                    forward_target: forwardTarget, // Speichere das Ziel der Weiterleitung
                    cc_empfaenger: cc_list.join(", "),
                    received_at: isoDate || new Date().toISOString(),
                    in_reply_to: threadInfo.in_reply_to,
                    reference_last: threadInfo.reference_last,
                    has_attachments: Array.isArray(p.attachments) && p.attachments.length > 0,
                    attachment_count: Array.isArray(p.attachments) ? p.attachments.length : 0
                };

                console.log(`➡️  Verarbeite Mail: "${mailData.betreff}" von ${mailData.absender}`);

                // 2. Supabase RPC (Deduplication & Storage)
                const { data: dbResult, error: dbError } = await supabase.rpc("process_incoming_email", {
                    p_mail_id: mailData.mail_id,
                    p_betreff: mailData.betreff,
                    p_body_text: mailData.body_text,
                    p_body_html: mailData.body_html,
                    p_absender: mailData.absender,
                    p_received_at: mailData.received_at,
                    p_in_reply_to: mailData.in_reply_to,
                    p_reference_last: mailData.reference_last,
                    p_has_attachments: mailData.has_attachments,
                    p_attachment_count: mailData.attachment_count,
                });

                if (dbError) {
                    console.error(`❌ DB - Fehler für ${mailData.mail_id}: ${dbError.message}`);
                    continue;
                }

                // Debug: show what the RPC returned
                console.log(`🔍 RPC Ergebnis:`, JSON.stringify(dbResult));

                if (dbResult?.status !== "success") {
                    console.log(`⏭️  Ignoriert (Duplikat). Grund: ${dbResult?.status}`);
                    await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
                    continue;
                }

                // 3. Thread History laden
                let historyText = "Keine Historie vorhanden.";
                if (dbResult.thread_id) {
                    const { data: historyRows } = await supabase
                        .from("emails")
                        .select("body_text, received_at, senders!inner(email)")
                        .eq("thread_id", dbResult.thread_id)
                        .order("received_at", { ascending: false })
                        .limit(3);

                    if (historyRows && historyRows.length > 1) {
                        historyText = historyRows
                            .map((r: any) => `[${new Date(r.received_at).toLocaleString()}] Von: ${r.senders.email}\n${r.body_text}`)
                            .join("\n\n---\n\n");
                    }
                }

                // 4. OpenAI Multi-Agenten Pipeline
                console.log(`🤖 KI Pipeline startet...`);

                try {
                    // -- Agent 1: Intent
                    console.log("   - [Step 1] Intent Agent arbeitet...");
                    const intentData = await processIntent(mailData, historyText);
                    console.log(`   → Intent: ${intentData.kategorie}`);

                    // Agent 1: Spam check (Intent-Level)
                    if (intentData.kategorie === "Spam/Irrelevant") {
                        console.log("🗑️  Intent-Kategorie Spam/Irrelevant – wird als ignored markiert.");
                        await supabase.from("emails").update({
                            status: "ignored",
                            intent: intentData.kategorie,
                        }).eq("mail_id", mailData.mail_id);
                        await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
                        continue;
                    }

                    // -- 3RPMS Data Fetching & Hotel Identification --
                    let threeRpmsData = null;
                    const hotelApiKey = getApiKeyForHotel(mailData.empfaenger, mailData.forward_target, intentData.extracted_entities.hotel_identifiziert);
                    const resolvedHotel = resolveHotelName(mailData.empfaenger, mailData.forward_target, intentData.extracted_entities.hotel_identifiziert);

                    const resNum = intentData.extracted_entities.reservierungsnummer;

                    if (resNum && hotelApiKey) {
                        try {
                            console.log(`   - [3RPMS] Suche Reservierung: ${resNum}`);
                            const res = await getReservationByCode(hotelApiKey, resNum);
                            threeRpmsData = res?.reservations?.edges?.[0]?.node || null;
                        } catch (err) {
                            console.error("   - [3RPMS] Fehler beim Abruf:", (err as any).message);
                        }
                    }

                    // -- Agent 2: Policy Check
                    console.log("   - [Step 2] Policy Agent prüft Richtlinien...");
                    const policyData = await checkPolicy(intentData, mailData.body_text, threeRpmsData);

                    // Nur echtes SPAM / Junk verwerfen. Reguläre (auch abgelehnte) Anfragen sollen beantwortet werden.
                    if (policyData.is_spam) {
                        console.log("🗑️  Echter SPAM erkannt – wird als ignored markiert.");
                        await supabase.from("emails").update({
                            status: "ignored",
                            intent: intentData.kategorie,
                            policy_decision_reason: "SPAM erkannt"
                        }).eq("mail_id", mailData.mail_id);
                        await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
                        continue;
                    }

                    // -- Agent 3: Action & Response (WITH LOOP)
                    console.log("   - [Step 3] Action Agent entscheidet API & formuliert Antwort...");

                    let finalActionData = null;
                    let lastApiError = null;
                    let attempts = 0;
                    const loopLogs = [];
                    const maxAttempts = 3;

                    while (attempts < maxAttempts) {
                        attempts++;
                        console.log(`     -> Versuch ${attempts} ...`);
                        const currentActionData = await determineAction(intentData, policyData, mailData, threeRpmsData, lastApiError);

                        let executionResult = null;
                        let loopSuccess = true;

                        if (currentActionData.graphql_mutation && currentActionData.graphql_mutation !== "none") {
                            try {
                                console.log(`       [GraphQL] Führe aus: ${currentActionData.api_action}`);
                                executionResult = await query3RPMS(hotelApiKey, currentActionData.graphql_mutation,
                                    typeof currentActionData.graphql_variables === 'string'
                                        ? JSON.parse(currentActionData.graphql_variables)
                                        : currentActionData.graphql_variables
                                );
                                console.log(`       ✅ Erfolgreich ausgeführt.`);
                            } catch (err: any) {
                                console.log(`       ❌ API FEHLER: ${err.message}`);
                                lastApiError = err.message;
                                loopSuccess = false;
                            }
                        }

                        loopLogs.push({
                            attempt: attempts,
                            thought: currentActionData.reflexion_loop_gedanken,
                            action: currentActionData.api_action,
                            mutation: currentActionData.graphql_mutation,
                            variables: currentActionData.graphql_variables,
                            success: loopSuccess,
                            error: lastApiError,
                            result: executionResult
                        });

                        finalActionData = currentActionData;

                        if (loopSuccess) break; // Exit loop if successful or no action needed
                        if (attempts >= maxAttempts) {
                            console.log(`     ⚠️ Maximale Versuche (${maxAttempts}) erreicht. Breche ab.`);
                        }
                    }

                    console.log("✅ Pipeline abgeschlossen! Ergebnisse:");
                    console.log("- Hotel:", resolvedHotel);
                    console.log("- Intent:", intentData.kategorie);
                    console.log("- Policy:", policyData.policy_passed ? "Erlaubt" : "Eingeschränkt", "|", policyData.policy_decision_reason);
                    console.log("- API Action:", finalActionData?.api_action);
                    console.log("- Entwurf:", finalActionData?.antwort_entwurf?.slice(0, 80) + "...");

                    // DB Update – use mail_id as the reliable key (not RPC-returned id)
                    const { error: updateError } = await supabase.from("emails").update({
                        status: "processing",
                        intent: intentData.kategorie,
                        policy_decision_allowed: policyData.policy_passed,
                        policy_decision_reason: policyData.policy_decision_reason,
                        api_action: finalActionData?.api_action,
                        draft_reply: finalActionData?.antwort_entwurf,
                        agent_logs: {
                            intentData,
                            policyData,
                            actionData: finalActionData,
                            loop_history: loopLogs,
                            threeRpmsData,
                            target_hotel: resolvedHotel
                        } as any
                    }).eq("mail_id", mailData.mail_id);

                    if (updateError) {
                        console.error("❌ DB Update Fehler:", updateError.message);
                    } else {
                        console.log(`✅ DB Update erfolgreich für mail_id: ${mailData.mail_id}`);
                    }

                } catch (aiError) {
                    console.error("❌ Fehler in der KI-Pipeline:", aiError);
                    await supabase.from("emails").update({ status: "failed" }).eq("thread_id", dbResult?.thread_id);
                }

                // 5. Mark Mail as Processed
                await client.messageFlagsAdd(msg.seq, ["\\Seen"]);
                console.log(`📥 Abgeschlossen und als gelesen markiert.`);
            }
        });

    } catch (err) {
        console.error("❌ Fataler Fehler:", err);
    } finally {
        mailbox.release();
    }

    client.on("close", () => {
        console.log("⚠️ Verbindung verloren. Reconnect in 10 Sekunden...");
        setTimeout(startListener, 10000);
    });
}

// Global Exception Handlers so the daemon doesn't easily die entirely
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startListener().catch(console.error);
