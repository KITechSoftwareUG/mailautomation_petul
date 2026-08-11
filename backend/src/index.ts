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
    findHotelByGuestEmail,
    getInventory,
    getHotelSettings,
    probeCapabilities,
} from "./utils/threerpms";
import { getSignature, hasPlaceholder } from "./utils/signatures";
import { validateMutation } from "./utils/mutationGuard";
import { setCapabilities, getCapabilities, getAnyCapabilities, fehlendeVoraussetzungen, beschreibeManuelleAufgabe, bewerteMachbarkeit } from "./utils/pmsCapabilities";

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
    // Ohne diese Grenzen blockiert ein hängender SMTP-Socket processOutbound bis zu
    // 10 Minuten (Nodemailer-Default) und damit den Versand ALLER anderen
    // freigegebenen Mails.
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
});

// ─── Hotel Product Cache (einmalig beim Start geladen) ────────────────────────

const hotelProductsCache: Record<string, any> = {};
const pipelineInProgress = new Set<string>(); // verhindert doppelte Verarbeitung

// ─── Backoff bei wiederholten Supabase-Fehlern ────────────────────────────────
// Ein anhaltender DB-Ausfall (Egress-Sperre, Wartungsfenster, kurze Aufwachphase nach
// einer Pause) sorgte bisher dafür, dass watchNewMails/processOutbound minutenlang im
// festen 5s/10s-Takt exakt dieselbe Fehlermeldung produzieren — unnötige Last und
// Log-Spam genau dann, wenn eh schon etwas nicht stimmt. Ab 3 Fehlern in Folge wird die
// Pause zwischen Versuchen exponentiell verlängert (bis max. 2 Minuten); ein einzelner
// erfolgreicher Request setzt sofort auf die normale Taktung zurück.
let consecutiveDbFailures = 0;

function nextDelay(baseMs: number): number {
    if (consecutiveDbFailures < 3) return baseMs;
    const factor = Math.min(consecutiveDbFailures - 2, 5);
    return Math.min(baseMs * Math.pow(2, factor), 120000);
}

function reportDbFailure() {
    consecutiveDbFailures++;
    if (consecutiveDbFailures === 3) {
        console.warn("⏸️  3 DB-Fehler in Folge — drossle Polling schrittweise, bis Supabase wieder antwortet.");
    }
}

