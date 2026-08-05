/**
 * Was die 3RPMS-API wirklich kann — die einzige Wahrheitsquelle im Projekt.
 *
 * Erhoben per GraphQL-Introspection der Live-API am 05.08.2026 (Hotel H1):
 * 25 Mutationen, 17 Queries, 192 Typen. Jede Angabe hier stammt aus dem Schema,
 * nicht aus Dokumentation oder Annahme.
 *
 * Diese Datei speist ZWEI Verbraucher, damit sie nicht auseinanderlaufen können:
 *   1. `mutationGuard.ts` — prüft KI-erzeugte Mutationen vor der Ausführung
 *   2. `buildCapabilityPrompt()` — liefert dem Action Agent seinen Regelteil
 *
 * Wer hier etwas ändert, ändert beides. Das ist Absicht: Der Ausgangsfehler war,
 * dass die Prompt-Vorlagen eigene, erfundene Feldnamen enthielten (`mealNotes` und
 * `guestMessage` bei `updateRoomStay`, `category`/`rates` statt `categoryId`/
 * `dailyRates`) und niemand sie je gegen das Schema gehalten hat.
 */

export interface MutationSpec {
    /** Wofür der Empfang sie fachlich einsetzt. */
    zweck: string;
    required: string[];
    optional: string[];
    /** Harte Einschränkungen aus dem Schema — für Prompt und Dashboard. */
    constraints?: string[];
}

/**
 * Freigegebene Mutationen. Bewusst eine Teilmenge der 25: Webhook-, Zahlungsmittel-
 * und Preis-/Restriktions-Mutationen gehören nicht in einen Mailbeantwortungs-Flow.
 * `updateCategoryPrices` ist besonders heikel — Änderungen werden laut Schema
 * "immediately" an alle angebundenen Buchungsportale gepusht.
 */
export const MUTATIONS: Record<string, MutationSpec> = {
    updateRoomStay: {
        zweck: "Tatsächlichen Check-in-/Check-out-Zeitpunkt eines Aufenthalts setzen.",
        required: ["id"],
        optional: ["check_in", "check_out"],
        constraints: [
            "Kennt AUSSCHLIESSLICH id, check_in, check_out — kein Datum, kein Zimmer, kein Preis, keine Notizen.",
            "check_out ist laut Schema erst erlaubt, wenn der Aufenthalt bereits eingecheckt ist.",
            "Datumswerte brauchen einen Zeitzonen-Offset (2026-10-25T14:00:00+02:00).",
        ],
    },
    updateReservation: {
        zweck: "Metadaten einer Reservierung ändern (Gruppenname, zugeordneter Gast/Rechnungsempfänger).",
        required: ["id"],
        optional: ["groupName", "clientId", "contactId", "billingClientId", "billingContactId"],
        constraints: [
            "Das Feld heißt id, NICHT reservationId.",
            "Kein Status, kein Datum, kein Zimmer — Storno und Umbuchung sind hierüber unmöglich.",
        ],
    },
    createExternalSale: {
        zweck: "Zusatzleistung auf die Rechnung buchen (Hund, Frühstück, Parkplatz).",
        required: ["productId", "roomStayId", "amount", "saleCreatedAt", "receiptNumber"],
        optional: ["receiptPdfUrl", "waiterName", "tableName"],
        constraints: [
            "Alle fünf Pflichtfelder müssen gesetzt sein.",
            "productId muss ein real existierendes Produkt sein — pro Integration existiert nur EINES (Schema: 'Each integration can create only one external sales product'). Verschiedene Leistungen werden über amount und receiptNumber unterschieden, nicht über eigene Produkte.",
            "Die Reservierung darf nicht storniert sein.",
            "receiptNumber muss eindeutig sein — bei Wiederholung entsteht ein zweiter Beleg auf der Gastrechnung.",
        ],
    },
    createDeposit: {
        zweck: "Anzahlung auf eine Reservierung verbuchen.",
        required: ["paymentMethod", "reservation", "amount"],
        optional: ["datetime", "postingText"],
        constraints: ["Pro Integration und Hotel existiert nur EINE Zahlungsart."],
    },
    addRoomStayGuest: {
        zweck: "Mitreisenden zu einem Aufenthalt hinzufügen.",
        required: ["roomStayId", "clientId"],
        optional: ["beforeId"],
        constraints: ["clientId muss ein existierender Gast sein — sonst vorher createClient."],
    },
    removeRoomStayGuest: {
        zweck: "Mitreisenden von einem Aufenthalt entfernen.",
        required: ["roomStayId", "clientId"],
        optional: [],
    },
    createClient: {
        zweck: "Neuen Gast oder Firma anlegen (Vorstufe für Buchung oder Mitreisende).",
        required: [],
        optional: ["person", "company"],
        constraints: [
            "Entweder person ODER company, nicht beides.",
            "In beiden Fällen sind country und language PFLICHT.",
            "Bei person zusätzlich: mindestens firstname oder lastname.",
        ],
    },
    importReservation: {
        zweck: "Neue Buchung anlegen — und, mit derselben externalId, eine zuvor selbst angelegte ändern oder stornieren.",
        required: ["externalId", "status", "client", "roomStays"],
        optional: ["bookingChannelCode", "bookingSourceId", "bookingTypeId", "stayTypeId",
                   "paymentTermsId", "groupName", "notes", "contact"],
        constraints: [
            "status ist ACTIVE, CANCELLED oder INVOICED.",
            "Ein erneuter Import mit derselben externalId ÜBERSCHREIBT die bestehende Reservierung vollständig — inklusive aller roomStays.",
            "Damit sind Umbuchung und Storno NUR für Buchungen möglich, die diese Integration selbst angelegt hat (deren externalId also bekannt ist).",
            "Je roomStay Pflicht: categoryId, reservation_from, reservation_to, ageGroups, dailyRates, rateCode.",
            "Die Felder heißen categoryId (nicht category) und dailyRates (nicht rates).",
            "dailyRates muss jeden Tag zwischen reservation_from und reservation_to abdecken (Abreisetag exklusive).",
            "rateCode muss aus Query.ratePlans stammen.",
        ],
    },
};

