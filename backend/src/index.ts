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
import nodemailer from "nodemailer";
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

/**
 * Kern-Logik für die Verarbeitung einer Mail via AI Pipeline
 */
async function runAiPipeline(mailData: any, threadId: string | null) {
    console.log(`🤖 KI Pipeline startet für mail_id: ${mailData.mail_id}`);
    
    try {
        // 1. Thread History laden
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
                    .map((r: any) => `[${new Date(r.received_at).toLocaleString()}] Von: ${r.senders.email}\n${r.body_text}`)
                    .join("\n\n---\n\n");
            }
        }

        // 2. Agent 1: Intent
        console.log("   - [Step 1] Intent Agent arbeitet...");
        const intentData = await processIntent(mailData, historyText);
        console.log(`   → Intent: ${intentData.kategorie}`);

        if (intentData.kategorie === "Spam/Irrelevant") {
            console.log("🗑️  Intent-Kategorie Spam/Irrelevant – wird als ignored markiert.");
            await supabase.from("emails").update({
                status: "ignored",
                intent: intentData.kategorie,
            }).eq("mail_id", mailData.mail_id);
            return;
        }

        // 3. 3RPMS Data Fetching
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

        // 4. Agent 2: Policy Check
        console.log("   - [Step 2] Policy Agent prüft Richtlinien...");
        const policyData = await checkPolicy(intentData, mailData.body_text, threeRpmsData);

        if (policyData.is_spam) {
            console.log("🗑️  Echter SPAM erkannt – wird als ignored markiert.");
            await supabase.from("emails").update({
                status: "ignored",
                intent: intentData.kategorie,
                policy_decision_reason: "SPAM erkannt"
            }).eq("mail_id", mailData.mail_id);
            return;
        }

        // 5. Agent 3: Action & Response
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
            if (loopSuccess) break;
        }

        // 6. DB Update
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

        if (updateError) throw updateError;
        console.log(`✅ Pipeline erfolgreich für ${mailData.mail_id}`);

    } catch (err: any) {
        console.error(`❌ Pipeline Fehler (${mailData.mail_id}):`, err.message);
        await supabase.from("emails").update({ status: "failed" }).eq("mail_id", mailData.mail_id);
    }
}

/**
 * Verarbeitet "hängengebliebene" Mails beim Start
 */
async function recoverPendingMails() {
    console.log("🔍 Recovery: Suche nach nicht verarbeiteten Mails (Status 'new', letzte 48h)...");
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    
    const { data: pending, error } = await supabase
        .from("emails")
        .select("*")
        .eq("status", "new")
        .gte("received_at", fortyEightHoursAgo)
        .order("received_at", { ascending: false }) // Neueste zuerst für besseres UX
        .limit(20); // Begrenzung auf die 20 aktuellsten um Überlastung zu vermeiden

    if (error) {
        console.error("❌ Recovery Fehler:", error.message);
        return;
    }

    if (pending && pending.length > 0) {
        console.log(`✨ Gefunden: ${pending.length} aktuelle Mails werden nachverarbeitet...`);
        for (const raw of pending) {
            const mailData = {
                mail_id: raw.mail_id,
                betreff: raw.betreff,
                body_text: raw.body_text,
                absender: "system-recovery", 
                empfaenger: raw.empfaenger || "",
                forward_target: raw.forward_target || ""
            };
            await runAiPipeline(mailData, raw.thread_id);
        }
    }
}

async function startListener() {
    const client = new ImapFlow({
        host: imapHost!,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        auth: { user: imapUser!, pass: imapPassword! },
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
                if (msg.flags && msg.flags.has("\\\\Seen")) continue;

                const parsed = await simpleParser(msg.source as Buffer);
                const p = parsed as any;
                let mail_id = getMessageId(p);
                if (!mail_id) mail_id = `fallback_${Date.now()}`;

                const rawHeaders = p.headers || new Map();
                const absender = extractEmails(p.from)[0] || "";
                const to_list = extractEmails(p.to);
                const forwardHeader = (rawHeaders.get('x-forwarded-to') || rawHeaders.get('delivered-to') || rawHeaders.get('x-original-to') || "");
                const forwardTarget = typeof forwardHeader === 'string' ? forwardHeader : (Array.isArray(forwardHeader) ? forwardHeader[0] : "");

                const mailData = {
                    mail_id,
                    betreff: p.subject || "",
                    body_text: p.text || "",
                    body_html: p.textAsHtml ?? (p.html || ""),
                    absender,
                    empfaenger: to_list.join(", "),
                    forward_target: forwardTarget,
                    received_at: p.date?.toISOString() || new Date().toISOString(),
                    in_reply_to: cleanId(p.inReplyTo),
                    has_attachments: Array.isArray(p.attachments) && p.attachments.length > 0
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
                    continue;
                }

                if (dbResult?.status === "success") {
                    await runAiPipeline(mailData, dbResult.thread_id);
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
        console.log("⚠️ Verbindung verloren. Reconnect in 10 Sekunden...");
        setTimeout(startListener, 10000);
    });
}

// Stats periodically
process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', reason));

const transporter = nodemailer.createTransport({
    host: process.env.IMAP_HOST,
    port: 465,
    secure: true,
    auth: { user: imapUser!, pass: imapPassword! },
});

async function processOutbound() {
    try {
        const { data: approvedMails, error } = await supabase
            .from("emails")
            .select("id, mail_id, betreff, draft_reply, senders!inner(email)")
            .eq("status", "completed");

        if (error) return;

        for (const mail of approvedMails || []) {
            try {
                const recipientEmail = (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email;
                if (!recipientEmail) continue;

                await transporter.sendMail({
                    from: `"Petulia AI Agent" <${process.env.IMAP_USER}>`,
                    to: recipientEmail,
                    subject: `Re: ${mail.betreff}`,
                    text: mail.draft_reply,
                });

                await supabase.from("emails").update({ status: "sent" }).eq("id", mail.id);
                console.log(`✅ Outbound gesendet: ${mail.mail_id}`);
            } catch (err: any) {
                console.error("❌ Sende-Fehler:", err.message);
            }
        }
    } catch (err: any) {}
}

/**
 * Watcher: Checks for emails with status 'new' (e.g. manually reset in dashboard)
 * and processes them immediately.
 */
async function watchNewMails() {
    try {
        const { data: newMails, error } = await supabase
            .from("emails")
            .select("*, senders!inner(email, name)")
            .eq("status", "new")
            .limit(5);

        if (error || !newMails || newMails.length === 0) return;

        for (const mail of newMails) {
            console.log(`🔄 Watcher: Manuell getriggerte Analyse für ${mail.mail_id}`);
            const mailData = {
                mail_id: mail.mail_id,
                betreff: mail.betreff,
                body_text: mail.body_text,
                absender: (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email || "system",
                empfaenger: mail.empfaenger || "info@petul.de",
                forward_target: mail.forward_target || ""
            };
            await runAiPipeline(mailData, mail.thread_id);
        }
    } catch (err) {}
}

// Initial Run
recoverPendingMails().then(() => {
    setInterval(processOutbound, 10000);
    setInterval(watchNewMails, 5000); // Check every 5 seconds for manual interventions
    startListener().catch(console.error);
});
