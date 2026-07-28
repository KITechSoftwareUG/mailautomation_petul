// Liste/Polling: OHNE body_text/body_html. Diese Felder können pro Mail (HTML-Signaturen,
// eingebettete Bilder, Newsletter-Markup, zitierte Verläufe) mehrere hundert KB groß sein —
// bei Polling alle 5s über bis zu 350 Zeilen war das der Haupttreiber für den Supabase-
// Egress-Kontingent-Überlauf. Body wird stattdessen gezielt pro ausgewählter Mail nachgeladen
// (fetchEmailBody).
export const EMAIL_LIST_SELECT = `
    id, mail_id, betreff, received_at, status, intent,
    policy_decision_allowed, policy_decision_reason, api_action, draft_reply,
    agent_logs, senders!inner(email, name)
`;

export const EMAIL_SELECT = `
    id, mail_id, betreff, body_text, body_html, received_at, status, intent,
    policy_decision_allowed, policy_decision_reason, api_action, draft_reply,
    agent_logs, senders!inner(email, name)
`;

// "archived" (>30 Tage alt & nie bearbeitet, siehe backend archiveStaleMails)
// taucht hier bewusst nirgends auf — sonst wäre das der exakt gleiche Bug wie
// vorher: ein ungefilterter "die letzten 50" Query begräbt die Mails, die
// tatsächlich noch Aufmerksamkeit brauchen, unter dem täglichen Ignored/Spam-Rauschen.
export const ACTIVE_STATUSES = ["new", "queued", "processing", "failed", "approved"];
export const DONE_STATUSES = ["ignored", "sent", "rejected"];

// Reine Dashboard-Anzeige-Einstellung: blendet den historischen Backlog (Rückstau aus der
// zweiwöchigen Supabase-Egress-Sperre, alte Testmails) aus der Ansicht aus, damit sie sich
// auf das konzentriert, was ab jetzt tatsächlich neu reinkommt. Nichts wird gelöscht oder
// anders verarbeitet — das Backend analysiert weiterhin JEDE Mail unabhängig vom Datum,
// dieser Wert filtert ausschließlich, was fetchEmails() dem Dashboard zurückgibt.
// Bewusst ein fixer Zeitstempel (nicht `new Date()`) — sonst würde jeder Vercel-Redeploy
// die Grenze stillschweigend auf den Deploy-Zeitpunkt zurücksetzen und Mails verstecken,
// die zwischen zwei Deploys ankamen. Bei Bedarf hier einfach anpassen oder entfernen.
export const DASHBOARD_SHOW_SINCE = "2026-07-28T05:15:04.000Z";