/**
 * Wünsche, die über diese API nicht erfüllbar sind. Der Entwurf darf sie niemals als
 * erledigt darstellen — genau das ist real passiert ("Ihre Reservierung wurde geändert",
 * obwohl updateRoomStay weder Zeitraum noch Zimmer noch Preis ändern kann).
 */
export interface Grenze {
    fall: string;
    grund: string;
    apiAction: string;
}

export const NICHT_MOEGLICH: Grenze[] = [
    {
        fall: "Umbuchung — Zeitraum einer bestehenden Buchung ändern",
        grund: "updateRoomStay kennt nur check_in/check_out (die tatsächlichen An-/Abreisezeitpunkte), updateReservation kein Datumsfeld. Nur über importReservation mit bekannter externalId möglich — die gibt es bei PMS- oder Portalbuchungen nicht.",
        apiAction: "Manuelle Umbuchung durch Empfang",
    },
    {
        fall: "Zimmer- oder Kategoriewechsel einer bestehenden Buchung",
        grund: "Es existiert keine Mutation dafür. importReservation würde die gesamte Buchung überschreiben und scheidet für fremde Buchungen aus.",
        apiAction: "Manueller Zimmerwechsel durch Empfang",
    },
    {
        fall: "Preis einer einzelnen Buchung ändern",
        grund: "Nur updateCategoryPrices, und das gilt kategorieweit für einen Zeitraum — es würde den Preis für ALLE Gäste ändern und wird sofort an die Buchungsportale gepusht.",
        apiAction: "Manuelle Preisanpassung durch Empfang",
    },
    {
        fall: "Late Check-out für einen noch nicht angereisten Gast fest eintragen",
        grund: "check_out ist laut Schema erst setzbar, nachdem der Aufenthalt eingecheckt wurde.",
        apiAction: "Late Check-out vormerken (Empfang)",
    },
    {
        fall: "Stornierung einer Buchung, die nicht über diese Integration angelegt wurde",
        grund: "ReservationStatus.CANCELLED existiert, ist aber nur über importReservation erreichbar und setzt die eigene externalId voraus.",
        apiAction: "Manuelle Stornierung durch Empfang",
    },
];

/**
 * Was das Schema erlaubt, ist nicht automatisch für diesen Zugang freigeschaltet.
 * Gemessen am 05.08.2026 (H1) war der reale Zustand deutlich enger:
 *
 *   ratePlans            → "Die Reservierungs-API wurde nicht aktiviert"  → kein importReservation
 *   externalSalesProducts → 0 Einträge                                    → kein createExternalSale
 *   paymentMethods        → 0 Einträge                                    → kein createDeposit
 *
 * Damit war KEINE Schreibaktion ausführbar — das System konnte ausschließlich lesen
 * und Text erzeugen. Ein Entwurf, der eine Ausführung zusagt, wäre in jedem einzelnen
 * Fall eine Falschaussage gegenüber dem Gast gewesen.
 *
 * Deshalb wird der Zustand beim Start je Hotel gemessen (`probeCapabilities`) und in
 * den Agenten-Prompt gespiegelt, statt ihn zu raten.
 */
export interface HotelCapabilities {
    reservierungsApi: boolean;
    salesProductId: string | null;
    paymentMethodId: string | null;
    geprueftAm: string;
}

const capabilityCache: Record<string, HotelCapabilities> = {};

export function setCapabilities(hotelId: string, caps: HotelCapabilities) {
    capabilityCache[hotelId] = caps;
}

export function getCapabilities(hotelId: string | null | undefined): HotelCapabilities | null {
    return hotelId ? capabilityCache[hotelId] ?? null : null;
}

