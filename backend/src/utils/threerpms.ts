import dotenv from 'dotenv';

dotenv.config();

const THREE_RPMS_URL = process.env.THREE_RPMS_URL || 'https://www.3rpms.de/graphql';

export interface ThreeRPMSResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { category: string } }>;
}

export const HOTELS = [
  { id: "H1", name: "Hotel Petul \"An der Zeche\"", email: "an-der-zeche@petul.de", keywords: ["zeche", "an-der-zeche", "petul-zeche"], key: process.env.THREE_RPMS_API_KEY_H1 },
  { id: "H2", name: "Hotel Apart \"An'ne 40\"",     email: "anne-40@petul.de",       keywords: ["anne40", "anne 40", "anne-40"],           key: process.env.THREE_RPMS_API_KEY_H2 },
  { id: "H3", name: "Hotel Apart \"Residenz\"",     email: "residenz@petul.de",      keywords: ["residenz"],                               key: process.env.THREE_RPMS_API_KEY_H4 },
  { id: "H4", name: "Hotel Apart \"Am Ruhrbogen\"", email: "am-ruhrbogen@petul.de",  keywords: ["ruhrbogen"],                              key: process.env.THREE_RPMS_API_KEY_H5 },
  { id: "H5", name: "Art Hotel Brunnen",             email: "brunnen@petul.de",       keywords: ["brunnen"],                                key: process.env.THREE_RPMS_API_KEY_H3 },
];

export function identifyHotel(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null) {
  // 1. Deterministisch: exakter E-Mail-Match gegen X-Original-To Header
  const forwardLower = forwardTarget.toLowerCase().trim();
  if (forwardLower) {
    const emailMatch = HOTELS.find(h => h.email && forwardLower.includes(h.email));
    if (emailMatch) return emailMatch;
  }

  // 2. Fallback: AI-identifiziertes Hotel
  if (aiIdentifiedHotel) {
    const normalizedAi = aiIdentifiedHotel.toLowerCase();
    const aiMatch = HOTELS.find(h =>
      normalizedAi.includes(h.name.toLowerCase()) ||
      h.keywords.some(kw => normalizedAi.includes(kw))
    );
    if (aiMatch) return aiMatch;
  }

  // 3. Fallback: Keyword-Suche in Empfänger-Adresse
  const searchString = (recipientEmail + " " + forwardTarget).toLowerCase().trim();
  for (const hotel of HOTELS) {
    if (hotel.keywords.some(kw => searchString.includes(kw))) {
      return hotel;
    }
  }

  return null;
}

export function getApiKeyForHotel(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null): string {
  return identifyHotel(recipientEmail, forwardTarget, aiIdentifiedHotel)?.key || "";
}

export function resolveHotelName(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null): string {
  const hotel = identifyHotel(recipientEmail, forwardTarget, aiIdentifiedHotel);
  return hotel?.name || "Unbekannt / Petul";
}

// Ohne Timeout blockiert ein halb offener Socket (der klassische Teilausfall: TCP wird
// angenommen, es kommt nur nie eine Antwort) den gesamten Aufrufer. Konkret hing damit
// watchNewMails bis zu 25 Minuten fest — 5 Mails sequenziell × undici-Default von 5 Min.
// Für die Rezeptionistin sah das aus wie ein totes Dashboard.
const REQUEST_TIMEOUT_MS = 15000;

