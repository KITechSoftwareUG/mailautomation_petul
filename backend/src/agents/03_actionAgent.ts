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
        "Vollständiger, versandfertiger Antwortentwurf auf Deutsch. " +
        "Beginnt mit der Anrede, endet mit 'Herzliche Grüße, Ihre Petulia & das Petul-Team'."
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

    const pmsSection = prefetchedPmsData
        ? `\n## PMS-DATEN (RESERVIERUNG / GAST)\n${JSON.stringify(prefetchedPmsData, null, 2)}\n`
        : "\n## PMS-DATEN\nKein Eintrag im System — allgemeine Auskunft geben.\n";

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
AUFGABE: Schreibe den vollständigen, versandfertigen Antwortentwurf auf Deutsch.
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
