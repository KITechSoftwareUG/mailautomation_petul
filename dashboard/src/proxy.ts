import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, isValidSession } from '@/utils/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Das Cookie wird gegen den aktuellen session_token aus `dashboard_auth` geprüft, nicht
  // mehr gegen den statischen SESSION_SECRET. Dadurch macht ein Passwortwechsel alle
  // bestehenden Sessions sofort ungültig (siehe utils/auth.ts).
  const session = request.cookies.get(SESSION_COOKIE)?.value;

  if (!(await isValidSession(session))) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    // Widerrufenes/abgelaufenes Cookie gleich entfernen, sonst schickt der Browser es
    // bei jedem Folge-Request weiter mit.
    if (session) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
