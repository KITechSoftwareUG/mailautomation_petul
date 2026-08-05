/**
 * Prüft KI-generierte 3RPMS-Mutationen, BEVOR sie ausgeführt werden.
 *
 * Hintergrund: Der Action Agent gibt `graphql_mutation` als freien String zurück. Ein
 * Abgleich gegen das reale Schema (Introspection am 31.07.2026, Hotel H1) zeigte, dass
 * KEINE der vier real vorgeschlagenen Mutationen ausführbar war:
 *
 *   updateRoomStay(... mealNotes, guestMessage ...)   → beide Felder existieren dort nicht
 *   updateRoomStay(check_out: "2026-10-25T14:00:00")  → Datumsformat ohne Zeitzone abgelehnt
 *   importReservation(client:{id:"CLIENT_ID"} ...)    → Platzhalter statt ID, 5 Pflichtfelder fehlten
 *   importReservation(category, rates)                → heißen categoryId und dailyRates
 *
 * Aufgefallen wäre das nie: In der gesamten Projektlaufzeit wurde genau eine Mail
 * versendet, die Mutationen liefen also praktisch nie. Im Produktivbetrieb hätte jede
 * dieser Mails dem Gast eine Änderung zugesagt, die im PMS nicht stattfindet.
 *
 * Diese Prüfung ist bewusst konservativ: Im Zweifel wird abgelehnt. Eine nicht
 * ausgeführte Mutation kostet einen manuellen Handgriff an der Rezeption; eine
 * fälschlich zugesagte kostet das Vertrauen des Gastes.
 */

export type GuardResult =
    | { ok: true; mutation: string }
    | { ok: false; reason: string };

// Feldnamen je Mutation — aus pmsCapabilities.ts, damit Guard und Agenten-Prompt
// dieselbe Quelle haben. Genau ihr Auseinanderlaufen war der Ausgangsfehler: Die
// Prompt-Vorlagen enthielten Felder, die im Schema nie existierten.
import { MUTATIONS } from "./pmsCapabilities";

const ALLOWED = MUTATIONS;

/**
 * Platzhalter, die das Modell aus den Prompt-Vorlagen übernimmt, statt echte Werte
 * einzusetzen. Real beobachtet: client: { id: "CLIENT_ID" }.
 */
const PLACEHOLDER = /\b(ROOM_STAY_ID|CLIENT_ID|RESERVATION_ID|CATEGORY_ID|EXTERNAL_SALES_PRODUCT_ID|EXTERNE_ID|PRODUCT_ID|YYYY-MM-DD|\.\.\.)\b/;

/** 3RPMS verlangt "Y-m-d\TH:i:sP" — also MIT Zeitzonen-Offset. Verifiziert am 31.07.2026. */
const DATETIME_FIELD = /\b(check_in|check_out|saleCreatedAt|datetime)\s*:\s*"([^"]*)"/g;
const VALID_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

export function validateMutation(raw: string | null | undefined): GuardResult {
    const mutation = (raw || "").trim();
    if (!mutation || mutation === "none") return { ok: false, reason: "Keine Mutation angegeben." };

    const nameMatch = mutation.match(/mutation\s*(?:\w+\s*(?:\([^)]*\))?\s*)?\{\s*(\w+)\s*\(/);
    if (!nameMatch) return { ok: false, reason: "Mutationsname nicht erkennbar — Syntax unerwartet." };

    const name = nameMatch[1];
    const spec = ALLOWED[name];
    if (!spec) {
        return {
            ok: false,
            reason: `Mutation "${name}" ist nicht freigegeben. Erlaubt: ${Object.keys(ALLOWED).join(", ")}.`,
        };
    }

    if (PLACEHOLDER.test(mutation)) {
        const hit = mutation.match(PLACEHOLDER)?.[0];
        return { ok: false, reason: `Platzhalter "${hit}" statt eines echten Wertes — die Mutation würde fehlschlagen.` };
    }

    // Feldnamen der obersten input-Ebene einsammeln (verschachtelte Objekte werden
    // bewusst nicht zerlegt — dafür wäre ein echter Parser nötig; die häufigen Fehler
    // liegen alle auf der ersten Ebene).
    //
    // String-Literale werden vorher ausgeblendet: Ein Zeitwert wie "14:00:00+02:00"
    // enthält Doppelpunkte und würde sonst als Feldname "14" gelesen — dann fiele jede
    // korrekte Mutation mit Zeitangabe durch. Genau das hat der Test aufgedeckt.
    const masked = mutation.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const inputBlock = masked.slice(masked.indexOf("input:"));
    const topLevel = new Set<string>();
    let depth = 0;
    for (const m of inputBlock.matchAll(/([{}])|(\w+)\s*:/g)) {
        if (m[1] === "{") { depth++; continue; }
        if (m[1] === "}") { depth--; continue; }
        if (m[2] && depth === 1) topLevel.add(m[2]);
    }

    const known = new Set([...spec.required, ...spec.optional]);
    const unknown = [...topLevel].filter(f => !known.has(f));
    if (unknown.length) {
        return { ok: false, reason: `Feld(er) "${unknown.join('", "')}" existieren in ${name} nicht. Erlaubt: ${[...known].join(", ")}.` };
    }

    const missing = spec.required.filter(f => !topLevel.has(f));
    if (missing.length) {
        return { ok: false, reason: `Pflichtfeld(er) "${missing.join('", "')}" fehlen in ${name}.` };
    }

    for (const m of mutation.matchAll(DATETIME_FIELD)) {
        if (!VALID_DATETIME.test(m[2])) {
            return {
                ok: false,
                reason: `Datumswert "${m[2]}" in Feld "${m[1]}" hat das falsche Format. 3RPMS verlangt einen Zeitzonen-Offset, z. B. "2026-10-25T14:00:00+02:00".`,
            };
        }
    }

    return { ok: true, mutation };
}

/**
 * Wünsche, die über diese API grundsätzlich nicht erfüllbar sind. Der Entwurf darf sie
 * nicht als erledigt darstellen — genau das ist real passiert ("Ihre Reservierung wurde
 * geändert", obwohl updateRoomStay ausschließlich check_in/check_out kennt und weder
 * Zeitraum noch Zimmer noch Preis ändern kann).
 */
export const NICHT_MOEGLICH = {
    umbuchung: "Zeitraum einer bestehenden Buchung ändern — UpdateRoomStayInput kennt nur check_in/check_out, UpdateReservationInput kein Datum.",
    zimmerwechsel: "Zimmer/Kategorie einer bestehenden Buchung ändern — keine Mutation vorhanden.",
    preisaenderung: "Preis einer einzelnen Buchung ändern — nur updateCategoryPrices (gilt kategorieweit, nicht pro Buchung).",
    fruehzeitigerCheckout: "check_out setzen, solange der Aufenthalt nicht eingecheckt ist — laut Schema erst nach Check-in erlaubt.",
} as const;
