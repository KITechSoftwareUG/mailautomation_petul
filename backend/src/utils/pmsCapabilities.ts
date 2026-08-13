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

import { validateMutation } from "./mutationGuard";

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
    // NICHT für Zusatzleistungen wie Frühstück, Hund oder Parkplatz verwenden.
    // 3RPMS-Support am 12.08.2026 wörtlich: "Die ExternalSales API richtet sich an
    // Registrierkassen, zB. in InHouse Shops oder -Gastronomie. Sie kann nicht zum
    // Aufbuchen von regulären Leistungen verwendet werden."
    // Bleibt in der Whitelist, damit ein bewusster Kassen-Anwendungsfall möglich bliebe —
    // der Action Agent bekommt sie über buildCapabilityPrompt() aber nicht angeboten.
    createExternalSale: {
        zweck: "Registrierkassen-Umsatz aus InHouse-Shop oder Gastronomie verbuchen. NICHT für reguläre Hotelleistungen.",
        required: ["productId", "roomStayId", "amount", "saleCreatedAt", "receiptNumber"],
        optional: ["receiptPdfUrl", "waiterName", "tableName"],
        constraints: [
            "Nur für Registrierkassen-Umsätze (Shop/Gastronomie), nicht für Frühstück, Hund, Parkplatz o. Ä.",
            "Alle fünf Pflichtfelder müssen gesetzt sein.",
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
        grund: "ReservationStatus.CANCELLED existiert, ist aber nur über importReservation erreichbar und setzt die eigene externalId voraus. Vom Hersteller am 12.08.2026 bestätigt: Integrationen können über importReservation ausschließlich Buchungen ändern, die sie selbst erstellt haben.",
        apiAction: "Manuelle Stornierung durch Empfang",
    },
    {
        fall: "Zusatzleistung auf die Rechnung buchen (Frühstück, Hund, Parkplatz)",
        grund: "Es gibt dafür keine Schnittstelle. createExternalSale ist laut Hersteller (12.08.2026) ausschließlich für Registrierkassen in InHouse-Shops und Gastronomie gedacht und ausdrücklich nicht zum Aufbuchen regulärer Leistungen. Über importReservation ginge es nur für selbst angelegte Buchungen und würde die gesamte Reservierung überschreiben.",
        apiAction: "Zusatzleistung manuell buchen (Empfang)",
    },
    {
        fall: "Späten Check-out für einen künftigen Aufenthalt vermerken",
        grund: "check_out bezeichnet die tatsächliche Abreise und ist erst nach dem Check-in setzbar. Der Hersteller empfiehlt einen Vermerk im Notizfeld — die Notizfelder (guestMessage, maidNotes) existieren aber nur in ImportRoomStayInput, also nur beim Anlegen einer eigenen Buchung. Bei fremden Buchungen ist auch das nicht möglich.",
        apiAction: "Late Check-out vormerken (Empfang)",
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

/**
 * Freischaltstand irgendeines gemessenen Hauses. Für die Statusanzeige im Dashboard
 * gedacht: Die Freischaltungen hängen am API-Zugang der Integration, nicht am
 * einzelnen Haus — gemessen am 10.08.2026 waren alle fünf identisch gesperrt.
 * Nötig, weil bei Mails ohne erkanntes Hotel sonst gar kein Stand vorläge und die
 * Anzeige leer bliebe, obwohl die Information vorhanden ist.
 */
export function getAnyCapabilities(): HotelCapabilities | null {
    const werte = Object.values(capabilityCache);
    return werte.length ? werte[0] : null;
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
    // createExternalSale bewusst NICHT aufgeführt: laut Hersteller nur für
    // Registrierkassen, nicht für reguläre Hotelleistungen (s. MUTATIONS-Kommentar).
    if (caps.paymentMethodId) zusatz.push("Anzahlung verbuchen (createDeposit)");
    if (caps.reservierungsApi) zusatz.push("Neue Buchung anlegen sowie eigene Buchungen ändern/stornieren (importReservation)");
    return [...immer, ...zusatz];
}

/** Was fehlt, um die derzeit gesperrten Aktionen freizuschalten. */
export function fehlendeVoraussetzungen(caps: HotelCapabilities | null): string[] {
    if (!caps) return ["Fähigkeiten für dieses Hotel noch nicht geprüft."];
    const out: string[] = [];
    if (!caps.reservierungsApi)
        out.push("Reservierungs-API ist für diesen Zugang nicht freigeschaltet (ratePlans antwortet mit einem Konfigurationsfehler) — neue Buchungen, Umbuchungen und Stornos über die API sind dadurch unmöglich. Die Freischaltung muss 3RPMS je Haus vornehmen.");
    if (!caps.paymentMethodId)
        out.push("Keine Zahlungsart vorhanden — createDeposit ist nicht ausführbar. Einmalig per createPaymentMethod anlegen (eine pro Integration und Hotel).");
    // salesProductId wird bewusst nicht mehr als "fehlende Voraussetzung" gemeldet:
    // Ein Verkaufsprodukt anzulegen brächte nichts, weil createExternalSale laut
    // Hersteller ohnehin nicht für reguläre Hotelleistungen verwendet werden darf.
    // Es als behebbaren Mangel darzustellen, hätte eine Erwartung geweckt, die sich
    // nie erfüllt.
    return out;
}

/** 3RPMS verlangt "Y-m-d\TH:i:sP" — verifiziert am 31.07.2026. */
export const DATETIME_BEISPIEL = "2026-10-25T14:00:00+02:00";

/**
 * Übersetzt den technischen Zustand in eine Anweisung, die die Rezeptionistin ohne
 * Systemkenntnis versteht. Sie steht im Dashboard über dem Entwurf.
 *
 * Der Zweck: Ein Entwurf ohne Systemwirkung sieht aus wie ein Entwurf mit Systemwirkung.
 * Ohne diesen Hinweis müsste die Rezeptionistin bei jeder Mail raten, ob sie danach noch
 * etwas von Hand im 3RPMS erledigen muss — und im Zweifel würde sie es vergessen.
 */
export interface ManuelleAufgabe {
    /** true = das System hat nichts geändert, jemand muss ins PMS. */
    noetig: boolean;
    titel: string;
    /** Warum es nicht automatisch ging — in Alltagssprache. */
    grund: string;
    /** "gesperrt" = freischaltbar, "unmoeglich" = geht grundsätzlich nicht, "keine" = nichts zu tun. */
    art: "gesperrt" | "unmoeglich" | "keine";
}

/**
 * Bewertet für EINE konkrete Mail, was mit dem Wunsch dieses Gastes möglich ist.
 *
 * Wichtig: Grundlage ist die vom Intent Agent erkannte Kategorie, NICHT der Vorschlag
 * des Action Agents. Der schlägt bei einem unmöglichen Wunsch oft gar keine Aktion vor
 * ("none") — dann wäre für die Rezeptionistin nichts zu sehen, obwohl sie genau dann
 * selbst tätig werden muss. Über die Kategorie ist die Aussage verlässlich, weil sie
 * beschreibt, was der GAST will, und nicht, was das Modell für machbar hält.
 *
 * Liefert immer ein Ergebnis — auch "nichts zu tun". Eine ausbleibende Anzeige wäre
 * nicht unterscheidbar von "wurde nicht geprüft".
 */
export type MachbarkeitStatus = "automatisch" | "gesperrt" | "unmoeglich" | "nichts_noetig";

export interface Machbarkeit {
    status: MachbarkeitStatus;
    /** Was der Gast möchte — in einem Halbsatz. */
    wunsch: string;
    /** Was mit diesem Wunsch passiert bzw. was zu tun ist. */
    text: string;
}

export function bewerteMachbarkeit(
    kategorie: string | null | undefined,
    apiAction: string | null | undefined,
    mutation: string | null | undefined,
    caps: HotelCapabilities | null,
): Machbarkeit {
    const kat = (kategorie || "").trim();

    // Maßgeblich ist NICHT, ob das Modell eine Mutation geliefert hat, sondern ob sie
    // tatsächlich ausgeführt werden wird. Geprüft wird deshalb mit derselben Funktion,
    // die processOutbound vor der Ausführung verwendet.
    //
    // Ohne diese Kopplung entstand ein gefährlicher Widerspruch: Eine
    // Lieferanten-Terminavisierung zeigte "läuft automatisch", während die Mutation in
    // Wahrheit leer war und vom Guard abgelehnt wurde. Die Rezeptionistin hätte darauf
    // vertraut, dass etwas passiert — und es wäre nichts passiert.
    // ("null"/"none" als Text kommen vor, weil das Feld im Schema ein String ist.)
    const roh = (mutation || "").trim();
    const hatMutation = roh !== "" && roh !== "none" && roh !== "null" && validateMutation(roh).ok;

    // 1. Wünsche, die die Schnittstelle grundsätzlich nicht abbildet.
    if (kat === "Umbuchung") {
        return {
            status: "unmoeglich",
            wunsch: "Gast möchte seine Buchung ändern (Zeitraum oder Zimmer)",
            text: "Das Hotelsystem bietet dafür keine Schnittstelle an. Bitte die Änderung direkt im 3RPMS vornehmen — die Antwort an den Gast verspricht bewusst nichts Konkretes.",
        };
    }
    if (kat === "Stornierung") {
        return {
            status: "unmoeglich",
            wunsch: "Gast möchte stornieren",
            text: "Stornierungen sind über die Schnittstelle nur für Buchungen möglich, die dieses Programm selbst angelegt hat. Bitte im 3RPMS stornieren.",
        };
    }

    // 2. Wünsche, die an einer Freischaltung hängen.
    if (kat === "Reservierungsanfrage") {
        if (caps && !caps.reservierungsApi) {
            return {
                status: "gesperrt",
                wunsch: "Gast möchte buchen",
                text: "Die Buchung kann noch nicht automatisch eingetragen werden — die Reservierungs-API ist für diesen Zugang nicht freigeschaltet. Bitte im 3RPMS anlegen.",
            };
        }
        return hatMutation
            ? { status: "automatisch", wunsch: "Gast möchte buchen", text: "Die Buchung wird beim Senden automatisch im 3RPMS angelegt." }
            : { status: "nichts_noetig", wunsch: "Anfrage zu einer Buchung", text: "Reine Auskunft — im 3RPMS ist nichts einzutragen." };
    }

    // 3. Konkret vorgeschlagene Aktion des Action Agents prüfen.
    if (hatMutation) {
        const name = mutation!.match(/mutation\s*(?:\w+\s*(?:\([^)]*\))?\s*)?\{\s*(\w+)\s*\(/)?.[1] ?? "";
        // Nicht "gesperrt", sondern dauerhaft unmöglich: Der Hersteller hat am 12.08.2026
        // bestätigt, dass createExternalSale ausschließlich Registrierkassen bedient und
        // nicht zum Aufbuchen regulärer Leistungen verwendet werden darf. Ein Verkaufsprodukt
        // anzulegen würde daran nichts ändern — die Rezeptionistin darf hier also nicht auf
        // eine spätere Freischaltung warten.
        if (name === "createExternalSale") {
            return {
                status: "unmoeglich",
                wunsch: "Zusatzleistung soll auf die Rechnung (z. B. Frühstück, Hund, Parkplatz)",
                text: "Dafür gibt es keine Schnittstelle — die Verkaufs-API des Hotelsystems ist ausschließlich für Registrierkassen gedacht. Bitte im 3RPMS auf die Rechnung setzen.",
            };
        }
        if (name === "createDeposit" && caps && !caps.paymentMethod) {
            return {
                status: "gesperrt",
                wunsch: "Anzahlung soll verbucht werden",
                text: "Kann noch nicht automatisch verbucht werden — dafür fehlt eine Zahlungsart in der Schnittstelle. Bitte im 3RPMS verbuchen.",
            };
        }
        const bezeichnung: Record<string, string> = {
            updateRoomStay: "Check-in-/Check-out-Zeit wird gesetzt",
            createExternalSale: "Zusatzleistung wird auf die Rechnung gebucht",
            createDeposit: "Anzahlung wird verbucht",
            addRoomStayGuest: "Mitreisender wird hinzugefügt",
            removeRoomStayGuest: "Mitreisender wird entfernt",
            createClient: "Gast wird angelegt",
            updateReservation: "Buchungsdaten werden aktualisiert",
            importReservation: "Buchung wird angelegt",
        };
        return {
            status: "automatisch",
            wunsch: bezeichnung[name] ?? "Änderung im Hotelsystem",
            text: "Wird beim Senden automatisch im 3RPMS ausgeführt. Sie müssen nichts nachtragen.",
        };
    }

    // 4. Der Action Agent hat selbst auf Handarbeit verwiesen.
    if (/manuell|empfang|vormerken/i.test(apiAction || "")) {
        const grenze = NICHT_MOEGLICH.find(g => g.apiAction === apiAction);
        return {
            status: "unmoeglich",
            wunsch: apiAction!,
            text: grenze?.grund ?? "Diese Änderung lässt sich über die Schnittstelle nicht ausführen und muss direkt im 3RPMS erfolgen.",
        };
    }

    // 5. Alles Übrige: reine Auskunft.
    const auskunft: Record<string, string> = {
        "Allgemeine Frage": "Frage des Gastes",
        "Beschwerde": "Beschwerde",
        "Rechnungsfrage": "Frage zur Rechnung",
        "Sonstiges": "Sonstiges Anliegen",
    };
    return {
        status: "nichts_noetig",
        wunsch: auskunft[kat] ?? "Anliegen des Gastes",
        text: "Reine Auskunft — im 3RPMS ist nichts einzutragen.",
    };
}

export function beschreibeManuelleAufgabe(
    apiAction: string | null | undefined,
    mutation: string | null | undefined,
    caps: HotelCapabilities | null,
): ManuelleAufgabe {
    const action = (apiAction || "none").trim();
    const hatMutation = !!mutation && mutation !== "none";

    // Der Agent hat selbst erkannt, dass es manuell laufen muss (api_action enthält
    // dann "manuell"/"Empfang"/"vormerken" — s. NICHT_MOEGLICH).
    const istManuell = /manuell|empfang|vormerken/i.test(action);
    if (istManuell) {
        const grenze = NICHT_MOEGLICH.find(g => g.apiAction === action);
        return {
            noetig: true,
            titel: action,
            grund: grenze?.grund
                ?? "Diese Änderung lässt sich über die Schnittstelle nicht ausführen und muss direkt im 3RPMS erfolgen.",
            art: "unmoeglich",
        };
    }

    if (!hatMutation || action === "none") {
        return { noetig: false, titel: "", grund: "", art: "keine" };
    }

    // Es ist eine Mutation geplant — ist sie für dieses Haus überhaupt freigeschaltet?
    const name = mutation!.match(/mutation\s*(?:\w+\s*(?:\([^)]*\))?\s*)?\{\s*(\w+)\s*\(/)?.[1] ?? action;
    if (caps) {
        if (name === "importReservation" && !caps.reservierungsApi) {
            return {
                noetig: true,
                titel: "Buchung manuell im 3RPMS anlegen",
                grund: "Die Reservierungs-API ist für diesen Zugang noch nicht freigeschaltet. Bis 3RPMS sie aktiviert, können Buchungen nicht automatisch eingetragen werden.",
                art: "gesperrt",
            };
        }
        if (name === "createExternalSale" && !caps.salesProductId) {
            return {
                noetig: true,
                titel: "Zusatzleistung manuell auf die Rechnung buchen",
                grund: "Für die automatische Verbuchung fehlt noch ein Verkaufsprodukt in der Schnittstelle. Das ist einmalig einzurichten.",
                art: "gesperrt",
            };
        }
        if (name === "createDeposit" && !caps.paymentMethodId) {
            return {
                noetig: true,
                titel: "Anzahlung manuell verbuchen",
                grund: "Für die automatische Verbuchung fehlt noch eine Zahlungsart in der Schnittstelle. Das ist einmalig einzurichten.",
                art: "gesperrt",
            };
        }
    }

    return { noetig: false, titel: "", grund: "", art: "keine" };
}

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
