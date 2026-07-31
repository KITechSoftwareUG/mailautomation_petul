import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Zugangslogik des Dashboards — server-only (proxy.ts, Route Handler, Server Actions).
// NIEMALS aus einer "use client"-Datei importieren: hier stecken Service-Role-Key,
// Passwort-Hash und Session-Geheimnis.
//
// Quelle der Wahrheit ist die Supabase-Tabelle `dashboard_auth` (Migration:
// backend/supabase_migration_dashboard_auth.sql). Solange die noch nicht angelegt/befüllt ist,
// gelten wie bisher DASHBOARD_PASSWORD + SESSION_SECRET aus der Umgebung; der erste Login
// überführt sie automatisch in die Tabelle (siehe seedFromEnv).
//
// Der DB-Zugriff läuft hier absichtlich über einen schlanken PostgREST-fetch statt über
// supabase-js: utils/supabase/server.ts wirft beim Import, wenn Env-Vars fehlen — im Proxy
// (läuft vor JEDEM Request) wäre das ein harter Absturz statt eines Redirects auf /login.

const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number },
) => Promise<Buffer>;

export const SESSION_COOKIE = "petul-session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage
export const MIN_PASSWORD_LENGTH = 10;

// 128 * N * r = ~16 MB Speicher pro Hash — bleibt unter Nodes maxmem-Default von 32 MB.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type AuthState =
    | { kind: "db"; passwordHash: string; sessionToken: string }
    | { kind: "env"; password: string; sessionToken: string };

// ─── Passwort-Hashing ────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [algo, n, r, p, saltHex, hashHex] = stored.split("$");
    if (algo !== "scrypt" || !saltHex || !hashHex) return false;

    const expected = Buffer.from(hashHex, "hex");
    const derived = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltHex, "hex"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return timingSafeEqual(derived, expected);
}

// Vergleich in konstanter Zeit. Beide Seiten werden vorher gehasht, damit auch die
// Länge des Geheimnisses nicht über die Laufzeit durchsickert.
function constantTimeEquals(a: string, b: string): boolean {
    const hashA = createHash("sha256").update(a, "utf8").digest();
    const hashB = createHash("sha256").update(b, "utf8").digest();
    return timingSafeEqual(hashA, hashB);
}

// ─── Zustand laden (mit Cache) ───────────────────────────────────────────────────

// Der Proxy läuft vor jedem Request — ohne Cache wäre das ein Supabase-Query pro
// Seitenaufruf. Die Zeile ist zwar winzig, aber das Projekt hatte bereits einen
// Egress-Überlauf; 30 s Cache drücken das auf ~2 Queries/Minute pro Instanz.
// Nur eine Optimierung: die Logik funktioniert auch, wenn der Cache nie greift
// (Next.js garantiert für Proxy-Instanzen keinen geteilten Modul-Zustand).
const CACHE_TTL_MS = 30_000;
let cache: { state: AuthState; at: number } | null = null;

function invalidateCache() {
    cache = null;
}

function envState(): AuthState | null {
    const password = process.env.DASHBOARD_PASSWORD;
    const sessionToken = process.env.SESSION_SECRET;
    if (!password || !sessionToken) return null;
    return { kind: "env", password, sessionToken };
}

type FetchResult = { ok: true; row: { password_hash: string; session_token: string } | null } | { ok: false };

async function fetchAuthRow(): Promise<FetchResult> {
    if (!SUPABASE_URL || !SERVICE_KEY) return { ok: false };

    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/dashboard_auth?id=eq.default&select=password_hash,session_token`,
            {
                headers: {
                    apikey: SERVICE_KEY,
                    Authorization: `Bearer ${SERVICE_KEY}`,
                    Accept: "application/json",
                },
                cache: "no-store",
            },
        );

        // 404 = Tabelle existiert nicht → Migration noch nicht ausgeführt. Das ist kein
        // Fehler, sondern der dokumentierte Env-Fallback.
        if (res.status === 404) return { ok: true, row: null };
        if (!res.ok) return { ok: false };

        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (!row?.password_hash || !row?.session_token) return { ok: true, row: null };
        return { ok: true, row };
    } catch {
        return { ok: false };
    }
}

async function getAuthState(): Promise<AuthState | null> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.state;

    const result = await fetchAuthRow();

    if (!result.ok) {
        // Supabase nicht erreichbar (Netzwerkfehler, Egress-Sperre): den zuletzt bekannten
        // Stand weiterverwenden, statt bei jedem Schluckauf alle Rezeptionistinnen
        // auszusperren. Ist auch der nicht da, wird der Zugriff verweigert (fail closed) —
        // ohne Supabase ist das Dashboard ohnehin funktionslos.
        return cache?.state ?? null;
    }

    const state = result.row
        ? ({ kind: "db", passwordHash: result.row.password_hash, sessionToken: result.row.session_token } as const)
        : envState();

    if (state) cache = { state, at: now };
    return state;
}

// ─── Session-Prüfung ─────────────────────────────────────────────────────────────

export async function isValidSession(token: string | undefined | null): Promise<boolean> {
    if (!token) return false;
    const state = await getAuthState();
    if (!state) return false;
    return constantTimeEquals(token, state.sessionToken);
}

// ─── Login ───────────────────────────────────────────────────────────────────────

// Erstanmeldung nach der Migration: Env-Passwort einmalig als Hash in die Tabelle
// überführen. Der SESSION_SECRET wird dabei als session_token übernommen, damit
// bestehende Cookies gültig bleiben und niemand mitten im Betrieb rausfliegt.
async function seedFromEnv(password: string): Promise<void> {
    const sessionToken = process.env.SESSION_SECRET;
    if (!SUPABASE_URL || !SERVICE_KEY || !sessionToken) return;

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_auth`, {
            method: "POST",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
                // ignore-duplicates: parallele Logins legen die Zeile nicht doppelt an und
                // überschreiben vor allem kein bereits geändertes Passwort.
                Prefer: "resolution=ignore-duplicates,return=minimal",
            },
            body: JSON.stringify({
                id: "default",
                password_hash: await hashPassword(password),
                session_token: sessionToken,
            }),
            cache: "no-store",
        });
        // Schlägt der Insert fehl (Tabelle fehlt), bleibt es beim Env-Modus — Login klappt trotzdem.
        if (res.ok) invalidateCache();
    } catch {
        // still: der Login selbst war erfolgreich, das Seeding ist nur Migrationskomfort.
    }
}

