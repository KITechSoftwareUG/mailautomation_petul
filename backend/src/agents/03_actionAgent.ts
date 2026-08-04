import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import { getActionPrompt } from "./prompts";

dotenv.config();

// gpt-4o-mini: ausreichend für Hotel-Antworten, ~5x schneller als gpt-4o
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ACTION_SCHEMA = z.object({
    api_action: z.string().describe(
        "Name der geplanten PMS-Aktion: 'none' | 'updateRoomStay' | 'createExternalSale' | " +
        "'Manuelle Stornierung durch Empfang' | 'importReservation' | etc."
    ),
    graphql_mutation: z.string().nullable().describe(
        "Vollständiger GraphQL Mutation-String. null wenn keine Mutation nötig."
    ),
    graphql_variables: z.string().nullable().describe(
        "JSON-String mit den Variablen für die Mutation. null wenn keine Mutation."
    ),
    antwort_entwurf: z.string().describe(
        "Vollständiger, versandfertiger Antwortentwurf. " +
        "IMMER in der Sprache des Gastes (Englisch wenn Gast auf Englisch schreibt, etc.)."
    ),
});

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

    // Nur Zimmerkategorien weitergeben — Einzelzimmer (roomSetups) sind für E-Mails irrelevant
    const categories = productCatalog?.settings?.categories?.edges?.map((e: any) => ({
        id: e.node.id,
        name: e.node.name,
        beschreibung: e.node.description || "",
    })) || null;

    const productSection = categories?.length
        ? `\nZIMMERKATEGORIEN (für Verfügbarkeitshinweise):\n${JSON.stringify(categories, null, 2)}\n`
        : "\nZIMMERKATEGORIEN: Nicht geladen.\n";

    // Die vom Gast genannte Nummer war im PMS unbekannt (typisch: Booking.com- oder
    // Airbnb-Nummer), die Buchung wurde stattdessen über die Mailadresse gefunden. Ohne
    // diesen Hinweis bestätigt der Entwurf die genannte Nummer, als sei sie geprüft.
    const unresolvedCode = prefetchedPmsData?.unresolvedReservationCode;
    const codeWarning = unresolvedCode
        ? `\n⚠️ WICHTIG: Die vom Gast genannte Nummer "${unresolvedCode}" existiert im PMS NICHT — ` +
          `vermutlich eine Portal-Buchungsnummer (Booking.com/Airbnb). Die unten stehenden Daten ` +
          `stammen aus der Suche über die Absenderadresse. Bestätige diese Nummer NICHT und ` +
          `wiederhole sie nicht als unsere Reservierungsnummer. Nenne, falls vorhanden, unsere ` +
          `eigene Nummer aus den PMS-Daten.\n`
        : "";

    const pmsSection = prefetchedPmsData
        ? `\n## PMS-DATEN (RESERVIERUNG / GAST)${codeWarning}\n${JSON.stringify(prefetchedPmsData, null, 2)}\n`
        : "\n## PMS-DATEN\nKeine Buchungsdaten vorhanden (Neugast oder allgemeine Anfrage). Inhaltlich antworten ohne technische Erklärungen.\n";

    const inventorySection = prefetchedInventory
        ? `\n## VERFÜGBARKEIT\n${JSON.stringify(prefetchedInventory, null, 2)}\n`
        : "";

    const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: ACTION_SCHEMA,
        system: `${getActionPrompt()}
${productSection}
${execution_error ? `⚠️ VORHERIGER FEHLER: "${execution_error}" — Korrigiere deine Anfrage.\n` : ""}`,

        prompt: `Bearbeite diese E-Mail aus dem Petul-Postfach:

ABSENDER: ${mailData.absender}
BETREFF: ${mailData.betreff}

MAIL-INHALT:
${mailData.body_text}

INTENT-ANALYSE:
- Kategorie: ${intentData.kategorie}
- Gast-Name: ${intentData.extracted_entities?.gast_name || "nicht erkannt"}
- Reservierungsnummer: ${intentData.extracted_entities?.reservierungsnummer || "keine genannt"}
- Gewünschte Anreise: ${intentData.extracted_entities?.ankunft || "keine"}
- Gewünschte Abreise: ${intentData.extracted_entities?.abreise || "keine"}
- Personen: ${intentData.extracted_entities?.personenanzahl || "keine Angabe"}

RICHTLINIEN-ENTSCHEIDUNG:
- Anfrage erlaubt: ${policyData.policy_passed ? "Ja" : "Nein"}
- Grund: ${policyData.policy_decision_reason}
${pmsSection}${inventorySection}
AUFGABE: Schreibe den vollständigen, versandfertigen Antwortentwurf.
WICHTIG: Antworte IMMER in der Sprache des Gastes — Englisch wenn der Gast auf Englisch schreibt, Deutsch wenn auf Deutsch, etc.
Verwende die echten Daten aus dem PMS. KEIN "Wir werden uns melden" — antworte konkret.`,
    });

    return {
        api_action: object.api_action,
        graphql_mutation: object.graphql_mutation,
        graphql_variables: object.graphql_variables,
        antwort_entwurf: object.antwort_entwurf,
        threeRpmsData: prefetchedPmsData,
        inventoryData: prefetchedInventory,
        tool_calls_made: [],
        pipeline_errors: [],
    };
}
