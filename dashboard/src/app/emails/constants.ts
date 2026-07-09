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
