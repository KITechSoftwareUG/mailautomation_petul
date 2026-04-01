-- Supabase DB Migration 
-- Supabase DB Migration
-- Bitte in das Supabase SQL Editor Feld kopieren und "Run" drücken.

-- 1. Tabelle "emails" erweitern
ALTER TABLE public.emails
ADD COLUMN IF NOT EXISTS status text DEFAULT 'new',
ADD COLUMN IF NOT EXISTS intent text,
ADD COLUMN IF NOT EXISTS policy_decision_allowed boolean,
ADD COLUMN IF NOT EXISTS policy_decision_reason text,
ADD COLUMN IF NOT EXISTS api_action text,
ADD COLUMN IF NOT EXISTS agent_logs jsonb,
ADD COLUMN IF NOT EXISTS draft_reply text;

-- 2. Wenn es später ein Frontend gibt, beschleunigt dieser Index die Abfragen
CREATE INDEX IF NOT EXISTS idx_emails_status ON public.emails(status);