function reportDbSuccess() {
    if (consecutiveDbFailures >= 3) {
        console.log("▶️  Supabase antwortet wieder — normale Polling-Taktung.");
    }
    consecutiveDbFailures = 0;
}

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

        // Welche Schreibaktionen sind für diesen Zugang überhaupt freigeschaltet?
        // Das Schema allein sagt darüber nichts — s. probeCapabilities().
        try {
            const caps = await probeCapabilities(hotel.key);
            setCapabilities(hotel.id, caps);
            const gesperrt = fehlendeVoraussetzungen(caps);
            if (gesperrt.length === 0) {
                console.log(`   🔓 ${hotel.name}: alle Schreibaktionen verfügbar`);
            } else {
                console.log(`   🔒 ${hotel.name}: ${gesperrt.length} Aktion(en) gesperrt`);
                for (const g of gesperrt) console.log(`      • ${g}`);
            }

            // Für die Anzeige im Dashboard festhalten. Die Rezeptionistin muss sehen
            // können, WARUM eine Aktion nicht automatisch lief — sonst wirkt der reale
            // Zustand der Schnittstelle wie ein Programmfehler.
            // Fehlt die Tabelle (Migration noch nicht ausgeführt), ist das kein Problem:
            // der Stand liegt zusätzlich in agent_logs jeder verarbeiteten Mail.
            const { error: capErr } = await supabase.from("pms_capabilities").upsert({
                hotel_id: hotel.id,
                hotel_name: hotel.name,
                reservierungs_api: caps.reservierungsApi,
                sales_product_id: caps.salesProductId,
                payment_method_id: caps.paymentMethodId,
                gesperrt,
                geprueft_am: caps.geprueftAm,
            }, { onConflict: "hotel_id" });
            if (capErr && !capErr.message.includes("pms_capabilities")) {
                console.warn(`   ⚠️  Fähigkeiten nicht speicherbar: ${capErr.message}`);
            }
        } catch (err: any) {
            console.warn(`   ⚠️  ${hotel.name}: Fähigkeiten nicht prüfbar (${err.message})`);
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

// Genau EINE Mail zur Zeit. Die Agenten laufen damit strikt nacheinander:
// Mail für Mail, und innerhalb einer Mail Intent → Policy → Action.
//
// pipelineInProgress dedupliziert nur dieselbe mail_id — ohne diese zusätzliche
// Grenze starteten bei 40 gleichzeitig zugestellten Mails 40 Pipelines mit je 3
// LLM-Calls parallel, liefen ins OpenAI-Rate-Limit und landeten allesamt auf
// "failed". Überzählige Mails bleiben schlicht "queued"; der Poller zieht sie
// wenige Sekunden später nach. Für den Anwendungsfall (eine Rezeptionistin,
// wenige Mails pro Stunde) ist Durchsatz ohnehin irrelevant — Nachvollziehbarkeit
// und ein ruhiges, sequentielles Log sind wertvoller.
const MAX_CONCURRENT_PIPELINES = 1;
const MAX_PIPELINE_ATTEMPTS = 3;
let activePipelines = 0;

async function runAiPipeline(mailData: any, threadId: string | null) {
    if (pipelineInProgress.has(mailData.mail_id)) {
        console.log(`⏭️  Pipeline läuft bereits für ${mailData.mail_id} – überspringe`);
        return;
    }
    if (activePipelines >= MAX_CONCURRENT_PIPELINES) {
        console.log(`⏸️  Auslastungsgrenze (${MAX_CONCURRENT_PIPELINES}) erreicht — ${mailData.mail_id} bleibt "queued", Poller holt sie nach.`);
        return;
    }
    pipelineInProgress.add(mailData.mail_id);
    activePipelines++;
    console.log(`🤖 KI Pipeline startet für mail_id: ${mailData.mail_id}`);

    // Langen E-Mail-Text kürzen — reduziert Kontext für alle 3 LLM-Calls
    const bodyText = (mailData.body_text || "").slice(0, 3000);
    const queuedAt = mailData.queued_at ?? null;

    // Basis für ALLE agent_logs-Schreibvorgänge dieser Funktion. Ohne diesen Merge
    // baute die Pipeline agent_logs jedes Mal neu auf und löschte dabei ai_force_hotel
    // und force_process — die manuelle Hotelwahl und "Trotzdem bearbeiten" überlebten
    // damit genau einen Durchlauf, danach war die Eingabe der Rezeptionistin weg.
    const baseLogs = {
        ...(mailData.agent_logs || {}),
        ai_force_hotel: mailData.ai_force_hotel || null,
        force_process: !!mailData.force_process,
        reply_to: mailData.reply_to || null,
    };

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
        let hotel = forcedHotel || identifyHotel(
            mailData.empfaenger,
            mailData.forward_target,
            intentData.extracted_entities.hotel_identifiziert
        );
        let hotelSource = forcedHotel
            ? "manuell (Dashboard)"
            : hotel
                ? (mailData.forward_target && hotel.email && mailData.forward_target.toLowerCase().includes(hotel.email) ? "email-header" : "ai-oder-keyword")
                : "unbekannt";

        // Letzter Ausweg, wenn keiner der bisherigen Wege ein Haus ergibt: Der weitaus
        // häufigste Fall ist eine Mail an die Sammeladresse info@petul.de, die kein Haus
        // nennt — weder im Header (die Weiterleitung verwirft ihn) noch im Text. Ist der
        // Absender aber in genau einem der fünf Häuser als Gast hinterlegt, ist die
        // Zuordnung damit eindeutig belegt statt geraten.
        // Die dabei gefundenen PMS-Daten werden unten weiterverwendet, statt dieselbe
        // Suche gleich noch einmal auszuführen.
        let crossHotelPms: any = null;
        if (!hotel && mailData.absender) {
            const crossHit = await findHotelByGuestEmail(mailData.absender);
            if (crossHit) {
                hotel = crossHit.hotel;
                crossHotelPms = crossHit.data;
                hotelSource = "pms-gasttreffer";
                console.log(`   ✅ Hotel über Gastdaten im 3RPMS bestimmt: ${hotel.name}`);
            }
        }

        const hotelApiKey = hotel?.key || "";
        const resolvedHotel = hotel?.name || "Unbekannt / Petul";
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

                        // Eine im Text genannte Nummer ist längst nicht immer eine
                        // 3RPMS-Reservierungsnummer: bei Booking.com und Airbnb nennt der
                        // Gast die Portalnummer, die im PMS gar nicht vorkommt (belegt an
                        // "6032653131"). Bisher endete das auf `failed`, obwohl derselbe
                        // Gast über seine Mailadresse auffindbar war. Der Treffer wird als
                        // solcher gekennzeichnet, damit Entwurf und Dashboard nicht so tun,
                        // als sei die genannte Nummer bestätigt worden.
                        const viaEmail = mailData.absender
                            ? await searchReservationsByEmail(hotelApiKey, mailData.absender).catch(() => null)
                            : null;
                        if (viaEmail) {
                            console.log(`   ✅ Nummer "${resNum}" unbekannt, Gast aber per E-Mail gefunden (${resolvedHotel})`);
                            return {
                                attempted: true,
                                data: { ...viaEmail, unresolvedReservationCode: resNum },
                            };
                        }
                        return { attempted: true, data: null };
                    } catch (err: any) {
                        console.warn(`   ⚠️  [3RPMS] Code-Suche Fehler: ${err.message}`);
                        return { attempted: true, data: null, error: err.message };
                    }
                }
                // Die hotelübergreifende Suche oben hat den Gast bereits gefunden — und
                // zwar im selben Haus, das jetzt gilt (es wurde ja gerade daraus abgeleitet).
                if (crossHotelPms) {
                    console.log(`   ✅ Gast per E-Mail gefunden (${resolvedHotel}, hausübergreifende Suche)`);
                    return { attempted: true, data: crossHotelPms };
                }

                // Kein Code → früh gestarteten E-Mail-Lookup verwenden. ABER nur, wenn er
                // gegen dasselbe Hotel lief, das jetzt tatsächlich gilt.
                //
                // Der Früh-Lookup startet aus Geschwindigkeitsgründen mit dem Hotel aus
                // dem Mail-Header, bevor die manuelle Auswahl oder die KI-Erkennung
                // ausgewertet ist. Korrigierte die Rezeptionistin auf ein anderes Haus,
                // wurde bisher trotzdem das Ergebnis des Header-Hotels übernommen: der
                // Entwurf nannte dann Zimmer, Datum und Preis eines fremden Aufenthalts
                // — im Namen des richtigen Hotels. Zweiter Fall: ergab der Header nichts,
                // fand NIE ein E-Mail-Lookup statt, obwohl über die manuelle Auswahl ein
                // gültiger API-Key vorlag.
                if (hotelEarly?.id === hotel?.id) {
                    return await earlyEmailLookup;
                }

                console.log(`   ↻ Hotel gewechselt (${hotelEarly?.name ?? "keins"} → ${resolvedHotel}) — PMS-Lookup wird neu ausgeführt.`);
                if (!mailData.absender) return { attempted: false, data: null };
                try {
                    const r = await searchReservationsByEmail(hotelApiKey, mailData.absender);
                    if (r) { console.log(`   ✅ Gast per E-Mail gefunden (${resolvedHotel})`); return { attempted: true, data: r }; }
                    return { attempted: false, data: null };
                } catch (err: any) {
                    console.warn(`   ⚠️  E-Mail-Suche Fehler: ${err.message}`);
                    return { attempted: true, data: null, error: err.message };
                }
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
                    ...baseLogs,
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

        // Mehrere Aufenthalte auf dieselbe E-Mail-Adresse: der Entwurf darf dann keine
        // konkreten Buchungsdaten behaupten, weil nicht feststeht, welche gemeint ist.
        // Das ist der Fall der Firmenbuchung (drei Zimmer auf buchung@firma.de) — sonst
        // nennt die Antwort an Herrn Klein die Buchungsdaten von Frau Groß.
        if (prefetchedPmsData?.ambiguous) {
            console.warn(`   ⚠️  Mehrdeutige PMS-Zuordnung: ${prefetchedPmsData.ambiguityReason}`);
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
            // Gemessene Fähigkeiten dieses Hauses: ohne sie schlägt der Agent Aktionen
            // vor, die für diesen Zugang gar nicht freigeschaltet sind.
            getCapabilities(hotel?.id),
        );
        console.log(`   → Geplante Aktion: ${finalActionData.api_action}`);

        // Signatur wird HIER angehängt, nicht erst beim Versand. Vorher gab die
        // Rezeptionistin draft_reply frei, gesendet wurde aber draft_reply + Signatur —
        // sie hat also nie gesehen, was tatsächlich das Haus verlässt (inklusive der
        // Platzhalter-Adressen, die produktiv in hotel_signatures standen).
        // Jetzt steht der vollständige Text im editierbaren Entwurf.
        const signature = await getSignature(supabase, hotel?.id ?? null);
        const draftWithSignature = `${finalActionData.antwort_entwurf}${signature}`;

        // 6. DB Update — determineAction wirft bei Fehlern (s. catch unten), liefert sonst immer einen Entwurf
        const wrote = await writeResultIfCurrent(mailData.mail_id, queuedAt, {
            status: "processing",
            intent: intentData.kategorie,
            policy_decision_allowed: policyData.policy_passed,
            policy_decision_reason: policyData.policy_decision_reason,
            api_action: finalActionData.api_action,
            draft_reply: draftWithSignature,
            agent_logs: {
                ...baseLogs,
                intentData,
                policyData,
                actionData: finalActionData,
                threeRpmsData: finalActionData.threeRpmsData,
                inventoryData: finalActionData.inventoryData,
                target_hotel: resolvedHotel,
                hotel_source: hotelSource,
                forward_target: mailData.forward_target || null,
                empfaenger: mailData.empfaenger || null,
                pms_ambiguous: prefetchedPmsData?.ambiguous || false,
                pms_ambiguity_reason: prefetchedPmsData?.ambiguityReason || null,
                // Was zum Zeitpunkt dieser Analyse möglich war, plus die konkrete
                // Handreichung für die Rezeptionistin. Beides wandert ins Dashboard,
                // damit sie nicht raten muss, ob sie noch etwas von Hand tun muss.
                manual_task: beschreibeManuelleAufgabe(
                    finalActionData.api_action,
                    finalActionData.graphql_mutation,
                    getCapabilities(hotel?.id),
                ),
                // Was mit dem Wunsch DIESES Gastes möglich ist. Grundlage ist die
                // erkannte Kategorie, nicht der Vorschlag des Action Agents — bei einem
                // unmöglichen Wunsch schlägt der oft gar keine Aktion vor, und dann
                // stünde für die Rezeptionistin nichts da, obwohl gerade dann Handarbeit
                // nötig ist. Wird immer gesetzt, auch bei "nichts zu tun".
                machbarkeit: bewerteMachbarkeit(
                    intentData.kategorie,
                    finalActionData.api_action,
                    finalActionData.graphql_mutation,
                    getCapabilities(hotel?.id) ?? getAnyCapabilities(),
                ),
                // Kompakter Freischaltstand (3 Booleans, ~40 Byte) — daraus speist sich die
                // Statusleiste im Dashboard. Bewusst hier und nicht in einer eigenen Tabelle:
                // für DDL fehlen die Rechte an diesem Supabase-Projekt, und so funktioniert
                // die Anzeige ohne jeden Einrichtungsschritt. Die Felder sind absichtlich
                // einbuchstabig, weil agent_logs bei jedem Dashboard-Poll mitgeladen wird.
                caps: (() => {
                    // Fallback auf irgendein gemessenes Haus: Der Freischaltstand hängt am
                    // API-Zugang, nicht am einzelnen Hotel. Ohne ihn bliebe die Statusanzeige
                    // bei jeder Mail ohne erkanntes Hotel leer.
                    const c = getCapabilities(hotel?.id) ?? getAnyCapabilities();
                    return c ? { r: c.reservierungsApi, s: !!c.salesProductId, p: !!c.paymentMethodId, t: c.geprueftAm } : null;
                })(),
                queued_at: queuedAt,
            } as any,
        });

        if (wrote) console.log(`✅ Pipeline abgeschlossen – wartet auf Freigabe im Dashboard`);

    } catch (err: any) {
        console.error(`❌ Pipeline Fehler (${mailData.mail_id}):`, err.stack || err.message || err);

        // Transiente Fehler (Netz, Timeout, Rate-Limit, 5xx) sind nicht die Schuld der
        // Mail — sie gehören zurück in die Warteschlange. Nur fachliche Fehler landen
        // auf "failed". Vorher parkte ein 20-minütiger 3RPMS-Ausfall jede in dieser Zeit
        // eintreffende Mail dauerhaft auf "failed", wo sie nie wieder jemand anfasste.
        const msg = String(err?.message || err);
        const transient = /timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|rate limit|429|50[0-9]|aborted/i.test(msg);
        const attempts = Number(mailData.pipeline_attempts || 0) + 1;

        if (transient && attempts < MAX_PIPELINE_ATTEMPTS) {
            console.warn(`   ↻ Transienter Fehler (Versuch ${attempts}/${MAX_PIPELINE_ATTEMPTS}) — Mail bleibt "queued" für erneuten Versuch.`);
            await writeResultIfCurrent(mailData.mail_id, queuedAt, {
                status: "queued",
                agent_logs: { ...baseLogs, pipeline_attempts: attempts, last_error: msg, queued_at: queuedAt } as any,
            });
            return;
        }

        await writeResultIfCurrent(mailData.mail_id, queuedAt, {
            status: "failed",
            intent: intentData?.kategorie ?? null,
            agent_logs: {
                ...baseLogs,
                intentData,
                policyData,
                pipeline_attempts: attempts,
                pipeline_errors: [`Unerwarteter Fehler: ${msg}`],
                forward_target: mailData.forward_target || null,
                empfaenger: mailData.empfaenger || null,
                queued_at: queuedAt,
            } as any,
        });
    } finally {
        pipelineInProgress.delete(mailData.mail_id);
        activePipelines--;
    }
}

