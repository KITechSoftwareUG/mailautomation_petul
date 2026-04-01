/**
 * Test script: manually re-runs the KI pipeline on a specific email from Supabase.
 * Usage: npx tsx src/test_pipeline.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { processIntent } from "./agents/01_intentAgent";
import { checkPolicy } from "./agents/02_policyAgent";
import { determineAction } from "./agents/03_actionAgent";
import { getApiKeyForHotel, resolveHotelName } from "./utils/threerpms";

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
    console.log("🔍 Lade eine unverarbeitete Mail aus der Datenbank...");

    // Fetch the latest unprocessed email (status = new or null intent)
    const { data: rows, error } = await supabase
        .from("emails")
        .select("*, senders!inner(email, name)")
        .is("intent", null)
        .order("received_at", { ascending: false })
        .limit(1);

    if (error) {
        console.error("❌ DB Fehler:", error.message);
        return;
    }
    if (!rows || rows.length === 0) {
        console.log("ℹ️ Keine unverarbeiteten Mails mit intent=null gefunden.");
        return;
    }

    const row = rows[0];
    const senderEmail = (row.senders as any)?.[0]?.email || "";
    console.log(`\n📧 Verarbeite: "${row.betreff}" von ${senderEmail}`);
    console.log(`   mail_id: ${row.mail_id}`);

    const mailData = {
        mail_id: row.mail_id,
        betreff: row.betreff || "",
        body_text: row.body_text || "",
        absender: senderEmail,
        empfaenger: "info@petul.de",
    };

    try {
        console.log("\n🤖 Starte KI Pipeline...");

        console.log("   [Step 1] Intent Agent...");
        const intentData = await processIntent(mailData, "");
        console.log("   → Intent:", intentData.kategorie);
        console.log("   → Entities:", JSON.stringify(intentData.extracted_entities));

        // Mocking the new logic briefly for the test script
        const resNum = intentData.extracted_entities.reservierungsnummer;
        let hotelName = resolveHotelName(mailData.empfaenger, "", intentData.extracted_entities.hotel_identifiziert);

        console.log("   → Identifiziertes Hotel (Vor 3RPMS Check):", hotelName);

        console.log("   [Step 2] Policy Agent...");
        const policyData = await checkPolicy(intentData, mailData.body_text);
        console.log("   → Policy:", policyData.is_allowed ? "✅ Erlaubt" : "❌ Abgelehnt");
        console.log("   → Grund:", policyData.reason);

        console.log("   [Step 3] Action Agent...");
        const actionData = await determineAction(intentData, policyData, mailData);
        console.log("   → API Aktion:", actionData.api_action);
        console.log("   → Entwurf:\n\n" + actionData.antwort_entwurf);

        // Save to DB
        const { error: updateError } = await supabase.from("emails").update({
            status: "processing",
            intent: intentData.kategorie,
            policy_decision_allowed: policyData.is_allowed,
            policy_decision_reason: policyData.reason,
            api_action: actionData.api_action,
            draft_reply: actionData.antwort_entwurf,
            agent_logs: { intentData, policyData, actionData } as any,
        }).eq("mail_id", row.mail_id);

        if (updateError) {
            console.error("\n❌ DB Update Fehler:", updateError.message);
        } else {
            console.log("\n✅ Erfolgreich in Supabase gespeichert! Schau ins Dashboard.");
        }

    } catch (err: any) {
        console.error("❌ Pipeline Fehler:", err.message);
    }
}

runTest();
