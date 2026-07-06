-- Migration: Konfigurierbare E-Mail-Signaturen pro Hotel
-- Bitte in das Supabase SQL Editor Feld kopieren und "Run" drücken.

CREATE TABLE IF NOT EXISTS public.hotel_signatures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id text NOT NULL UNIQUE,
    hotel_name text NOT NULL,
    signature text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hotel_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.hotel_signatures
    FOR SELECT USING (true);

CREATE POLICY "Public update access" ON public.hotel_signatures
    FOR UPDATE USING (true) WITH CHECK (true);

-- Startwerte: übernommen aus den bisher hartcodierten Signaturen in backend/src/utils/signatures.ts.
-- Die Platzhalter (Musterstraße, [Name], HRB [Nummer] ...) bitte im Dashboard unter /settings durch die echten Daten ersetzen.
INSERT INTO public.hotel_signatures (hotel_id, hotel_name, signature) VALUES
    ('H1', 'Hotel Petul "An der Zeche"', $sig$
--
Mit freundlichen Grüßen / Kind regards

Hotel Petul "An der Zeche"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: an-der-zeche@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
$sig$),
    ('H2', 'Hotel Apart "An''ne 40"', $sig$
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "An'ne 40"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: anne-40@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
$sig$),
    ('H3', 'Hotel Apart "Residenz"', $sig$
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "Residenz"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: residenz@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
$sig$),
    ('H4', 'Hotel Apart "Am Ruhrbogen"', $sig$
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "Am Ruhrbogen"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: am-ruhrbogen@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
$sig$),
    ('H5', 'Art Hotel Brunnen', $sig$
--
Mit freundlichen Grüßen / Kind regards

Art Hotel Brunnen
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: brunnen@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
$sig$),
    ('DEFAULT', 'Petul Hotels GmbH (Standard)', $sig$
--
Mit freundlichen Grüßen / Kind regards

Petul Hotels GmbH
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
Web: www.petul.de
$sig$)
ON CONFLICT (hotel_id) DO NOTHING;
