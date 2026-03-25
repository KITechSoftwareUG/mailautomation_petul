import dotenv from 'dotenv';

dotenv.config();

const THREE_RPMS_URL = process.env.THREE_RPMS_URL || 'https://www.3rpms.de/graphql';

export interface ThreeRPMSResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { category: string } }>;
}

export const HOTELS = [
  { id: "H1", name: "Hotel an der Zeche", keywords: ["zeche", "petul.de"], key: process.env.THREE_RPMS_API_KEY_H1 },
  { id: "H2", name: "Hotel Anne 40", keywords: ["anne40"], key: process.env.THREE_RPMS_API_KEY_H2 },
  { id: "H3", name: "Art Hotel Brunnen", keywords: ["brunnen"], key: process.env.THREE_RPMS_API_KEY_H3 },
  { id: "H4", name: "Aparthotel Residenz", keywords: ["residenz"], key: process.env.THREE_RPMS_API_KEY_H4 },
  { id: "H5", name: "Apart Hotel Am Ruhrbogen", keywords: ["ruhrbogen"], key: process.env.THREE_RPMS_API_KEY_H5 },
];

/**
 * Returns the best matching hotel object based on various identifiers.
 */
export function identifyHotel(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null) {
  const searchString = (recipientEmail + " " + forwardTarget + " " + (aiIdentifiedHotel || "")).toLowerCase().trim();

  for (const hotel of HOTELS) {
    if (hotel.keywords.some(kw => searchString.includes(kw))) {
      return hotel;
    }
  }

  // Fallback to H1 (Zeche) if it's info@petul.de or nothing else matches
  return HOTELS[0];
}

/**
 * Legacy wrapper for getApiKeyForHotel
 */
export function getApiKeyForHotel(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null): string {
  return identifyHotel(recipientEmail, forwardTarget, aiIdentifiedHotel).key || "";
}

/**
 * Legacy wrapper for resolveHotelName
 */
export function resolveHotelName(recipientEmail: string, forwardTarget: string = "", aiIdentifiedHotel: string | null = null): string {
  const hotel = identifyHotel(recipientEmail, forwardTarget, aiIdentifiedHotel);
  // If we matched something definitive, return its name. 
  // If it's just the fallback because nothing matched, we might still want to say "Unbekannt" 
  // BUT the user wants to see what's happening.

  const searchString = (recipientEmail + " " + forwardTarget + " " + (aiIdentifiedHotel || "")).toLowerCase().trim();
  const foundDefinitive = HOTELS.some(h => h.keywords.some(kw => searchString.includes(kw)));

  return foundDefinitive ? hotel.name : "Unbekannt / Petul";
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
      'Accept-Language': 'de', // Default to German
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  const result = (await response.json()) as ThreeRPMSResponse<T>;

  if (result.errors) {
    console.error("3RPMS GraphQL Errors:", JSON.stringify(result.errors, null, 2));
    throw new Error(`3RPMS API Error: ${result.errors[0].message}`);
  }

  return result.data!;
}

/**
 * Example: Get Room Stays for a specific date range or ID
 */
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
            status: reservationStatus
            first_guest {
              firstname
              lastname
              email
            }
            reservation {
              code
            }
          }
        }
      }
    }
  `;
  return query3RPMS<any>(apiKey, query, { filter });
}

/**
 * Example: Get Reservation details by code
 */
export async function getReservationByCode(apiKey: string, code: string) {
  const query = `
    query GetReservation($code: String!) {
      reservations(filter: { code: { eq: $code } }, first: 1) {
        edges {
          node {
            id
            code
            status
            totalAmount
            openAmount
            rooms {
              edges {
                node {
                  id
                  reservation_from
                  reservation_to
                  roomName
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
