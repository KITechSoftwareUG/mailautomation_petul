import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import { getActionPrompt } from "./prompts";

dotenv.config();

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const ACTION_SCHEMA = z.object({
    reflexion_loop_gedanken: z.array(z.string()).describe("Iterativer Denkprozess (Loop): Prüfe deinen Entwurf mehrfach kritisch. 1. Was will der Gast? 2. Haben wir alle API-Fähigkeiten genutzt? 3. Wie perfektionieren wir die Antwort?"),
    api_action: z.string().describe("Name der gewünschten API Aktion in 3RPMS (z.B. 'updateRoomStay' oder 'none')"),
    graphql_mutation: z.string().nullable().describe("Optional: Der exakte GraphQL Mutation/Query String, der ausgeführt werden soll, basierend auf der Knowledge Base."),
    graphql_variables: z.string().nullable().describe("Optional: Als JSON formatierter Text-String mit den Variablen für die GraphQL Query."),
    antwort_entwurf: z.string().describe("Der fertige, perfektionierte Antwortentwurf für den Gast.")
});

export async function determineAction(intentData: any, policyData: any, mailData: any, threeRpmsData: any = null, execution_error: string | null = null) {
    const prompt = `
${getActionPrompt()}

MAIL DES GASTES:
${mailData.body_text}

ANALYSE (Intent):
${JSON.stringify(intentData, null, 2)}

RICHTLINIEN-ENTSCHEIDUNG (Policy):
${JSON.stringify(policyData, null, 2)}

ECHTZEIT-DATEN AUS 3RPMS:
${threeRpmsData ? JSON.stringify(threeRpmsData, null, 2) : "Keine Live-Daten gefunden."}

${execution_error ? `
⚠️ VORHERIGER FEHLER BEIM API-AUFRUF:
"${execution_error}"

Bitte analysiere den Fehler, korrigiere deine Mutation/Query und versuche es erneut oder erkläre dem Gast, warum es nicht geklappt hat.
` : ""}
`;

    const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: ACTION_SCHEMA,
        system: "Du bist Petulia, die herzliche digitale Assistentin von Petul. Leite die API Aktion ab und schreibe den perfekten Antwortentwurf.",
        prompt,
        temperature: 0.1,
    });

    return object;
}
