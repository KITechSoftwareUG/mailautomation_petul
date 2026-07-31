"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
    SESSION_COOKIE,
    SESSION_MAX_AGE,
    MIN_PASSWORD_LENGTH,
    changeDashboardPassword,
    isValidSession,
} from "@/utils/auth";

function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax" as const,
        maxAge: SESSION_MAX_AGE,
        path: "/",
    };
}

// Der Proxy schützt zwar auch Server Actions (sie laufen als POST auf die Route, in der sie
// verwendet werden), aber Next.js rät ausdrücklich, sich nicht allein darauf zu verlassen:
// eine Matcher-Änderung oder ein Verschieben der Action würde den Schutz still entfernen.
async function requireSession() {
    const store = await cookies();
    if (!(await isValidSession(store.get(SESSION_COOKIE)?.value))) {
        redirect("/login");
    }
}

export async function logout() {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    redirect("/login");
}

export async function changePassword(
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
): Promise<{ ok: boolean; error?: string }> {
    await requireSession();

    if (!currentPassword || !newPassword) {
        return { ok: false, error: "Bitte alle Felder ausfüllen." };
    }
    if (newPassword !== confirmPassword) {
        return { ok: false, error: "Die beiden neuen Passwörter stimmen nicht überein." };
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return { ok: false, error: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.` };
    }

    const result = await changeDashboardPassword(currentPassword, newPassword);
    if (!result.ok) return { ok: false, error: result.error };

    // Der Wechsel hat alle Sessions widerrufen — inklusive dieser. Dieser Browser bekommt
    // deshalb sofort ein Cookie mit dem neuen Token; alle anderen Geräte landen beim
    // nächsten Aufruf auf /login.
    const store = await cookies();
    store.set(SESSION_COOKIE, result.sessionToken, sessionCookieOptions());

    return { ok: true };
}