/** Prüft das Passwort und liefert bei Erfolg den Session-Token fürs Cookie, sonst null. */
export async function verifyLogin(password: string): Promise<string | null> {
    const state = await getAuthState();
    if (!state) return null;

    if (state.kind === "db") {
        return (await verifyPassword(password, state.passwordHash)) ? state.sessionToken : null;
    }

    if (!constantTimeEquals(password, state.password)) return null;

    await seedFromEnv(state.password);
    // Nach dem Seeding gilt der Token aus der Tabelle — der ist identisch mit SESSION_SECRET,
    // aber lieber einmal frisch lesen als eine Annahme ins Cookie schreiben.
    const seeded = await getAuthState();
    return seeded?.sessionToken ?? state.sessionToken;
}

// ─── Passwortwechsel ─────────────────────────────────────────────────────────────

type ChangeResult = { ok: true; sessionToken: string } | { ok: false; error: string };

/**
 * Setzt ein neues Passwort und würfelt dabei den session_token neu.
 * Folge: JEDE bestehende Session wird ungültig — auch die des ändernden Browsers,
 * der deshalb vom Aufrufer ein frisches Cookie mit dem zurückgegebenen Token bekommt.
 */
export async function changeDashboardPassword(currentPassword: string, newPassword: string): Promise<ChangeResult> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, error: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.` };
    }
    if (currentPassword === newPassword) {
        return { ok: false, error: "Das neue Passwort muss sich vom bisherigen unterscheiden." };
    }

    const state = await getAuthState();
    if (!state) {
        return { ok: false, error: "Zugangsdaten sind gerade nicht erreichbar. Bitte später erneut versuchen." };
    }

    const currentIsValid =
        state.kind === "db"
            ? await verifyPassword(currentPassword, state.passwordHash)
            : constantTimeEquals(currentPassword, state.password);

    if (!currentIsValid) return { ok: false, error: "Das aktuelle Passwort stimmt nicht." };

    if (!SUPABASE_URL || !SERVICE_KEY) {
        return { ok: false, error: "Server ist nicht korrekt konfiguriert (Supabase-Zugang fehlt)." };
    }

    const sessionToken = randomBytes(32).toString("hex");

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_auth`, {
            method: "POST",
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
                // merge-duplicates = Upsert: legt die Zeile an, falls der erste Login sie
                // noch nicht geseedet hat, und überschreibt sie sonst.
                Prefer: "resolution=merge-duplicates,return=minimal",
            },
            body: JSON.stringify({
                id: "default",
                password_hash: await hashPassword(newPassword),
                session_token: sessionToken,
                updated_at: new Date().toISOString(),
            }),
            cache: "no-store",
        });

        if (!res.ok) {
            const detail = await res.text();
            console.error("changeDashboardPassword Fehler:", res.status, detail);
            return res.status === 404
                ? {
                      ok: false,
                      error: "Die Tabelle dashboard_auth fehlt — bitte backend/supabase_migration_dashboard_auth.sql im Supabase SQL-Editor ausführen.",
                  }
                : { ok: false, error: "Das Passwort konnte nicht gespeichert werden." };
        }
    } catch (error) {
        console.error("changeDashboardPassword Ausnahme:", error instanceof Error ? error.message : error);
        return { ok: false, error: "Das Passwort konnte nicht gespeichert werden." };
    }

    invalidateCache();
    return { ok: true, sessionToken };
}
