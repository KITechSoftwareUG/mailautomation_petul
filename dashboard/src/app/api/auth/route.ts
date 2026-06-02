import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'petul-session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

export async function POST(request: NextRequest) {
    const { password } = await request.json();

    const correctPassword = process.env.DASHBOARD_PASSWORD;
    const sessionSecret = process.env.SESSION_SECRET;

    if (!correctPassword || !sessionSecret) {
        return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    if (password !== correctPassword) {
        return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, sessionSecret, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: COOKIE_MAX_AGE,
        path: '/',
    });

    return response;
}

export async function DELETE() {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 0,
        path: '/',
    });
    return response;
}
