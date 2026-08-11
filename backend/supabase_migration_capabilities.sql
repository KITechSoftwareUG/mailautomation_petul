-- Fähigkeiten der 3RPMS-Anbindung je Hotel — im Dashboard sichtbar.
--
-- Warum als Tabelle und nicht nur im Backend-Log: Die Rezeptionistin muss sehen können,
-- warum eine Aktion nicht automatisch ausgeführt wurde. Ohne diese Sichtbarkeit wirkt ein
-- Entwurf ohne Systemwirkung wie ein Fehler des Programms, obwohl es der reale Zustand der
-- Schnittstelle ist ("Die Reservierungs-API wurde nicht aktiviert").
--
-- Das Backend schreibt diese Zeilen bei jedem Start und danach alle 6 Stunden neu
-- (probeCapabilities in backend/src/utils/threerpms.ts).

CREATE TABLE IF NOT EXISTS public.pms_capabilities (
    hotel_id            text PRIMARY KEY,
    hotel_name          text NOT NULL,
    reservierungs_api   boolean NOT NULL DEFAULT false,
    sales_product_id    text,
    payment_method_id   text,
    gesperrt            jsonb NOT NULL DEFAULT '[]'::jsonb,
    geprueft_am         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.pms_capabilities IS 'Was die 3RPMS-Anbindung je Hotel real kann. Vom Backend beim Start gemessen.';
COMMENT ON COLUMN public.pms_capabilities.reservierungs_api IS 'false = ratePlans antwortet mit Konfigurationsfehler; importReservation dadurch unmöglich';
COMMENT ON COLUMN public.pms_capabilities.sales_product_id  IS 'NULL = kein External-Sales-Produkt; createExternalSale dadurch unmöglich';
COMMENT ON COLUMN public.pms_capabilities.payment_method_id IS 'NULL = keine Zahlungsart; createDeposit dadurch unmöglich';
COMMENT ON COLUMN public.pms_capabilities.gesperrt          IS 'Klartext-Begründungen der gesperrten Aktionen, für die Anzeige im Dashboard';

-- RLS an, absichtlich keine Policy: Nur der Service-Role-Key (Backend und die
-- Server Actions des Dashboards) kommt an die Zeilen. Das Dashboard hat kein
-- Supabase Auth — eine "public read"-Policy würde die Daten für jeden anon-Key
-- öffnen. Siehe dashboard_auth, dort gilt dieselbe Begründung.
ALTER TABLE public.pms_capabilities ENABLE ROW LEVEL SECURITY;
