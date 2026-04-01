import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import * as dotenv from "dotenv";
import { getPolicyPrompt } from "./prompts";

dotenv.config();

const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const POLICY_SCHEMA = z.object({
    is_spam: z.boolean().describe("True if email is junk/ads/spam, false for legitimate guest requests"),
    policy_passed: z.boolean().describe("True if the request complies with PETUL safety rules like Door Codes"),
    policy_decision_reason: z.string().describe("Short explanation for Petulia to use in her response")
});

export async function checkPolicy(intentData: any, mailText: string, threeRpmsData: any = null) {
    const prompt = `
${getPolicyPrompt()}

EXTRAHIERTE DATEN VON STEP 1:
${JSON.stringify(intentData, null, 2)}

ECHTZEIT-DATEN AUS 3RPMS (Falls vorhanden):
${threeRpmsData ? JSON.stringify(threeRpmsData, null, 2) : "Keine Live-Daten gefunden."}

ORIGINAL TEXT DES GASTES:
${mailText}
`;

    const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: POLICY_SCHEMA,
        system: "Du bist Petulia (Step 2: Policy Compliance). Prüfe die Anfrage gegen die Hausregeln.",
        prompt,
        temperature: 0.0,
    });

    return object;
}
