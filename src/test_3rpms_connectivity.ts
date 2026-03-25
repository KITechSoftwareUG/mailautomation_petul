import * as dotenv from 'dotenv';

dotenv.config();

const URLS = [
    'https://www.3rpms.de/graphql',
    'https://demo.3rpms.de/graphql'
];

const KEYS = [
    { name: "Hotel an der Zeche", key: process.env.THREE_RPMS_API_KEY_H1 },
    { name: "Hotel Anne 40", key: process.env.THREE_RPMS_API_KEY_H2 },
    { name: "Art Hotel Brunnen", key: process.env.THREE_RPMS_API_KEY_H3 },
    { name: "Aparthotel Residenz", key: process.env.THREE_RPMS_API_KEY_H4 },
    { name: "Apart Hotel Am Ruhrbogen", key: process.env.THREE_RPMS_API_KEY_H5 }
];

async function testConnection(url: string, key: string) {
    // Use room_stays which we know exists
    const query = `
    query {
      room_stays(first: 1) {
        totalCount
      }
    }
  `;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            return { ok: false, message: `HTTP ${response.status}: ${response.statusText}` };
        }

        const result: any = await response.json();
        if (result.errors) {
            return { ok: false, message: result.errors[0].message };
        }
        return { ok: true, count: result.data.room_stays.totalCount };
    } catch (error: any) {
        return { ok: false, message: error.message };
    }
}

async function run() {
    console.log("🚀 Starte 3RPMS API Connectivity Test (RoomStays Query)...\n");

    for (const item of KEYS) {
        if (!item.key) {
            console.log(`⚠️ ${item.name}: Kein Key in .env gefunden.`);
            continue;
        }

        console.log(`--- Teste ${item.name} ---`);
        for (const url of URLS) {
            const res = await testConnection(url, item.key);
            if (res.ok) {
                console.log(`✅ [${url}] ERFOLG: Verbindung steht. (Total RoomStays: ${res.count})`);
            } else {
                console.log(`❌ [${url}] FEHLER: ${res.message}`);
            }
        }
        console.log("");
    }
}

run();
