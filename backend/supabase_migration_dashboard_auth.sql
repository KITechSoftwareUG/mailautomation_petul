-- Migration: Dashboard-Zugang (Passwort änderbar, Sessions widerrufbar)
-- Bitte in das Supabase SQL Editor Feld kopieren und "Run" drücken.
--
-- Bis hierher lagen Passwort und Session-Geheimnis fest in den Env-Vars
-- DASHBOARD_PASSWORD / SESSION_SECRET. Beides ließ sich nur per Vercel-Redeploy ändern,
-- und ein Logout konnte nichts widerrufen: das Session-Cookie war für immer gültig.
--
-- Diese Tabelle hält genau EINE Zeile (id = 'default'):
--   password_hash  — scrypt-Hash des Dashboard-Passworts (nie Klartext)
--   session_token  — Geheimnis, das im Session-Cookie steckt. Wird bei jedem
--                    Passwortwechsel neu gewürfelt → alle anderen Sessions sind sofort tot.
--
-- Die Zeile wird NICHT hier geseedet: der erste erfolgreiche Login mit dem bisherigen
-- DASHBOARD_PASSWORD legt sie automatisch an (Hash + bestehender SESSION_SECRET als Token,
-- damit niemand rausfliegt). Ab dann ist die DB die Quelle der Wahrheit; die Env-Vars
-- dienen nur noch als Notfall-Fallback, falls diese Tabelle leer ist.

CREATE TABLE IF NOT EXISTS public.dashboard_auth (
    -- Bewusst kein uuid-PK: die Tabelle ist ein Singleton. Der feste Schlüssel + CHECK
    -- machen eine zweite Zeile (und damit zwei konkurrierende Passwörter) unmöglich.
    id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
    password_hash text NOT NULL,
    session_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS an, aber ABSICHTLICH ohne jede Policy: damit kommt ausschließlich der
-- Service-Role-Key (RLS-Bypass, nur serverseitig im Dashboard) an diese Zeile.
-- Nicht dem Muster von hotel_signatures folgen — "Public read access" würde hier
-- den Passwort-Hash und das Session-Geheimnis für jeden anon-Key lesbar machen.
ALTER TABLE public.dashboard_auth ENABLE ROW LEVEL SECURITY;