// ─── Outbound: Mutation ausführen + E-Mail senden (nach menschlicher Freigabe) ─

// Löst das Zielhotel aus agent_logs auf — mit derselben Prioritätskette wie die
// Pipeline. Die manuelle Auswahl der Rezeptionistin hat absoluten Vorrang.
//
// Bisher rief der Sendepfad direkt identifyHotel(empfaenger, forwardTarget, …) auf und
// las ai_force_hotel NIE. Der in der Doku beschriebene "absolute Vorrang" der manuellen
// Auswahl galt damit ausschließlich für den Entwurfstext: Korrigierte die Rezeptionistin
// das Hotel, wurde die Mail zwar für Haus B formuliert, aber mit dem API-Key von Haus A
// ins PMS geschrieben und mit der Signatur (Anschrift, Telefonnummer) von Haus A versendet.
function resolveHotel(agentLogs: any) {
    const forced = agentLogs?.ai_force_hotel
        ? HOTELS.find(h => h.name === agentLogs.ai_force_hotel) || null
        : null;
    if (forced) return forced;
    return identifyHotel(
        agentLogs?.empfaenger || "",
        agentLogs?.forward_target || "",
        agentLogs?.target_hotel || null
    );
}

const MAX_SEND_ATTEMPTS = 5;

async function processOutbound() {
    try {
        // WICHTIG: empfaenger/forward_target sind KEINE Spalten der emails-Tabelle,
        // sie liegen nur in agent_logs (JSONB). Ein Query mit diesen Spaltennamen
        // schlägt serverseitig fehl (400).
        // .limit(10): agent_logs enthält threeRpmsData + inventoryData und ist pro Zeile
        // realistisch 30–100 KB groß. Ein ungedeckelter Select alle 10 s über eine
        // stauende approved-Queue war der Rückkopplungseffekt, der den Egress
        // hochgetrieben hat: Sendefehler → Stau → mehr Egress → DB-Sperre → nichts geht.
        const { data: approvedMails, error } = await supabase
            .from("emails")
            .select("id, mail_id, betreff, draft_reply, agent_logs, senders!inner(email)")
            .eq("status", "approved")
            .limit(10);

        if (error) {
            reportDbFailure();
            console.error("❌ processOutbound: Laden der genehmigten Mails fehlgeschlagen:", error.message);
            return;
        }
        reportDbSuccess();
        if (!approvedMails || approvedMails.length === 0) return;

        for (const mail of approvedMails) {
            const logs = (mail.agent_logs as any) || {};
            const attempts = Number(logs.send_attempts || 0);

            // Dead-Letter: nach MAX_SEND_ATTEMPTS aus der Schleife nehmen. Ohne diese
            // Grenze lief eine dauerhaft unzustellbare Mail alle 10 s erneut durch —
            // 8.640 Versuche pro Tag, jeder davon früher inklusive PMS-Mutation.
            if (attempts >= MAX_SEND_ATTEMPTS) {
                console.error(`⛔ ${mail.mail_id}: ${attempts} Sendeversuche gescheitert — als send_failed markiert.`);
                await supabase.from("emails")
                    .update({ status: "send_failed", agent_logs: { ...logs, send_failed_at: new Date().toISOString() } })
                    .eq("id", mail.id).eq("status", "approved");
                continue;
            }

            try {
                // Reply-To hat Vorrang vor der Absenderadresse. Bei Portal-Mails
                // (Booking.com, Airbnb) ist From: noreply@… — eine Antwort dorthin
                // erreicht den Gast nie, wurde aber als erfolgreich versendet verbucht.
                const senderEmail = (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email;
                const recipientEmail = logs.reply_to || senderEmail;

                if (!recipientEmail) {
                    console.error(`❌ Sende-Fehler (${mail.mail_id}): keine Empfängeradresse — als failed markiert`);
                    await supabase.from("emails").update({ status: "failed" }).eq("id", mail.id).eq("status", "approved");
                    continue;
                }

                // Atomar beanspruchen. Zwischenstatus "sending" statt direkt "sent":
                // ein Prozessabbruch zwischen Claim und Versand hinterließ bisher eine
                // Mail im Status "sent", die nie gesendet wurde — processOutbound sucht
                // nur nach "approved" und hat sie deshalb nie wieder angefasst.
                // "sending" ist als hängengebliebener Zustand erkennbar und wird von
                // recoverStuckSending() zurückgeholt.
                const { data: claimed, error: claimError } = await supabase
                    .from("emails")
                    .update({
                        status: "sending",
                        agent_logs: { ...logs, send_attempts: attempts + 1, sending_started_at: new Date().toISOString() },
                    })
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

                const hotel = resolveHotel(logs);

                // Letzter Halt vor dem Gast: geht der Entwurf mit einer Platzhalter-Signatur
                // raus, steht in der Mail eine erfundene Anschrift ("Musterstraße 1 ·
                // 44000 Musterstadt") und die Pflichtangaben sind unvollständig. Das darf
                // nicht passieren — die Mail wird angehalten statt versendet, mit einem
                // Hinweis, der genau sagt, was zu tun ist.
                if (hasPlaceholder((mail as any).draft_reply)) {
                    console.error(`⛔ ${mail.mail_id}: Entwurf enthält Signatur-Platzhalter — Versand angehalten. Bitte echte Hoteldaten unter /settings eintragen.`);
                    await supabase.from("emails").update({
                        status: "failed",
                        agent_logs: {
                            ...logs,
                            pipeline_errors: ["Versand angehalten: Die Signatur enthält noch Platzhalter (z. B. \"Musterstraße 1\"). Bitte im Dashboard unter /settings die echten Hoteldaten eintragen und die Mail danach neu prüfen."],
                        },
                    }).eq("id", mail.id).eq("status", "approved");
                    continue;
                }

                // ─── Schritt 1: E-Mail senden ───────────────────────────────────────
                // Der Versand kommt VOR der Mutation. Vorher war es umgekehrt, und weil
                // der Fehlerpfad auf "approved" zurücksetzte, wurde bei jedem Sendefehler
                // die PMS-Mutation erneut ausgeführt — bookExtraService erzeugt per
                // REC-${Date.now()} jedes Mal einen neuen Beleg auf der Gastrechnung.
                const subject = /^re:/i.test((mail as any).betreff || "")
                    ? (mail as any).betreff
                    : `Re: ${(mail as any).betreff}`;

                const headers: Record<string, string> = {};
                if (mail.mail_id && !mail.mail_id.startsWith("fallback_")) {
                    // Ohne In-Reply-To/References hängt die Antwort im Postfach des Gastes
                    // als neue, kontextlose Mail — er sieht seinen eigenen Verlauf nicht.
                    headers["In-Reply-To"] = `<${mail.mail_id}>`;
                    headers["References"] = `<${mail.mail_id}>`;
                }

                await transporter.sendMail({
                    from: `"${hotel?.name || "Petul Hotels"}" <${process.env.IMAP_USER}>`,
                    to: recipientEmail,
                    subject,
                    text: (mail as any).draft_reply,
                    headers,
                });

                // Ab hier ist der Versand eine Tatsache. mail_sent_at verhindert, dass
                // ein späterer Fehler die Mail erneut in die Sendeschleife schickt.
                const sentAt = new Date().toISOString();
                console.log(`✅ Outbound gesendet: ${mail.mail_id} → ${recipientEmail}`);

                // ─── Schritt 2: PMS-Mutation, genau einmal ──────────────────────────
                const actionData = logs.actionData;
                let mutationFailed = false;
                let mutationError: string | null = null;

                if (actionData?.graphql_mutation && actionData.graphql_mutation !== "none") {
                    // Vorprüfung gegen das reale Schema. Ohne sie ging ein frei vom
                    // Modell formulierter String ungeprüft an die API — und keine der
                    // real vorgeschlagenen Mutationen war ausführbar (s. mutationGuard.ts).
                    const guard = validateMutation(actionData.graphql_mutation);
                    if (!guard.ok) {
                        mutationFailed = true;
                        mutationError = `Mutation abgelehnt: ${guard.reason}`;
                        console.error(`⛔ Mutation NICHT ausgeführt (${mail.mail_id}): ${guard.reason}`);
                    } else if (hotel?.key) {
                        try {
                            const variables = typeof actionData.graphql_variables === "string"
                                ? JSON.parse(actionData.graphql_variables)
                                : (actionData.graphql_variables || {});
                            await query3RPMS(hotel.key, actionData.graphql_mutation, variables);
                            console.log(`✅ 3RPMS Mutation ausgeführt: ${mail.mail_id} (${actionData.api_action})`);
                        } catch (mutErr: any) {
                            // Die Mail ist raus und hat die Änderung womöglich zugesagt.
                            // Das MUSS im Dashboard sichtbar werden — bisher zeigte es
                            // schlicht grün "Ausgeführt", weil es nur auf status==="sent" sah.
                            mutationFailed = true;
                            mutationError = mutErr?.message || String(mutErr);
                            console.error(`⚠️  Mutation FEHLGESCHLAGEN (${mail.mail_id}): ${mutationError} — Mail ist bereits raus, Nacharbeit nötig!`);
                        }
                    } else {
                        mutationFailed = true;
                        mutationError = "Kein Hotel-API-Key auflösbar";
                        console.error(`⚠️  Mutation übersprungen (${mail.mail_id}): kein API-Key für Hotel`);
                    }
                }

                await supabase.from("emails").update({
                    status: "sent",
                    agent_logs: {
                        ...logs,
                        send_attempts: attempts + 1,
                        mail_sent_at: sentAt,
                        sent_to: recipientEmail,
                        sent_hotel: hotel?.name || null,
                        mutation_failed: mutationFailed,
                        mutation_error: mutationError,
                    },
                }).eq("id", mail.id);

            } catch (err: any) {
                console.error(`❌ Sende-Fehler (${mail.mail_id}), Versuch ${attempts + 1}/${MAX_SEND_ATTEMPTS}:`, err.message);
                // Der Rückgabewert wird jetzt geprüft. Scheiterte dieser Reset früher
                // still, blieb die Mail für immer auf "sent", ohne je gesendet worden zu sein.
                const { error: resetError } = await supabase
                    .from("emails")
                    .update({ status: "approved" })
                    .eq("id", mail.id)
                    .eq("status", "sending");
                if (resetError) {
                    console.error(`❌ KRITISCH: Reset auf "approved" fehlgeschlagen (${mail.mail_id}): ${resetError.message} — Mail hängt in "sending"!`);
                }
            }
        }
    } catch (err: any) {
        reportDbFailure();
        console.error("❌ processOutbound: unerwarteter Fehler:", err?.message || err);
    }
}

// Holt Mails zurück, die im Zwischenstatus "sending" hängen geblieben sind — etwa
// weil der Prozess zwischen Claim und Versand neu gestartet wurde. Ohne diese
// Selbstheilung wäre "sending" eine neue Sackgasse.
async function recoverStuckSending() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from("emails")
        .select("id, mail_id, agent_logs")
        .eq("status", "sending")
        .limit(50);

    if (error || !data || data.length === 0) return;

    const stuck = data.filter((row: any) => {
        const startedAt = row.agent_logs?.sending_started_at;
        // mail_sent_at gesetzt = der Versand war erfolgreich, nur das Status-Update
        // danach ist gescheitert. Diese Mail darf NICHT erneut gesendet werden.
        if (row.agent_logs?.mail_sent_at) return false;
        return !startedAt || startedAt < cutoff;
    });

    for (const row of stuck) {
        console.warn(`🔧 ${row.mail_id}: hing in "sending" — zurück auf "approved" für erneuten Versuch.`);
        await supabase.from("emails").update({ status: "approved" }).eq("id", row.id).eq("status", "sending");
    }

    // Versand erfolgreich, nur das Status-Update scheiterte → direkt auf "sent".
    const alreadySent = data.filter((row: any) => row.agent_logs?.mail_sent_at);
    for (const row of alreadySent) {
        console.warn(`🔧 ${row.mail_id}: war bereits versendet — korrigiere Status auf "sent".`);
        await supabase.from("emails").update({ status: "sent" }).eq("id", row.id).eq("status", "sending");
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
            reportDbFailure();
            console.error("❌ watchNewMails Fehler:", error.message);
            return;
        }
        reportDbSuccess();
        if (!newMails || newMails.length === 0) return;

        for (const mail of newMails) {
            const logs = (mail.agent_logs as any) || {};
            const attempts = Number(logs.pipeline_attempts || 0);

            // Ohne diese Grenze lief eine Mail, deren Ergebnis nicht geschrieben werden
            // konnte, alle 5 Sekunden komplett neu durch die Pipeline: 720 Durchläufe
            // pro Stunde à 3 LLM-Calls für eine einzige Mail. Der DB-Backoff greift hier
            // nicht, weil der SELECT ja erfolgreich ist — nur das Schreiben scheitert.
            if (attempts >= MAX_PIPELINE_ATTEMPTS) {
                console.error(`⛔ ${mail.mail_id}: ${attempts} Pipeline-Versuche ohne Ergebnis — als failed markiert.`);
                await supabase.from("emails").update({
                    status: "failed",
                    agent_logs: { ...logs, pipeline_errors: [`Nach ${attempts} Versuchen kein Ergebnis speicherbar`] },
                }).eq("mail_id", mail.mail_id).eq("status", "queued");
                continue;
            }

            console.log(`🔄 Watcher: Pipeline-Trigger für ${mail.mail_id}`);
            const mailData = {
                mail_id: mail.mail_id,
                betreff: mail.betreff,
                body_text: mail.body_text,
                absender: (mail.senders as any)?.[0]?.email || (mail.senders as any)?.email || "system",
                empfaenger: logs.empfaenger || "",
                forward_target: logs.forward_target || "",
                reply_to: logs.reply_to || null,
                force_process: !!logs.force_process,
                queued_at: logs.queued_at || null,
                ai_force_hotel: logs.ai_force_hotel || null,
                // Der komplette bisherige Stand wird durchgereicht, damit die Pipeline
                // ihn beim Schreiben mergen kann statt ihn zu überschreiben.
                agent_logs: logs,
                pipeline_attempts: attempts,
            };
            await runAiPipeline(mailData, mail.thread_id);
        }
    } catch (err: any) {
        reportDbFailure();
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

    // Schleifenschutz. Ohne ihn antwortet der Bot auf fremde Autoresponder, Newsletter
    // und Bounces — und zwar so lange, wie die Datenbank ausfällt. Zwei Auto-Responder,
    // die sich gegenseitig antworten, erzeugen eine Mailschleife, die erst endet, wenn
    // jemand den Prozess stoppt (oder der Provider die Absenderadresse sperrt).
    const headers = mailData.raw_headers || new Map();
    const autoSubmitted = String(headers.get?.("auto-submitted") || "");
    const precedence = String(headers.get?.("precedence") || "");
    const isBulk = autoSubmitted.toLowerCase().includes("auto")
        || ["bulk", "list", "junk"].includes(precedence.toLowerCase())
        || headers.get?.("list-id") != null
        || headers.get?.("list-unsubscribe") != null;

    if (isBulk) {
        console.log("   ⏭️  Fallback: automatische Massenmail (Auto-Submitted/List-Id) — keine Antwort.");
        return;
    }

    // Antwort an die eigene Adresse wäre eine garantierte Endlosschleife.
    if (!mailData.absender || mailData.absender.toLowerCase() === String(process.env.IMAP_USER).toLowerCase()) {
        console.log("   ⏭️  Fallback: Absender ist das eigene Postfach — keine Antwort.");
        return;
    }

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
// Verarbeitungsmodell: der UNSEEN-Bestand des Postfachs ist die einzige Quelle der
// Wahrheit. Das "exists"-Event ist nur noch ein TRIGGER, der einen Scan anstößt —
// es wird nicht mehr die Nachricht mit der gemeldeten Sequenznummer direkt gefetcht.
//
// Warum dieser Umbau nötig war — drei in den Produktionslogs belegte Fehler des
// alten Modells, die alle drei durch denselben Mechanismus verschwinden:
//
//  1. client.fetch() lief AUSSERHALB des Mailbox-Locks (der wurde direkt nach der
//     Handler-Registrierung im finally wieder freigegeben). ImapFlow armiert IDLE
//     nach einer Operation ohne Lock nicht neu → exakt 5:00 Min später Socket-Timeout.
//     12 von 12 Mal im Log reproduziert: jede eingehende Mail zog genau fünf Minuten
//     später "Verbindung verloren" nach sich, während IDLE ohne Mailverkehr
//     stundenlang stabil hielt (20.07., 17:18 → 20:25 ohne einen einzigen Abbruch).
//     Ergebnis: nach JEDER Mail war der Empfang bis zu 5 Min + 10 s Reconnect blind.
//
//  2. Gefetcht wurde ausschließlich data.count — also die EINE höchste Sequenznummer.
//     Kamen zwei Mails im selben IDLE-Push, war die niedrigere unwiederbringlich weg.
//     Belegt: Index 752 → 753 → 755. Nachricht 754 hat nie jemand gesehen.
//
//  3. Es gab keinen Scan beim Verbindungsaufbau. Alles, was während eines PM2-Neustarts
//     oder in einer Reconnect-Lücke ankam, wurde nie abgeholt — inklusive der sieben
//     Tage vom 21.–28.07., in denen der Listener nach einem gescheiterten Reconnect
//     komplett tot war, während PM2 durchgehend "online" meldete.
//
// Ein UNSEEN-Scan innerhalb des Locks löst alle drei Punkte zugleich und macht den
// Empfang zusätzlich idempotent: was aus irgendeinem Grund nicht verarbeitet wurde,
// bleibt ungelesen und wird beim nächsten Scan erneut angefasst.

// Mails, die älter als dieser Stichtag sind, werden NICHT mehr verarbeitet, sondern
// nur als gelesen markiert. Ohne diese Grenze würde der neue UNSEEN-Scan beim ersten
// Start den kompletten historischen Altbestand des Postfachs einlesen und durch die
// KI-Pipeline jagen — genau den Rückstau, der bewusst aus der Datenbank entfernt wurde.
const PROCESS_MAILS_SINCE = new Date(process.env.PROCESS_MAILS_SINCE ?? "2026-07-28T00:00:00Z");

let imapClient: ImapFlow | null = null;
let draining = false;
let reconnecting = false;
let lastImapActivity = Date.now();

async function handleMessage(source: Buffer) {
    const parsed = await simpleParser(source);
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

    // Reply-To ist bei allem, was über Portale (Booking.com, Airbnb) oder
    // Weiterleitungen kommt, die EINZIGE Adresse, die den Gast tatsächlich erreicht.
    // From: ist dort noreply@… — eine Antwort dorthin verpufft folgenlos, wird aber
    // als "sent" verbucht. Deshalb wird der Header ab hier mitgeführt.
    const replyTo = extractEmails(p.replyTo)[0] || null;

    // Bei multipart/mixed mit reinem text/html-Part (HTML-Mail mit Anhang — viele
    // Portal-, Formular- und Kanzlei-Mailer) bleibt parsed.text leer. Die Agenten
    // bekamen dann nur Betreff und Absender, während das Dashboard den vollen
    // HTML-Text rendert: die Rezeptionistin liest eine komplette Anfrage und nimmt an,
    // die KI habe dasselbe gesehen. Tatsächlich hat sie auf ein leeres Feld geantwortet.
    let bodyText = p.text || "";
    if (!bodyText.trim() && p.html) {
        bodyText = String(p.html)
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&quot;/gi, '"')
            .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
            .replace(/[ \t]+/g, " ")
            .replace(/\n\s*\n\s*\n+/g, "\n\n")
            .trim();
        if (bodyText) console.log(`   ℹ️  HTML-only Mail — Text aus HTML extrahiert (${bodyText.length} Zeichen).`);
    }

    const mailData = {
        mail_id,
        betreff: p.subject || "",
        body_text: bodyText,
        body_html: p.html || p.textAsHtml || "",
        absender,
        empfaenger: to_list.join(", "),
        forward_target: forwardTarget,
        reply_to: replyTo,
        raw_headers: rawHeaders,
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
        reportDbFailure();
        await sendFallbackAcknowledgement(mailData);
        // Bewusst KEIN \Seen: die Mail ist nirgends gespeichert. Bliebe sie als gelesen
        // zurück, wäre sie unwiederbringlich verloren — der Gast hätte eine
        // "wir melden uns"-Zusage bekommen, die niemand je einlösen kann. Ungelesen
        // holt der nächste Scan sie zurück, sobald die DB wieder antwortet.
        return { processed: false, keepUnseen: true };
    }
    reportDbSuccess();

    if (dbResult?.status === "success") {
        const { data: storedMail } = await supabase
            .from("emails")
            .select("thread_id")
            .eq("mail_id", mailData.mail_id)
            .maybeSingle();

        const queuedAt = new Date().toISOString();

        // Der Rückgabewert wird geprüft: schlägt dieses Update fehl, bleibt die Mail auf
        // "new" — und für "new" gibt es keinen Poller. Früher startete die Pipeline
        // trotzdem, fand beim Schreiben kein passendes queued_at und verwarf ihr eigenes
        // Ergebnis. Drei LLM-Calls bezahlt, Mail unsichtbar liegen geblieben.
        const { error: queueError } = await supabase.from("emails").update({
            status: "queued",
            agent_logs: {
                empfaenger: mailData.empfaenger,
                forward_target: mailData.forward_target,
                reply_to: mailData.reply_to,
                queued_at: queuedAt,
            },
        }).eq("mail_id", mailData.mail_id);

        if (queueError) {
            console.error(`❌ Queue-Update fehlgeschlagen (${mailData.mail_id}): ${queueError.message} — Mail bleibt ungelesen für den nächsten Scan`);
            return { processed: false, keepUnseen: true };
        }

        console.log(`   ✅ Mail gespeichert — Pipeline startet sofort`);

        runAiPipeline({
            mail_id: mailData.mail_id,
            betreff: mailData.betreff,
            body_text: mailData.body_text,
            absender: mailData.absender,
            empfaenger: mailData.empfaenger,
            forward_target: mailData.forward_target,
            reply_to: mailData.reply_to,
            force_process: false,
            queued_at: queuedAt,
        }, storedMail?.thread_id || null).catch(console.error);
    }

    return { processed: true, keepUnseen: false };
}

