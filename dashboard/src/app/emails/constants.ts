// Liste/Polling: OHNE body_text/body_html. Diese Felder können pro Mail (HTML-Signaturen,
// eingebettete Bilder, Newsletter-Markup, zitierte Verläufe) mehrere hundert KB groß sein —
// bei Polling alle 5s über bis zu 350 Zeilen war das der Haupttreiber für den Supabase-
// Egress-Kontingent-Überlauf. Body wird stattdessen gezielt pro ausgewählter Mail nachgeladen
// (fetchEmailBody).
export const EMAIL_LIST_SELECT = `
    id, mail_id, betreff, received_at, status, intent, has_attachments,
    policy_decision_allowed, policy_decision_reason, api_action, draft_reply,
    agent_logs, senders!inner(email, name)
`;

export const EMAIL_SELECT = `
    id, mail_id, betreff, body_text, body_html, received_at, status, intent, has_attachments,
    policy_decision_allowed, policy_decision_reason, api_action, draft_reply,
    agent_logs, senders!inner(email, name)
`;

// "archived" (>30 Tage alt & nie bearbeitet, siehe backend archiveStaleMails)
// taucht hier bewusst nirgends auf — sonst wäre das der exakt gleiche Bug wie
// vorher: ein ungefilterter "die letzten 50" Query begräbt die Mails, die
// tatsächlich noch Aufmerksamkeit brauchen, unter dem täglichen Ignored/Spam-Rauschen.
// "sending" (Versand läuft gerade) und "send_failed" (nach 5 Versuchen endgültig
// unzustellbar) MÜSSEN hier stehen — sonst verschwindet eine Mail in genau dem Moment
// aus der Ansicht, in dem sie Aufmerksamkeit braucht.
export const ACTIVE_STATUSES = ["new", "queued", "processing", "failed", "approved", "sending", "send_failed"];
export const DONE_STATUSES = ["ignored", "sent", "rejected"];

// Der frühere Datumsfilter (DASHBOARD_SHOW_SINCE) ist entfallen. Er filterte auf
// received_at — und received_at ist der Date-Header, den der ABSENDER setzt. Eine Mail
// von einem Handy mit falsch gestellter Uhr, oder eine, die zwei Tage in einer
// Relay-Queue hing, war damit unsichtbar: vollständig verarbeitet, mit fertigem Entwurf,
// aber niemals in der Liste. Der historische Rückstau, den der Filter kaschieren sollte,
// wurde stattdessen aus der Datenbank entfernt — damit ist der Filter überflüssig
// und richtet nur noch Schaden an.
