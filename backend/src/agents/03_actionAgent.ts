import { generateText, tool, zodSchema, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import { getActionPrompt } from "./prompts";
import {
    getReservationByCode,
    searchReservationsByEmail,
    getInventory,
} from "../utils/threerpms";

dotenv.config();

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Rückgabe des Action-Agents — enthält sowohl den Entwurf als auch die gesammelten PMS-Daten
export interface ActionResult {
    api_action: string;
    graphql_mutation: string | null;
    graphql_variables: string | null;
    antwort_entwurf: string;
    threeRpmsData: any | null;
    inventoryData: any | null;
    tool_calls_made: string[];
    pipeline_errors: string[];
}

export async function determineAction(
    intentData: any,
    policyData: any,
    mailData: any,
    hotelApiKey: string = "",
    productCatalog: any = null,
    execution_error: string | null = null,
    prefetchedPmsData: any = null,
    prefetchedInventory: any = null,
): Promise<ActionResult> {

    const productSection = productCatalog
        ? `\nVERFÜGBARE ZUSATZLEISTUNGEN (IDs für createExternalSale):\n${JSON.stringify(productCatalog, null, 2)}\n`
        : "\nZUSATZLEISTUNGEN: Nicht geladen — bei Bedarf an Empfang weiterleiten.\n";

    const hasPmsAccess = !!hotelApiKey;

    const prefetchSection = (prefetchedPmsData || prefetchedInventory)
        ? `\n## BEREITS GELADENE PMS-DATEN (kein Lookup-Tool mehr nötig — direkt antwort_erstellen aufrufen!)\n` +
          (prefetchedPmsData ? `\nRESERVIERUNG / GAST:\n${JSON.stringify(prefetchedPmsData, null, 2)}\n` : "") +
          (prefetchedInventory ? `\nVERFÜGBARKEIT:\n${JSON.stringify(prefetchedInventory, null, 2)}\n` : "")
        : "";

    // ─── Agentic Loop ────────────────────────────────────────────────────────────
    // Die KI entscheidet selbst, welche Tools sie wann aufruft.
    // Erst nach der Datensammlung ruft sie "antwort_erstellen" auf.

    const result = await generateText({
        model: openai("gpt-4o"),
        stopWhen: stepCountIs(6),

        system: `${getActionPrompt()}

${productSection}
${prefetchSection}
${execution_error ? `⚠️ VORHERIGER FEHLER BEIM API-AUFRUF: "${execution_error}" — Korrigiere deine Anfrage.\n` : ""}`,

        prompt: `Bearbeite diese E-Mail aus dem Petul-Postfach:

ABSENDER: ${mailData.absender}
BETREFF: ${mailData.betreff}
PMS-ZUGANG: ${hasPmsAccess ? "✅ Verfügbar — nutze die Tools!" : "❌ Nicht verfügbar für dieses Hotel"}

MAIL-INHALT:
${mailData.body_text}

INTENT-ANALYSE:
- Kategorie: ${intentData.kategorie}
- Gast-Name (aus Mail): ${intentData.extracted_entities?.gast_name || "nicht erkannt"}
- Reservierungsnummer: ${intentData.extracted_entities?.reservierungsnummer || "keine genannt"}
- Gewünschte Anreise: ${intentData.extracted_entities?.ankunft || "keine"}
- Gewünschte Abreise: ${intentData.extracted_entities?.abreise || "keine"}
- Personen: ${intentData.extracted_entities?.personenanzahl || "keine Angabe"}

RICHTLINIEN-ENTSCHEIDUNG:
- Anfrage erlaubt: ${policyData.policy_passed ? "Ja" : "Nein"}
- Grund: ${policyData.policy_decision_reason}

DEINE AUFGABE:
1. Rufe JETZT die passenden Lookup-Tools auf — hole alle relevanten Daten aus dem PMS
2. Schreibe danach via "antwort_erstellen" einen vollständigen, versandfertigen Antwortentwurf
3. Der Entwurf muss die echten Daten aus dem PMS enthalten (Name, Buchungscode, Daten, Preise)
4. KEIN "Wir werden uns melden" — beantworte die Anfrage des Gastes konkret und vollständig`,

        tools: {
            // ── Tool 1: Reservierung per Code ─────────────────────────────────────
            reservierung_suchen: tool({
                description:
                    "Lädt eine Reservierung anhand des Buchungscodes aus dem PMS. " +
                    "Verwenden wenn der Gast einen Reservierungscode genannt hat.",
                inputSchema: zodSchema(z.object({
                    code: z.string().describe("Buchungscode / Reservierungsnummer aus der E-Mail"),
                })),
                execute: async ({ code }) => {
                    if (!hotelApiKey) return { fehler: "Kein PMS-Schlüssel für dieses Hotel" };
                    try {
                        const res = await getReservationByCode(hotelApiKey, code);
                        const node = res?.reservations?.edges?.[0]?.node;
                        if (!node) return { nicht_gefunden: true, gesuchter_code: code };
                        return node;
                    } catch (err: any) {
                        return { fehler: err.message, gesuchter_code: code };
                    }
                },
            }),

            // ── Tool 2: Gast per E-Mail suchen ───────────────────────────────────
            gast_suchen: tool({
                description:
                    "Sucht einen Gast und seine aktuellen/zukünftigen Buchungen im PMS anhand der E-Mail-Adresse. " +
                    "Verwenden wenn KEIN Reservierungscode vorhanden ist.",
                inputSchema: zodSchema(z.object({
                    email: z.string().describe("E-Mail-Adresse des Gastes (Absender)"),
                })),
                execute: async ({ email }) => {
                    if (!hotelApiKey) return { fehler: "Kein PMS-Schlüssel für dieses Hotel" };
                    try {
                        const data = await searchReservationsByEmail(hotelApiKey, email);
                        if (!data) return { nicht_gefunden: true, gesuchte_email: email };
                        return data;
                    } catch (err: any) {
                        return { fehler: err.message };
                    }
                },
            }),

            // ── Tool 3: Verfügbarkeit prüfen ─────────────────────────────────────
            verfuegbarkeit_pruefen: tool({
                description:
                    "Prüft die Zimmerverfügbarkeit für einen Zeitraum. " +
                    "PFLICHT bei Reservierungsanfragen, bevor eine Bestätigung zugesagt wird!",
                inputSchema: zodSchema(z.object({
                    anreise: z.string().describe("Anreisedatum YYYY-MM-DD"),
                    abreise: z.string().describe("Abreisedatum YYYY-MM-DD"),
                })),
                execute: async ({ anreise, abreise }) => {
                    if (!hotelApiKey) return { fehler: "Kein PMS-Schlüssel für dieses Hotel" };
                    try {
                        return await getInventory(hotelApiKey, anreise, abreise);
                    } catch (err: any) {
                        return { fehler: err.message };
                    }
                },
            }),

            // ── Tool 4: Finale Antwort erstellen (PFLICHTSCHRITT) ─────────────────
            antwort_erstellen: tool({
                description:
                    "Legt die finale Antwort und die geplante PMS-Aktion fest. " +
                    "MUSS immer als LETZTER Schritt aufgerufen werden.",
                inputSchema: zodSchema(z.object({
                    api_action: z.string().describe(
                        "Name der geplanten PMS-Aktion: 'none' | 'updateRoomStay' | " +
                        "'createExternalSale' | 'Manuelle Stornierung durch Empfang' | " +
                        "'importReservation' | etc."
                    ),
                    graphql_mutation: z.string().nullable().describe(
                        "Vollständiger GraphQL Mutation-String. null wenn keine Mutation nötig."
                    ),
                    graphql_variables: z.string().nullable().describe(
                        "JSON-String mit den Variablen für die Mutation. null wenn keine Mutation."
                    ),
                    antwort_entwurf: z.string().describe(
                        "Vollständiger, versandfertiger Antwortentwurf auf Deutsch. " +
                        "Beginnt mit der Anrede, endet mit 'Herzliche Grüße, Ihre Petulia & das Petul-Team'."
                    ),
                })),
                execute: async (params) => params,
            }),
        },
    });

    // ─── Tool-Ergebnisse sammeln ──────────────────────────────────────────────────

    const toolResults = result.steps.flatMap((s) => (s as any).toolResults ?? []);

    const draftResult = toolResults.find((r: any) => r.toolName === "antwort_erstellen")
        ?.output as ActionResult | undefined;

    const pmsResult =
        toolResults.find((r: any) => r.toolName === "reservierung_suchen")?.output ||
        toolResults.find((r: any) => r.toolName === "gast_suchen")?.output ||
        null;

    const inventoryResult =
        toolResults.find((r: any) => r.toolName === "verfuegbarkeit_pruefen")?.output || null;

    const calledTools = toolResults
        .filter((r: any) => r.toolName !== "antwort_erstellen")
        .map((r: any) => r.toolName);

    const pipelineErrors = toolResults
        .filter((r: any) => r.output?.fehler)
        .map((r: any) => `${r.toolName}: ${r.output.fehler}`);

    // Fallback wenn KI "antwort_erstellen" nicht aufgerufen hat
    const draft = draftResult ?? {
        api_action: "none",
        graphql_mutation: null,
        graphql_variables: null,
        antwort_entwurf:
            result.text ||
            "Vielen Dank für Ihre Nachricht. Wir werden Ihre Anfrage umgehend prüfen " +
            "und uns schnellstmöglich bei Ihnen melden.\n\nHerzliche Grüße, Ihre Petulia & das Petul-Team",
    };

    return {
        api_action: draft.api_action,
        graphql_mutation: draft.graphql_mutation,
        graphql_variables: draft.graphql_variables,
        antwort_entwurf: draft.antwort_entwurf,
        threeRpmsData: pmsResult,
        inventoryData: inventoryResult,
        tool_calls_made: calledTools,
        pipeline_errors: pipelineErrors,
    };
}