// Arbeitet den kompletten ungelesenen Bestand ab. Wird bei jedem Connect, bei jedem
// "exists"-Event und zusätzlich alle 2 Minuten als Sicherheitsnetz aufgerufen.
async function drainInbox(client: ImapFlow) {
    if (draining) return;
    draining = true;

    // Der Lock umschließt die GESAMTE Arbeit — das ist der eigentliche Fix für den
    // 5-Minuten-Blindzyklus. Erst nach release() armiert ImapFlow IDLE wieder.
    const lock = await client.getMailboxLock("INBOX");
    try {
        // Altbestand: einmal als gelesen markieren, nie verarbeiten. Sonst zieht der
        // erste Scan nach dem Deployment den gesamten historischen Rückstau ein.
        const staleUids = await client.search(
            { seen: false, before: PROCESS_MAILS_SINCE },
            { uid: true }
        );
        if (staleUids && staleUids.length > 0) {
            await client.messageFlagsAdd(staleUids.join(","), ["\\Seen"], { uid: true });
            console.log(`🗄️  ${staleUids.length} Mail(s) vor ${PROCESS_MAILS_SINCE.toISOString().slice(0, 10)} als gelesen markiert (nicht verarbeitet).`);
        }

        const uids = await client.search(
            { seen: false, since: PROCESS_MAILS_SINCE },
            { uid: true }
        );

        // Ein erfolgreich beantworteter SEARCH ist der Beweis, dass die Verbindung lebt —
        // unabhängig davon, ob Mails da sind. Genau das muss der Watchdog messen.
        // Zählte er nur verarbeitete Mails (wie zuvor), wäre eine ruhige Nacht ohne
        // Posteingang von einer toten Verbindung ununterscheidbar gewesen: der Watchdog
        // hätte den gesunden Prozess nach 30 stillen Minuten beendet. Dass das bisher
        // nicht passiert ist, lag nur daran, dass sein eigener 20-Minuten-Scan den Timer
        // zurücksetzte — ein Zufall, kein Schutz.
        lastImapActivity = Date.now();

        if (!uids || uids.length === 0) return;

        console.log(`\n✨ ${uids.length} ungelesene Mail(s) im Postfach — verarbeite...`);

        for (const uid of uids) {
            try {
                const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
                if (!msg || !msg.source) {
                    console.warn(`   ⚠️  UID ${uid}: kein Inhalt abrufbar — übersprungen`);
                    continue;
                }
                const result = await handleMessage(msg.source as Buffer);
                lastImapActivity = Date.now();

                // \Seen ausschließlich nach erfolgreicher Speicherung. Alles andere
                // bleibt ungelesen und wird beim nächsten Durchlauf erneut versucht.
                if (!result.keepUnseen) {
                    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
                }
            } catch (err: any) {
                console.error(`❌ Fehler bei UID ${uid}: ${err?.message || err} — bleibt ungelesen`);
            }
        }
    } finally {
        lock.release();
        draining = false;
    }
}