/** Fachlich mögliche Aktionen, gefiltert nach dem real gemessenen Zustand. */
export function moeglicheAktionen(caps: HotelCapabilities | null): string[] {
    const immer = [
        "Mitreisenden hinzufügen oder entfernen (addRoomStayGuest / removeRoomStayGuest)",
        "Neuen Gast oder Firma anlegen (createClient)",
        "Metadaten einer Reservierung ändern (updateReservation — Gruppenname, Rechnungsempfänger)",
        "Tatsächlichen Check-in/Check-out setzen, sofern bereits eingecheckt (updateRoomStay)",
    ];
    if (!caps) return immer;
    const zusatz: string[] = [];
    if (caps.salesProductId) zusatz.push("Zusatzleistung auf die Rechnung buchen (createExternalSale)");
    if (caps.paymentMethodId) zusatz.push("Anzahlung verbuchen (createDeposit)");
    if (caps.reservierungsApi) zusatz.push("Neue Buchung anlegen sowie eigene Buchungen ändern/stornieren (importReservation)");
    return [...immer, ...zusatz];
}

/** Was fehlt, um die derzeit gesperrten Aktionen freizuschalten. */
export function fehlendeVoraussetzungen(caps: HotelCapabilities | null): string[] {
    if (!caps) return ["Fähigkeiten für dieses Hotel noch nicht geprüft."];
    const out: string[] = [];
    if (!caps.reservierungsApi)
        out.push("Reservierungs-API ist für diesen Zugang nicht freigeschaltet (ratePlans antwortet mit einem Konfigurationsfehler) — neue Buchungen, Umbuchungen und Stornos über die API sind dadurch unmöglich. Freischaltung muss 3RPMS vornehmen.");
    if (!caps.salesProductId)
        out.push("Kein External-Sales-Produkt vorhanden — createExternalSale ist nicht ausführbar. Einmalig per createExternalSalesProduct anlegen (pro Integration ist genau eines möglich).");
    if (!caps.paymentMethodId)
        out.push("Keine Zahlungsart vorhanden — createDeposit ist nicht ausführbar. Einmalig per createPaymentMethod anlegen (eine pro Integration und Hotel).");
    return out;
}

/** 3RPMS verlangt "Y-m-d\TH:i:sP" — verifiziert am 31.07.2026. */
export const DATETIME_BEISPIEL = "2026-10-25T14:00:00+02:00";

/**
 * Erzeugt den Regelteil für den Action-Agent-Prompt aus genau diesen Daten.
 * Dadurch kann der Prompt nicht mehr vom Schema abweichen — der Fehler, der das
 * ganze Problem verursacht hat.
 */
export function buildCapabilityPrompt(caps: HotelCapabilities | null = null): string {
    const grenzen = NICHT_MOEGLICH
        .map(g => `- **${g.fall}**\n  Grund: ${g.grund}\n  → api_action: "${g.apiAction}", graphql_mutation: "none"`)
        .join("\n");

    const fehlend = fehlendeVoraussetzungen(caps);
    const gesperrt = fehlend.length
        ? `\n## 🔒 In DIESEM Hotel derzeit zusätzlich gesperrt\n${fehlend.map(f => `- ${f}`).join("\n")}\n\nFür diese Aktionen gilt dasselbe wie oben: graphql_mutation "none" und ein Hinweis für den Empfang.\n`
        : "";

    const mutationen = Object.entries(MUTATIONS).map(([name, s]) => {
        const felder = [
            ...s.required.map(f => `${f} (PFLICHT)`),
            ...s.optional,
        ].join(", ") || "keine";
        const c = s.constraints?.length ? "\n  " + s.constraints.map(x => `• ${x}`).join("\n  ") : "";
        return `### ${name}\n  Zweck: ${s.zweck}\n  Erlaubte Felder: ${felder}${c}`;
    }).join("\n\n");

    return `
# 3RPMS-SCHNITTSTELLE — VERBINDLICHE FAKTEN
(Erhoben per Schema-Abfrage der echten API. Diese Angaben sind maßgeblich.)

## ⛔ Diese Wünsche sind technisch UNMÖGLICH
Sage hier NIEMALS zu, die Änderung sei erfolgt. Formuliere freundlich, dass sich der
Empfang darum kümmert, und setze graphql_mutation auf "none":

${grenzen}

Verbotene Formulierungen in diesen Fällen: "wurde geändert", "ist storniert",
"haben wir umgebucht". Erlaubt: "wir kümmern uns darum und melden uns".
${gesperrt}
## ✅ Aktuell tatsächlich ausführbar
${moeglicheAktionen(caps).map(m => `- ${m}`).join("\n")}

## Datumsformat (häufigster Fehler)
Alle Datetime-Felder brauchen einen Zeitzonen-Offset: "${DATETIME_BEISPIEL}".
Ohne Offset lehnt die API die gesamte Mutation ab.
Reine Date-Felder (reservation_from, reservation_to) bleiben "2026-10-25".

## Erlaubte Mutationen und ihre Felder
Erfinde NIEMALS ein Feld, das hier nicht steht — die Mutation wird sonst vor der
Ausführung abgelehnt und der Gast erhält eine Zusage, die nie eingelöst wird.

${mutationen}

## Platzhalter
Setze niemals Platzhalter wie CLIENT_ID, ROOM_STAY_ID oder YYYY-MM-DD ein. Fehlt dir
ein echter Wert aus den PMS-Daten, ist die Aktion nicht automatisch ausführbar:
graphql_mutation: "none" und ein api_action-Hinweis für den Empfang.
`.trim();
}
