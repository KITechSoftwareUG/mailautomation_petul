import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as dotenv from "dotenv";

import { getIntentPrompt } from "./prompts";

dotenv.config();

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const INTENT_SCHEMA = z.object({
    kategorie: z.enum([
        "Reservierungsanfrage",
        "Stornierung",
        "Umbuchung",
        "Allgemeine Frage",
        "Beschwerde",
        "Rechnungsfrage",
        "Spam/Irrelevant",
        "Sonstiges"
    ]),
    extracted_entities: z.object({
        gast_name: z.string().nullable(),
        ankunft: z.string().nullable().describe("ISO Date YYYY-MM-DD"),
        abreise: z.string().nullable().describe("ISO Date YYYY-MM-DD"),
        personenanzahl: z.number().nullable(),
        reservierungsnummer: z.string().nullable(),
        zimmernummer: z.string().nullable(),
        hotel_identifiziert: z.string().nullable().describe("Name des Petul Hotels (z.B. Zeche, Anne 40, Brunnen, Residenz, Ruhrbogen)")
    }).describe("Extrahierte Parameter für APIs")
});

export async function processIntent(mailData: any, historyText: string) {
    const prompt = `
${getIntentPrompt()}

ABSENDER: ${mailData.absender}
BETREFF: ${mailData.betreff}

HISTORY:
${historyText.length > 0 ? historyText : "Keine Historie"}

NACHRICHT:
${mailData.body_text}
`;

    const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: INTENT_SCHEMA,
        system: "Du bist Petulia (Step 1: Identifikation). Extrahiere nur die Fakten und ordne die Mail einer Kategorie zu.",
        prompt,
        temperature: 0.1,
    });

    return object;
}