function scheduleReconnect(attempt = 0) {
    if (reconnecting) return;
    reconnecting = true;
    const delay = Math.min(10000 * Math.pow(2, attempt), 300000);
    console.log(`⚠️  Verbindung verloren. Reconnect-Versuch ${attempt + 1} in ${Math.round(delay / 1000)}s...`);
    setTimeout(() => {
        reconnecting = false;
        // Ohne dieses .catch() endete der Prozess nach einem einzigen gescheiterten
        // connect() in einer unbehandelten Rejection — und versuchte es NIE wieder.
        // Genau so entstand der siebentägige Totalausfall vom 21.07.
        startListener(attempt + 1).catch((err: any) => {
            console.error(`❌ Reconnect fehlgeschlagen: ${err?.message || err}`);
            scheduleReconnect(attempt + 1);
        });
    }, delay);
}

async function startListener(attempt = 0) {
    const client = new ImapFlow({
        host: imapHost!,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        auth: { user: imapUser!, pass: imapPassword! },
        logger: false,
    });

    // Beide Handler MÜSSEN vor connect() registriert werden. Standen sie danach
    // (wie bisher), wurde bei einem Fehler in connect() nie ein close-Handler
    // verdrahtet — der Reconnect-Pfad existierte dann schlicht nicht mehr.
    client.on("close", () => {
        imapClient = null;
        scheduleReconnect(0);
    });
    client.on("error", (err: any) => {
        // Ohne diesen Listener wirft ein EventEmitter-'error' eine uncaughtException.
        console.error(`⚠️  IMAP-Fehler: ${err?.message || err}`);
    });
    client.on("exists", () => {
        drainInbox(client).catch((err: any) =>
            console.error("❌ drainInbox (exists) Fehler:", err?.message || err)
        );
    });

    console.log("📨 Petul: Verbinde zum Mailserver...");
    await client.connect();
    await client.mailboxOpen("INBOX");

    imapClient = client;
    lastImapActivity = Date.now();
    console.log("✅ Petul: Verbunden & IDLE aktiv. Warte auf Mails...");

    // Nachhol-Scan bei jedem Verbindungsaufbau: fängt alles ein, was während eines
    // Neustarts oder einer Reconnect-Lücke eingetroffen ist.
    await drainInbox(client);
}

