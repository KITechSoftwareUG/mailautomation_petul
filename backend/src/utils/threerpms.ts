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
  });

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

/**
 * Reservierungen anhand Gast-E-Mail-Adresse suchen.
 * Strategie: room_stays ab heute laden, clientseitig nach first_guest.email filtern.
 * Hinweis: ClientFilter unterstützt kein email-Feld (nur id/birthday/not/or).
 */
export async function searchReservationsByEmail(apiKey: string, email: string) {
  const today = new Date().toISOString().split("T")[0];

  const staysQuery = `
    query GetRoomStaysByDate($filter: RoomStayFilter) {
      room_stays(filter: $filter, first: 50) {
        edges {
          node {
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
          }
        }
      }
    }
  `;

  const staysResult = await query3RPMS<any>(apiKey, staysQuery, {
    filter: { reservation_to: { ge: today } },
  });

  const allStays = staysResult?.room_stays?.edges?.map((e: any) => e.node) || [];
  const roomStays = allStays.filter((s: any) =>
    s.first_guest?.email?.toLowerCase() === email.toLowerCase()
  );

  if (roomStays.length === 0) return null;

  return {
    client: roomStays[0]?.first_guest,
    reservations: [],
    roomStays,
  };
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
