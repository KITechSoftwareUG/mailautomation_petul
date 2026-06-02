const SIGNATURES: Record<string, string> = {
    H1: `
--
Mit freundlichen Grüßen / Kind regards

Hotel Petul "An der Zeche"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: an-der-zeche@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
`,
    H2: `
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "An'ne 40"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: anne-40@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
`,
    H3: `
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "Residenz"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: residenz@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
`,
    H4: `
--
Mit freundlichen Grüßen / Kind regards

Hotel Apart "Am Ruhrbogen"
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: am-ruhrbogen@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
`,
    H5: `
--
Mit freundlichen Grüßen / Kind regards

Art Hotel Brunnen
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
E-Mail: brunnen@petul.de · Web: www.petul.de

Petul Hotels GmbH · Geschäftsführer: [Name] · Amtsgericht [Ort] HRB [Nummer]
`,
    DEFAULT: `
--
Mit freundlichen Grüßen / Kind regards

Petul Hotels GmbH
Musterstraße 1 · 44000 Musterstadt
Tel.: +49 (0) 201 000000
Web: www.petul.de
`,
};

export function getSignature(hotelId: string | null | undefined): string {
    if (!hotelId) return SIGNATURES.DEFAULT;
    return SIGNATURES[hotelId] ?? SIGNATURES.DEFAULT;
}