export async function query3RPMS<T>(apiKey: string, query: string, variables: any = {}): Promise<T> {
  if (!apiKey) {
    throw new Error("Missing 3RPMS API Key for this hotel. Please check your .env settings.");
  }

  const response = await fetch(THREE_RPMS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept-Language': 'de',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // Der Status wurde bisher nie geprüft. Bei einem 502 mit HTML-Body warf erst
  // response.json() einen SyntaxError — eine irreführende Fehlermeldung, die den
  // eigentlichen Grund (3RPMS ist down) verschleierte.
  if (!response.ok) {
    throw new Error(`3RPMS HTTP ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as ThreeRPMSResponse<T>;

  if (result.errors) {
    console.error("3RPMS GraphQL Errors:", JSON.stringify(result.errors, null, 2));
    throw new Error(`3RPMS API Error: ${result.errors[0].message}`);
  }

  return result.data!;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getRoomStays(apiKey: string, filter: any = {}) {
  const query = `
    query GetRoomStays($filter: RoomStayFilter) {
      room_stays(filter: $filter, first: 10) {
        edges {
          node {
            id
            reservation_from
            reservation_to
            roomName
            check_in
            check_out
            selfcheckout_enabled
            selfcheckout_url
            gross
            mealNotes
            maidNotes
            guestMessage
            rateCode
            first_guest {
              id
              firstname
              lastname
              email
              telephone
              mobile
            }
            guests {
              edges {
                node {
                  ... on Person {
                    id
                    firstname
                    lastname
                    email
                  }
                  ... on Company {
                    id
                    company
                    email
                  }
                }
              }
            }
            category {
              id
              name
            }
            reservation {
              id
              code
              status
              selfcheckinStatus
              reservationFrom
              reservationTo
              totalAmount
              openAmount
              groupName
            }
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query, { filter });
}

/**
 * Reservierung anhand Buchungs-Code suchen.
 * Gibt vollständige Reservierungsdaten inkl. aller Zimmeraufenthalte und Gästedaten zurück.
 */
export async function getReservationByCode(apiKey: string, code: string) {
  // Nested field auf Reservation heißt "rooms" (nicht roomStays/room_stays).
  const query = `
    query GetReservation($code: String!) {
      reservations(filter: { code: { eq: $code } }, first: 1) {
        edges {
          node {
            id
            code
            status
            client {
              id
              ... on Person {
                firstname
                lastname
                email
                telephone
                mobile
              }
              ... on Company {
                email
                telephone
              }
            }
            rooms {
              edges {
                node {
                  id
                  reservation_from
                  reservation_to
                  roomName
                  gross
                  check_in
                  check_out
                  selfcheckout_enabled
                  selfcheckout_url
                  mealNotes
                  guestMessage
                  rateCode
                  first_guest {
                    id
                    firstname
                    lastname
                    email
                    telephone
                    mobile
                  }
                  category {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query, { code });
}

// 3RPMS lehnt jedes `first` über 100 ab ("First darf nicht größer als 100 sein."),
// liefert aber pageInfo.hasNextPage/endCursor — geblättert wird also, statt die Liste
// stillschweigend abzuschneiden.
const ROOM_STAY_PAGE_SIZE = 100;

// Notbremse gegen eine endlose Cursor-Schleife bei einem fehlerhaften hasNextPage.
// 3000 Aufenthalte liegen weit über dem, was eines der Häuser in 180 Tagen erzeugt
// (Messung 04.08.2026: größtes Haus 751), sind also nie im Normalbetrieb erreichbar.
const ROOM_STAY_MAX_PAGES = 30;

// Rückblickfenster der Gastsuche. Nur kommende Aufenthalte zu durchsuchen macht jede
// Rechnungs- oder Nachfrage zu einem bereits beendeten Aufenthalt unauffindbar — der
// Gast ist abgereist, seine Buchung fällt aus dem Filter, und die Pipeline meldete
// "Kein Gast gefunden" (belegt u.a. an "Rechnung zu Reservierung vom 21.07.–22.07.").
const ROOM_STAY_LOOKBACK_DAYS = 180;

const ROOM_STAY_FIELDS = `
  id
  reservation_from
  reservation_to
  roomName
  gross
  check_in
  check_out
  mealNotes
  guestMessage
  rateCode
  first_guest {
    id
    firstname
    lastname
    email
    telephone
    mobile
  }
  category { id name }
  reservation { id code status }
`;

// Für den reinen "kennt dieses Haus den Gast?"-Scan reicht die Mailadresse. Der volle
// Feldsatz über alle fünf Häuser wären rund 2 MB pro Mail — und damit der Grund, warum
// eine parallele Suche über alle Häuser in den 15-Sekunden-Timeout lief.
const ROOM_STAY_EMAIL_ONLY_FIELDS = `
  id
  first_guest { email }
`;

// Blättern heißt: aus einer Anfrage pro Gastsuche werden bis zu acht, und bei der
// hausübergreifenden Suche bis zu vierzig. 3RPMS sperrt die aufrufende IP auf
// TCP-Ebene, wenn zu viele Anfragen in kurzer Folge eintreffen (am 04.08.2026 bei
// einem Testlauf ausgelöst und verifiziert: ICMP antwortete weiter, Port 443 nicht
// mehr). Die Aufenthaltsliste eines Hauses ändert sich im Minutentakt praktisch nie,
// die gesuchten Buchungen sind Tage bis Wochen alt — ein kurzer Zwischenspeicher
// kostet also keine Aktualität und nimmt die Last vollständig heraus, sobald mehrere
// Mails hintereinander laufen (der Normalfall bei sequenzieller Verarbeitung).
const ROOM_STAY_CACHE_TTL_MS = 120_000;

const roomStayCache = new Map<string, { at: number; value: { stays: any[]; truncated: boolean; pages: number } }>();

function pruneRoomStayCache(now: number) {
  for (const [key, entry] of roomStayCache) {
    if (now - entry.at >= ROOM_STAY_CACHE_TTL_MS) roomStayCache.delete(key);
  }
}

/**
 * Alle room_stays zu einem Filter laden — über alle Seiten hinweg.
 * `truncated` meldet, ob die Sicherheitsgrenze griff, die Liste also unvollständig ist.
 */
async function fetchAllRoomStays(
  apiKey: string,
  filter: any,
  fields: string = ROOM_STAY_FIELDS,
): Promise<{ stays: any[]; truncated: boolean; pages: number }> {
  const now = Date.now();
  // Der Schlüssel enthält den API-Key, weil er das Haus bestimmt — ein Cache-Treffer
  // aus einem anderen Haus wäre eine falsche Gastauskunft.
  const cacheKey = `${apiKey}|${fields}|${JSON.stringify(filter)}`;
  const cached = roomStayCache.get(cacheKey);
  if (cached && now - cached.at < ROOM_STAY_CACHE_TTL_MS) {
    return cached.value;
  }
  pruneRoomStayCache(now);
  const query = `
    query GetRoomStaysPaged($filter: RoomStayFilter, $first: Int!, $after: String) {
      room_stays(filter: $filter, first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {${fields}}
        }
      }
    }
  `;

  const stays: any[] = [];
  let after: string | null = null;
  let pages = 0;

  const finish = (truncated: boolean) => {
    const value = { stays, truncated, pages };
    roomStayCache.set(cacheKey, { at: Date.now(), value });
    return value;
  };

  while (pages < ROOM_STAY_MAX_PAGES) {
    const result: any = await query3RPMS<any>(apiKey, query, {
      filter,
      first: ROOM_STAY_PAGE_SIZE,
      after,
    });
    const connection = result?.room_stays;
    const edges = connection?.edges || [];
    stays.push(...edges.map((e: any) => e.node));
    pages++;

    if (!connection?.pageInfo?.hasNextPage) {
      return finish(false);
    }
    // Ohne Cursor-Fortschritt liefe die Schleife auf derselben Seite weiter.
    const nextCursor = connection.pageInfo.endCursor;
    if (!nextCursor || nextCursor === after) {
      return finish(false);
    }
    after = nextCursor;
  }

  return finish(true);
}

/**
 * Reservierungen anhand Gast-E-Mail-Adresse suchen.
 * Strategie: room_stays im Zeitfenster laden (geblättert), clientseitig nach
 * first_guest.email filtern.
 * Hinweis: ClientFilter unterstützt kein email-Feld (nur id/birthday/not/or).
 */
export async function searchReservationsByEmail(apiKey: string, email: string) {
  const today = new Date().toISOString().split("T")[0];
  const lookbackFrom = new Date(Date.now() - ROOM_STAY_LOOKBACK_DAYS * 86400_000)
    .toISOString()
    .split("T")[0];

  const { stays: allStays, truncated } = await fetchAllRoomStays(apiKey, {
    reservation_to: { ge: lookbackFrom },
  });

  const roomStays = allStays.filter((s: any) =>
    s.first_guest?.email?.toLowerCase() === email.toLowerCase()
  );

  if (roomStays.length === 0) {
    // "Nicht gefunden" ist nur verlässlich, wenn der Suchraum vollständig war. Wurde
    // die Blätterung von der Sicherheitsgrenze gestoppt, kann der Gast dahinter liegen
    // — dann ist ein ehrlicher Fehler richtiger als ein falsches "gibt es nicht".
    if (truncated) {
      throw new Error(
        `Gastsuche unvollständig: Das Hotel hat mehr als ${ROOM_STAY_PAGE_SIZE * ROOM_STAY_MAX_PAGES} ` +
        "Aufenthalte im Suchzeitraum, die Suche wurde abgebrochen. Bitte manuell im 3RPMS prüfen."
      );
    }
    return null;
  }

  // Die 3RPMS-Query liefert unsortiert, wodurch roomStays[0] — das, was das Dashboard
  // anzeigt und was der Action Agent zuerst liest — ein beliebiger Treffer war.
  // Reihenfolge jetzt: laufende und kommende Aufenthalte zuerst (der nächstliegende
  // vorn), erst danach die bereits beendeten (der jüngste vorn). Ohne diese Trennung
  // stünde nach Einführung des Rückblickfensters ein ein halbes Jahr alter Aufenthalt
  // vor der Buchung, um die es gerade geht.
  const isCurrent = (s: any) => String(s.reservation_to || "") >= today;
  roomStays.sort((a: any, b: any) => {
    const aCurrent = isCurrent(a), bCurrent = isCurrent(b);
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
    const af = String(a.reservation_from || ""), bf = String(b.reservation_from || "");
    return aCurrent ? af.localeCompare(bf) : bf.localeCompare(af);
  });

  // Mehrere Treffer auf dieselbe Adresse: typisch bei Firmenbuchungen, wo alle Zimmer
  // auf buchung@firma.de laufen. Ohne diesen Hinweis nannte der Entwurf Zimmer, Datum
  // und Preis irgendeiner dieser Buchungen — also womöglich die eines Kollegen.
  // Gezählt wird nur innerhalb der aktuellen Gruppe: ein abgeschlossener Aufenthalt
  // neben einer kommenden Buchung ist keine Mehrdeutigkeit, sondern schlicht Historie.
  const currentStays = roomStays.filter(isCurrent);
  const relevantStays = currentStays.length > 0 ? currentStays : roomStays;
  const distinctGuests = new Set(
    relevantStays.map((s: any) => `${s.first_guest?.firstname || ""} ${s.first_guest?.lastname || ""}`.trim().toLowerCase())
  );
  const ambiguous = relevantStays.length > 1;

  return {
    client: roomStays[0]?.first_guest,
    reservations: [],
    roomStays,
    pastStayCount: roomStays.length - currentStays.length,
    ambiguous,
    ambiguityReason: ambiguous
      ? `${relevantStays.length} ${currentStays.length > 0 ? "aktuelle bzw. kommende " : "vergangene "}Aufenthalte auf diese E-Mail-Adresse${distinctGuests.size > 1 ? ` (${distinctGuests.size} verschiedene Namen — vermutlich Firmenbuchung)` : ""}. Zuordnung bitte manuell prüfen.`
      : null,
  };
}

export type GuestHotelMatch = {
  hotel: typeof HOTELS[number];
  data: NonNullable<Awaited<ReturnType<typeof searchReservationsByEmail>>>;
};

/**
 * Gast-E-Mail in ALLEN Häusern suchen — Notnagel für Mails an die Sammeladresse
 * info@petul.de, bei denen weder Header noch Text ein Haus nennen.
 *
 * Ergebnis nur, wenn genau EIN Haus den Gast kennt UND alle fünf Häuser fehlerfrei
 * durchsucht wurden. Zwei Häuser mit demselben Gast heißt: nicht entscheidbar — dann
 * lieber gar keine PMS-Daten als die des falschen Hauses (der Entwurf nennt sonst
 * Zimmer und Preis einer fremden Buchung). Genauso bei einem Suchfehler: hätte das
 * übersprungene Haus ebenfalls einen Treffer gehabt, wäre die Zuordnung falsch, sähe
 * aber eindeutig aus.
 *
 * Läuft bewusst sequenziell und mit schlankem Feldsatz: parallel über fünf Häuser
 * waren es bis zu 40 gleichzeitige Anfragen mit ~2 MB Nutzlast, die reproduzierbar in
 * den 15-Sekunden-Timeout liefen — die Suche meldete dann "kein Treffer", obwohl der
 * Gast existierte.
 */
export async function findHotelByGuestEmail(email: string): Promise<GuestHotelMatch | null> {
  if (!email) return null;
  const needle = email.toLowerCase();
  const lookbackFrom = new Date(Date.now() - ROOM_STAY_LOOKBACK_DAYS * 86400_000)
    .toISOString()
    .split("T")[0];

  const matches: typeof HOTELS[number][] = [];

  for (const hotel of HOTELS) {
    if (!hotel.key) {
      console.warn(`   ⚠️  [3RPMS] Hausübergreifende Suche: kein API-Key für ${hotel.id} — Ergebnis nicht verlässlich.`);
      return null;
    }
    try {
      const { stays, truncated } = await fetchAllRoomStays(
        hotel.key,
        { reservation_to: { ge: lookbackFrom } },
        ROOM_STAY_EMAIL_ONLY_FIELDS,
      );
      if (truncated) {
        console.warn(`   ⚠️  [3RPMS] Hausübergreifende Suche: ${hotel.id} unvollständig geladen — Ergebnis nicht verlässlich.`);
        return null;
      }
      if (stays.some((s: any) => s.first_guest?.email?.toLowerCase() === needle)) {
        matches.push(hotel);
      }
    } catch (err: any) {
      console.warn(`   ⚠️  [3RPMS] Hausübergreifende Suche: ${hotel.id} nicht durchsuchbar (${err.message}) — Ergebnis nicht verlässlich.`);
      return null;
    }
  }

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.log(`   ℹ️  Gast in ${matches.length} Häusern gefunden (${matches.map(h => h.id).join(", ")}) — nicht eindeutig zuzuordnen.`);
    }
    return null;
  }

  // Erst jetzt die vollen Aufenthaltsdaten holen — für genau ein Haus statt für fünf.
  const hotel = matches[0];
  const data = await searchReservationsByEmail(hotel.key!, email);
  return data ? { hotel, data } : null;
}

/**
 * Verfügbarkeit für einen Zeitraum prüfen.
 * Filter: { period: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }, categories: ["id1", "id2"] }
 * Gibt available (freie Zimmer) und occupied (belegte Zimmer) zurück.
 */
export async function getInventory(apiKey: string, start: string, end: string, categoryIds?: string[]) {
  const query = `
    query GetInventory($filter: InventoryFilter!) {
      inventory(filter: $filter) {
        available {
          edges {
            node {
              id
              name
              category {
                id
                name
              }
            }
          }
        }
        occupied {
          edges {
            node {
              id
              name
              category {
                id
                name
              }
            }
          }
        }
        booked {
          edges {
            node {
              id
              name
              category {
                id
                name
              }
            }
          }
        }
      }
    }
  `;
  const filter: any = { period: { start, end } };
  if (categoryIds && categoryIds.length > 0) filter.categories = categoryIds;
  return query3RPMS<any>(apiKey, query, { filter });
}

/**
 * Zimmerkategorien und physische Zimmer laden (für Kontext-Aufbau).
 * Kein Produkt-Katalog — Produkte sind unter externalSalesProducts.
 */
export async function getHotelSettings(apiKey: string) {
  const query = `
    query GetSettings {
      settings {
        categories(first: 50) {
          edges {
            node {
              id
              name
              description
            }
          }
        }
        roomSetups(first: 100) {
          edges {
            node {
              id
              name
              cleaningStatus
              category {
                id
                name
              }
            }
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query);
}

/**
 * Misst, welche Schreibaktionen für DIESEN Zugang tatsächlich freigeschaltet sind.
 *
 * Das Schema allein sagt darüber nichts: Am 05.08.2026 kannte es importReservation,
 * createExternalSale und createDeposit — ausführbar war keine davon, weil die
 * Reservierungs-API für den Zugang nicht aktiviert war und weder ein Verkaufsprodukt
 * noch eine Zahlungsart existierte. Ohne diese Messung würde der Action Agent Aktionen
 * zusagen, die garantiert scheitern.
 *
 * Drei Queries, sequenziell — 3RPMS sperrt die IP bei zu vielen Anfragen in kurzer Folge.
 */
export async function probeCapabilities(apiKey: string) {
  const result = {
    reservierungsApi: false,
    salesProductId: null as string | null,
    paymentMethodId: null as string | null,
    geprueftAm: new Date().toISOString(),
  };

  // ratePlans ist der verlässliche Indikator: importReservation verlangt einen rateCode
  // von dort. Ist die Reservierungs-API nicht aktiviert, antwortet die Query mit einem
  // Konfigurationsfehler statt mit Daten.
  try {
    await query3RPMS<any>(apiKey, `query { ratePlans(first:1){ edges { node { code } } } }`);
    result.reservierungsApi = true;
  } catch {
    result.reservierungsApi = false;
  }

  try {
    const p = await query3RPMS<any>(apiKey, `query { externalSalesProducts(first:1){ edges { node { id name } } } }`);
    result.salesProductId = p?.externalSalesProducts?.edges?.[0]?.node?.id ?? null;
  } catch { /* bleibt null — Aktion gilt als gesperrt */ }

  try {
    const m = await query3RPMS<any>(apiKey, `query { paymentMethods(first:1){ edges { node { id name } } } }`);
    result.paymentMethodId = m?.paymentMethods?.edges?.[0]?.node?.id ?? null;
  } catch { /* bleibt null */ }

  return result;
}

/**
 * Unsere Integration's External Sales Produkte laden.
 * Diese Produkt-IDs werden für createExternalSale benötigt.
 */
export async function getExternalSalesProducts(apiKey: string) {
  const query = `
    query GetExternalSalesProducts {
      externalSalesProducts(first: 20) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query);
}

/**
 * Clients nach E-Mail oder Name suchen.
 * Verwendet korrekte GraphQL Inline Fragments für Person/Company Union Type.
 */
export async function searchClients(apiKey: string, filter: any = {}) {
  const query = `
    query SearchClients($filter: ClientFilter) {
      clients(filter: $filter, first: 10) {
        edges {
          node {
            id
            ... on Person {
              firstname
              lastname
              email
              telephone
              mobile
              language { code }
              stayPreferences
              mealPreferences
            }
            ... on Company {
              company
              email
              telephone
            }
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query, { filter });
}

// ─── Typed Mutations ──────────────────────────────────────────────────────────

/**
 * Check-in / Check-out Zeit eines Zimmeraufenthalts ändern (Early Check-in / Late Check-out).
 * check_in und check_out sind ISO Datetime-Strings (z.B. "2025-06-01T15:00:00").
 */
export async function updateCheckInOut(apiKey: string, roomStayId: string, checkIn?: string, checkOut?: string) {
  const mutation = `
    mutation UpdateRoomStay($id: ID!, $check_in: Datetime, $check_out: Datetime) {
      updateRoomStay(input: { id: $id, check_in: $check_in, check_out: $check_out }) {
        roomStay {
          id
          check_in
          check_out
        }
        errors {
          message
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, { id: roomStayId, check_in: checkIn ?? null, check_out: checkOut ?? null });
}

/**
 * Gast zu einem Zimmeraufenthalt hinzufügen.
 * clientId muss eine existierende Client-ID aus 3RPMS sein.
 */
export async function addGuestToRoomStay(apiKey: string, roomStayId: string, clientId: string) {
  const mutation = `
    mutation AddRoomStayGuest($roomStayId: ID!, $clientId: ID!) {
      addRoomStayGuest(input: { roomStayId: $roomStayId, clientId: $clientId }) {
        roomStay {
          id
          guests {
            edges {
              node {
                ... on Person { firstname lastname }
                ... on Company { name }
              }
            }
          }
        }
        errors {
          message
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, { roomStayId, clientId });
}

/**
 * Anzahlung auf eine Reservierung buchen.
 * paymentMethodId muss eine ID aus getPaymentMethods() sein.
 */
export async function createDeposit(apiKey: string, reservationId: string, paymentMethodId: string, amount: number) {
  const mutation = `
    mutation CreateDeposit($input: CreateDepositInput!) {
      createDeposit(input: $input) {
        incomingPayment {
          id
          amount
          createdAt
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, {
    input: {
      reservationId,
      paymentMethodId,
      amount,
    },
  });
}

/**
 * Externe Zusatzleistung auf ein Zimmer buchen (z.B. Frühstück, Hund, Parkplatz).
 * VORAUSSETZUNG: productId muss aus getExternalSalesProducts() stammen.
 */
export async function bookExtraService(
  apiKey: string,
  roomStayId: string,
  productId: string,
  amount: number,
  receiptNumber?: string
) {
  const mutation = `
    mutation CreateExternalSale($input: CreateExternalSaleInput!) {
      createExternalSale(input: $input) {
        sale {
          id
        }
        errors {
          message
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, {
    input: {
      productId,
      roomStayId,
      amount,
      saleCreatedAt: new Date().toISOString(),
      receiptNumber: receiptNumber || `REC-${Date.now()}`,
    },
  });
}

/**
 * Einmaliges Setup: Externes Verkaufsprodukt für unsere Integration anlegen.
 * Pro Integration kann nur ein Produkt erstellt werden.
 * Nach Erstellung die ID in der .env speichern als THREE_RPMS_PRODUCT_ID_H1 usw.
 */
export async function createExternalSalesProduct(apiKey: string, name: string) {
  const mutation = `
    mutation CreateExternalSalesProduct($name: String!) {
      createExternalSalesProduct(input: { name: $name }) {
        externalSalesProduct {
          id
          name
        }
        errors {
          message
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, { name });
}

/**
 * Reservation importieren / aktualisieren.
 * Stornierungen nur für Reservierungen, die über unsere Integration importiert wurden.
 */
export async function importReservation(apiKey: string, input: {
  externalId: string;
  client: { id?: string; email?: string; firstname?: string; lastname?: string };
  roomStays: Array<{ categoryId: string; from: string; to: string; amount: number }>;
}) {
  const mutation = `
    mutation ImportReservation($input: ImportReservationInput!) {
      importReservation(input: $input) {
        reservation {
          id
          code
          status
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, mutation, { input });
}
