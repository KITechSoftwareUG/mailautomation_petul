import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, verifyLogin } from '@/utils/auth';

// Einziger öffentlich erreichbarer Endpunkt des Dashboards (der Proxy lässt /api/auth
// bewusst durch) — deshalb hier ein einfaches Limit gegen Passwort-Durchprobieren.
// In-Memory und damit pro Instanz: auf Vercel bremst das einen Angreifer, es ersetzt
// aber kein zentrales Rate-Limiting.
//
// Das Limit zählt pro IP, und die Rezeption teilt sich einen Internetanschluss: alle
// Tippfehler des Hauses landen auf demselben Zähler. Deshalb bewusst nicht zu knapp —
// 20 Versuche/15 min bremsen Brute-Force weiterhin auf ~2.000 Versuche pro Tag.
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function isRateLimited(ip: string): boolean {
    const now = Date.now();

    // Abgelaufene Einträge aufräumen, damit die Map nicht unbegrenzt wächst.
    if (attempts.size > 500) {
        for (const [key, entry] of attempts) {
            if (entry.resetAt <= now) attempts.delete(key);
        }
    }

    const entry = attempts.get(ip);
    if (!entry || entry.resetAt <= now) return false;
    return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(ip: string) {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.resetAt <= now) {
        attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
        return;
    }
    entry.count += 1;
}

export async function POST(request: NextRequest) {
    let password: unknown;
    try {
        ({ password } = await request.json());
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const ip = clientIp(request);
    if (isRateLimited(ip)) {
        return NextResponse.json(
            { error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' },
            { status: 429 },
        );
    }

    const sessionToken = await verifyLogin(password);

    if (!sessionToken) {
        registerFailure(ip);
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    attempts.delete(ip);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE,
        path: '/',
    });

    return response;
}

// Logout läuft im Dashboard über die Server Action `logout()` (app/auth/actions.ts).
// Diese Route bleibt als Weg für Clients ohne Server Actions bestehen.
export async function DELETE() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });
    return response;
}