// ─── Watchdog: erkennt den stillen Empfangstod ───────────────────────────────
// Letzte Verteidigungslinie. Der siebentägige Ausfall im Juli blieb unbemerkt, weil
// PM2 "online" meldete und die Poller weiterliefen — nur der Mailempfang war tot.
// Hier wird aktiv geprüft, ob der Listener überhaupt noch etwas tut.

// Der 2-Minuten-Scan hält lastImapActivity im Normalbetrieb permanent frisch. Diese
// Schwellen greifen deshalb erst, wenn der Scan selbst nicht mehr durchkommt — also
// wenn die Verbindung tatsächlich tot ist, nicht wenn nur keine Post kommt.
const IMAP_STALE_MS = 15 * 60 * 1000;
const IMAP_DEAD_MS = 30 * 60 * 1000;

async function imapWatchdog() {
    const idleFor = Date.now() - lastImapActivity;

    if (!imapClient || idleFor > IMAP_DEAD_MS) {
        console.error(`💀 Watchdog: seit ${Math.round(idleFor / 60000)} Min keine IMAP-Aktivität — beende Prozess, PM2 startet neu.`);
        process.exit(1);
    }

    if (idleFor > IMAP_STALE_MS) {
        console.warn(`🩺 Watchdog: seit ${Math.round(idleFor / 60000)} Min keine Antwort vom Postfach — erzwinge Scan zur Lebendprüfung.`);
        try {
            await drainInbox(imapClient);
        } catch (err: any) {
            console.error(`❌ Watchdog-Scan fehlgeschlagen: ${err?.message || err} — erzwinge Reconnect.`);
            try { imapClient.close(); } catch { /* Verbindung ist ohnehin hin */ }
            imapClient = null;
        }
    }
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
    // "queued" und "send_failed" gehören dazu: eine Mail, deren Pipeline dauerhaft
    // scheitert, bzw. eine endgültig unzustellbare, blieb sonst für immer in der
    // aktiven Ansicht stehen.
    // Nur agent_logs->>queued_at statt des kompletten agent_logs-Objekts laden —
    // das Feld ist das einzige, was hier ausgewertet wird, während agent_logs pro
    // Zeile 30–100 KB groß sein kann (viermal täglich über den gesamten Bestand).
    const { data: candidates, error } = await supabase
        .from("emails")
        .select("id, agent_logs->>queued_at")
        .in("status", ["new", "queued", "processing", "failed", "send_failed"])
        .lt("received_at", cutoff);

    if (error) {
        console.error("❌ archiveStaleMails Fehler:", error.message);
        return;
    }
    if (!candidates || candidates.length === 0) return;

    const staleIds = candidates
        .filter((row: any) => {
            const queuedAt = row.queued_at;
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

// Bekannte, sauber behandelte IMAP-Socketfehler dürfen den Prozess nicht töten —
// scheduleReconnect() fängt sie ab. ALLES andere ist ein unbekannter Zustand: dann
// lieber sterben und von PM2 sauber neu starten lassen.
//
// Der bisherige Zustand war das Gegenteil davon: uncaughtException wurde nur geloggt,
// der Prozess lief mit halb geschlossenen Sockets und totem Listener weiter, PM2 sah
// "online" und startete deshalb nie neu. Genau das hat den siebentägigen Ausfall
// unsichtbar gemacht.
const RECOVERABLE_IMAP_ERRORS = ["NoConnection", "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"];

function isRecoverable(err: any): boolean {
    const code = err?.code || "";
    const msg = String(err?.message || err || "");
    return RECOVERABLE_IMAP_ERRORS.includes(code) || msg.includes("Socket timeout") || msg.includes("Connection not available");
}

process.on("uncaughtException", (err: any) => {
    console.error("Uncaught:", err);
    if (isRecoverable(err)) {
        console.warn("→ Bekannter Verbindungsfehler, Reconnect-Logik übernimmt.");
        return;
    }
    console.error("→ Unbekannter Zustand. Beende Prozess, PM2 startet neu.");
    process.exit(1);
});

process.on("unhandledRejection", (reason: any) => {
    console.error("Unhandled:", reason);
    if (!isRecoverable(reason)) {
        console.error("→ Unbehandelte Rejection in unbekanntem Zustand. Beende Prozess.");
        process.exit(1);
    }
});

// Selbst-planende Schleifen statt setInterval — dadurch kann die Pause zwischen
// Durchläufen bei wiederholten DB-Fehlern per nextDelay() dynamisch wachsen (s.o.),
// und ein einzelner langsamer Zyklus überlappt nie mit dem nächsten.
function scheduleProcessOutbound() {
    processOutbound().finally(() => setTimeout(scheduleProcessOutbound, nextDelay(10000)));
}

// Heartbeat: schreibt regelmäßig ein Lebenszeichen. Ein externer Uptime-Check
// (Healthchecks.io, Uptime Kuma) kann darauf alarmieren.
//
// Das ist der Punkt, an dem der siebentägige Ausfall im Juli hätte auffallen müssen:
// PM2 meldete "online", die Poller liefen, nur der Mailempfang war tot — es gab
// schlicht niemanden und nichts, das den Unterschied bemerkt hätte.
async function heartbeat() {
    const idleMin = Math.round((Date.now() - lastImapActivity) / 60000);
    const status = imapClient ? "verbunden" : "GETRENNT";
    console.log(`💓 Heartbeat: IMAP ${status}, letzte Aktivität vor ${idleMin} Min, ${activePipelines} Pipeline(s) aktiv.`);

    const url = process.env.HEARTBEAT_URL;
    if (!url) return;
    try {
        // Nur pingen, wenn der Empfang wirklich lebt — sonst meldet der Heartbeat
        // "gesund", während das System taub ist. Genau dieser Fehler soll hier nicht
        // noch einmal entstehen.
        if (imapClient && idleMin < 30) {
            await fetch(url, { signal: AbortSignal.timeout(10000) });
        } else {
            console.warn("💔 Heartbeat NICHT gesendet — IMAP nicht gesund. Externer Alarm wird auslösen.");
        }
    } catch (err: any) {
        console.warn(`⚠️  Heartbeat-Ping fehlgeschlagen: ${err?.message || err}`);
    }
}

// Täglicher Überblick über hängende Mails. Macht die Sackgassen sichtbar, bevor
// sich ein Gast beschwert.
async function statusReport() {
    const { data, error } = await supabase.from("emails").select("status");
    if (error || !data) return;

    const counts: Record<string, number> = {};
    for (const row of data as any[]) counts[row.status] = (counts[row.status] || 0) + 1;

    const summary = Object.entries(counts).map(([s, c]) => `${s}=${c}`).join("  ");
    console.log(`📊 Status-Report: ${summary}`);

    const stuck = (counts["queued"] || 0) + (counts["new"] || 0) + (counts["sending"] || 0);
    if (stuck > 10) console.warn(`⚠️  ${stuck} Mail(s) in Zwischenstatus — bitte prüfen.`);
    if (counts["send_failed"]) console.error(`⛔ ${counts["send_failed"]} Mail(s) endgültig unzustellbar — manuelle Nacharbeit nötig.`);
}
function scheduleWatchNewMails() {
    // watchNewMails ist nur noch Sicherheitsnetz (neue Mails triggern die Pipeline direkt im
    // IMAP-Handler) — 1,5s war unnötig aggressiv und hat spürbar zum Supabase-Egress-Verbrauch
    // beigetragen. 5s ist als Wartezeit nach einem Dashboard-Klick immer noch unauffällig kurz.
    watchNewMails().finally(() => setTimeout(scheduleWatchNewMails, nextDelay(5000)));
}

// Der Produkt-Cache ist bewusst NICHT mehr Startvoraussetzung. Hängt 3RPMS (halb
// offener Socket, kein Timeout im alten Code), blockierte der komplette Prozess:
// bis zu 25 Minuten kein IMAP-Listener, kein Versand, kein Poller — bei einem
// PM2-Status von "online" und einer einzigen Logzeile "Lade Hotel-Settings...".
// Empfang und Versand starten jetzt sofort; der Cache läuft daneben warm.
scheduleProcessOutbound();
scheduleWatchNewMails();

setInterval(archiveStaleMails, 6 * 3600 * 1000);
archiveStaleMails().catch(console.error);

// Sicherheitsnetz gegen verpasste "exists"-Events (Push verloren, Server sendet nicht).
setInterval(() => {
    if (imapClient) {
        drainInbox(imapClient).catch((err: any) =>
            console.error("❌ drainInbox (Intervall) Fehler:", err?.message || err)
        );
    }
}, 2 * 60 * 1000);

setInterval(() => { imapWatchdog().catch(console.error); }, 5 * 60 * 1000);

// Holt Mails zurück, die zwischen Claim und Versand hängen geblieben sind.
setInterval(() => { recoverStuckSending().catch(console.error); }, 5 * 60 * 1000);
recoverStuckSending().catch(console.error);

setInterval(() => { heartbeat().catch(console.error); }, 5 * 60 * 1000);
setInterval(() => { statusReport().catch(console.error); }, 6 * 3600 * 1000);
statusReport().catch(console.error);

startListener().catch((err: any) => {
    console.error(`❌ Erster Verbindungsaufbau fehlgeschlagen: ${err?.message || err}`);
    scheduleReconnect(0);
});

// Cache asynchron, mit periodischer Auffrischung. Vorher wurde er genau einmal beim
// Start geladen — schlug ein Hotel fehl, blieb sein Katalog für die gesamte
// Prozesslaufzeit (Wochen) leer und der Action Agent formulierte dauerhaft ohne
// Zimmerkategorien, ohne dass das irgendwo aufgefallen wäre.
warmProductCache().catch(console.error);
setInterval(() => { warmProductCache().catch(console.error); }, 6 * 3600 * 1000);
