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

async function runAiPipeline(mailData: any, threadId: string | null) {
    if (pipelineInProgress.has(mailData.mail_id)) {
        console.log(`⏭️  Pipeline läuft bereits für ${mailData.mail_id} – überspringe`);
        return;
    }
    pipelineInProgress.add(mailData.mail_id);
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
            await supabase.from("emails").update({
                status: "ignored",
                intent: intentData.kategorie,
            }).eq("mail_id", mailData.mail_id);
            console.log("🗑️  Spam/Irrelevant – als ignored markiert.");
            return;
        }

        // 3. Hotel identifizieren
        const hotel = identifyHotel(
            mailData.empfaenger,
            mailData.forward_target,
            intentData.extracted_entities.hotel_identifiziert
        );
        const hotelApiKey = hotel?.key || "";
        const resolvedHotel = hotel?.name || "Unbekannt / Petul";
        const hotelSource = hotel
            ? (mailData.forward_target && hotel.email && mailData.forward_target.toLowerCase().includes(hotel.email) ? "email-header" : "ai-oder-keyword")
            : "unbekannt";
        console.log(`   → Hotel: ${resolvedHotel} (Quelle: ${hotelSource})`);

        // 4. Policy + 3RPMS-Lookup parallel — spart ~3-5s
        console.log("   - [Step 2] Policy + PMS-Lookup parallel...");
        const resNum = intentData.extracted_entities?.reservierungsnummer;
        const ankunft = intentData.extracted_entities?.ankunft;
        const abreise = intentData.extracted_entities?.abreise;

        const [policyData, prefetchedPmsData, prefetchedInventory] = await Promise.all([
            checkPolicy(intentData, mailData.body_text),

            // 3RPMS: per Code oder per E-Mail
            (async () => {
                if (!hotelApiKey) return null;
                if (resNum) {
                    try {
                        const res = await getReservationByCode(hotelApiKey, resNum);
                        const node = res?.reservations?.edges?.[0]?.node;
                        if (node) { console.log(`   ✅ Reservierung per Code gefunden: ${node.code}`); return node; }
                    } catch (err: any) {
                        console.warn(`   ⚠️  [3RPMS] Code-Suche: ${err.message}`);
                    }
                }
                if (mailData.absender) {
                    try {
                        const result = await searchReservationsByEmail(hotelApiKey, mailData.absender);
                        if (result) { console.log(`   ✅ Gast per E-Mail gefunden`); return result; }
                    } catch (err: any) {
                        console.warn(`   ⚠️  [3RPMS] E-Mail-Suche: ${err.message}`);
                    }
                }
                return null;
            })(),

            // 3RPMS: Verfügbarkeit (nur bei Reservierungsanfrage mit Daten)
            (async () => {
                if (!hotelApiKey || intentData.kategorie !== "Reservierungsanfrage") return null;
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

        if (policyData.is_spam) {
            await supabase.from("emails").update({
                status: "ignored",
                intent: intentData.kategorie,
                policy_decision_reason: "SPAM erkannt",
            }).eq("mail_id", mailData.mail_id);
            console.log("🗑️  Echter SPAM erkannt – als ignored markiert.");
            return;
        }

        // 5. Action Agent — PMS-Daten bereits vorhanden, kein extra Lookup-Step nötig
        console.log("   - [Step 3] Action Agent formuliert Antwort...");
        const productCatalog = hotel ? (hotelProductsCache[hotel?.id ?? ""] ?? null) : null;
        const finalActionData = await determineAction(
            intentData,
            policyData,
            mailData,
            hotelApiKey,
            productCatalog,
            null,
            prefetchedPmsData,
            prefetchedInventory,
        );
        console.log(`   → Geplante Aktion: ${finalActionData.api_action}`);
        if (finalActionData.tool_calls_made?.length > 0) {
            console.log(`   → Tools aufgerufen: ${finalActionData.tool_calls_made.join(", ")}`);
        }

        const hasApiErrors = finalActionData.pipeline_errors?.length > 0;
        if (hasApiErrors) {
            console.warn(`   ⚠️  Schnittstellenfehler — kein Entwurf: ${finalActionData.pipeline_errors.join("; ")}`);
        }

        // 6. DB Update — bei API-Fehlern: kein Entwurf, Status "failed"
        const { error: updateError } = await supabase.from("emails").update({
            status: hasApiErrors ? "failed" : "processing",
            intent: intentData.kategorie,
            policy_decision_allowed: policyData.policy_passed,
            policy_decision_reason: policyData.policy_decision_reason,
            api_action: hasApiErrors ? null : finalActionData.api_action,
            draft_reply: hasApiErrors ? null : finalActionData.antwort_entwurf,
            agent_logs: {
                intentData,
                policyData,
                actionData: hasApiErrors ? null : finalActionData,
                threeRpmsData: finalActionData.threeRpmsData,
                inventoryData: finalActionData.inventoryData,
                pipeline_errors: finalActionData.pipeline_errors?.length ? finalActionData.pipeline_errors : undefined,
                target_hotel: resolvedHotel,
                hotel_source: hotelSource,
                forward_target: mailData.forward_target || null,
                empfaenger: mailData.empfaenger || null,
            } as any,
        }).eq("mail_id", mailData.mail_id);

        if (updateError) throw updateError;
        console.log(`✅ Pipeline abgeschlossen – wartet auf Freigabe im Dashboard`);

    } catch (err: any) {
        console.error(`❌ Pipeline Fehler (${mailData.mail_id}):`, err.message);
        await supabase.from("emails").update({ status: "failed" }).eq("mail_id", mailData.mail_id);
    } finally {
        pipelineInProgress.delete(mailData.mail_id);
    }
}

// ─── Recovery ─────────────────────────────────────────────────────────────────

async function recoverPendingMails() {
    console.log("🔍 Recovery: Suche nach nicht verarbeiteten Mails (Status 'new', letzte 48h)...");
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const { data: pending, error } = await supabase
        .from("emails")
        .select("*")
        .eq("status", "new")
        .gte("received_at", fortyEightHoursAgo)
        .order("received_at", { ascending: false })
        .limit(20);

    if (error) {
        console.error("❌ Recovery Fehler:", error.message);
        return;
    }

    if (pending && pending.length > 0) {
        console.log(`✨ ${pending.length} Mails werden nachverarbeitet...`);
        for (const raw of pending) {
            const mailData = {
                mail_id: raw.mail_id,
                betreff: raw.betreff,
                body_text: raw.body_text,
                absender: "system-recovery",
                empfaenger: (raw.agent_logs as any)?.empfaenger || "",
                forward_target: (raw.agent_logs as any)?.forward_target || "",
            };
            await runAiPipeline(mailData, raw.thread_id);
        }
    }
}

// ─── Outbound: Mutation ausführen + E-Mail senden (nach menschlicher Freigabe) ─

async function processOutbound() {
    try {
        const { data: approvedMails, error } = await supabase
            .from("emails")
            .select("id, mail_id, betreff, draft_reply, empfaenger, forward_target, agent_logs, senders!inner(email)")
            .eq("status", "approved");

        if (error || !approvedMails || approvedMails.length === 0) return;

        for (const mail of approvedMails) {
            try {
                const recipientEmail = (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email;
                if (!recipientEmail) continue;

                // Geplante 3RPMS-Mutation ausführen
                const actionData = (mail.agent_logs as any)?.actionData;
                if (actionData?.graphql_mutation && actionData.graphql_mutation !== "none") {
                    const hotel = identifyHotel(
                        (mail as any).empfaenger || "",
                        (mail as any).forward_target || "",
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
                    (mail as any).empfaenger || "",
                    (mail as any).forward_target || "",
                    (mail.agent_logs as any)?.target_hotel || null
                )?.id ?? null;
                const signature = getSignature(hotelId);
                const bodyWithSignature = `${(mail as any).draft_reply}${signature}`;

                await transporter.sendMail({
                    from: `"Petulia AI Agent" <${process.env.IMAP_USER}>`,
                    to: recipientEmail,
                    subject: `Re: ${(mail as any).betreff}`,
                    text: bodyWithSignature,
                });

                await supabase.from("emails").update({ status: "sent" }).eq("id", mail.id);
                console.log(`✅ Outbound gesendet: ${mail.mail_id}`);
            } catch (err: any) {
                console.error("❌ Sende-Fehler:", err.message);
            }
        }
    } catch (_) {}
}

// ─── Watcher: Vom Dashboard angestoßene Analysen (Status 'queued') ───────────
// Mails werden erst verarbeitet wenn die Rezeptionistin sie im Dashboard anklickt.

async function watchNewMails() {
    try {
        const { data: newMails, error } = await supabase
            .from("emails")
            .select("*, senders!inner(email, name)")
            .eq("status", "queued")
            .limit(5);

        if (error || !newMails || newMails.length === 0) return;

        for (const mail of newMails) {
            console.log(`🔄 Watcher: Manuell getriggerte Analyse für ${mail.mail_id}`);
            const mailData = {
                mail_id: mail.mail_id,
                betreff: mail.betreff,
                body_text: mail.body_text,
                absender: (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email || "system",
                empfaenger: (mail.agent_logs as any)?.empfaenger || "",
                forward_target: (mail.agent_logs as any)?.forward_target || "",
            };
            await runAiPipeline(mailData, mail.thread_id);
        }
    } catch (_) {}
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
                    continue;
                }

                if (dbResult?.status === "success") {
                    console.log(`   ✅ Mail gespeichert — wartet auf Klick im Dashboard`);
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

// ─── Start ────────────────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => console.error("Uncaught:", err));
process.on("unhandledRejection", (reason) => console.error("Unhandled:", reason));

warmProductCache().then(() => {
    setInterval(processOutbound, 10000);
    setInterval(watchNewMails, 5000);
    startListener().catch(console.error);
});
