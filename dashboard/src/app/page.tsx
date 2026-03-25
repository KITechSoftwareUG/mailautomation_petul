import { supabase } from "@/utils/supabase/client";
import { AlertCircle } from "lucide-react";
import { EmailFeed } from "./EmailFeed";

export const revalidate = 0;

export default async function DashboardPage() {
  const { data: emails, error } = await supabase
    .from("emails")
    .select(`
      id, 
      mail_id, 
      thread_id,
      betreff, 
      body_text,
      received_at, 
      status, 
      intent, 
      policy_decision_allowed, 
      policy_decision_reason, 
      api_action,
      draft_reply,
      agent_logs,
      senders!inner(email, name)
    `)
    .order("received_at", { ascending: false })
    .limit(20);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-red-500 p-4">
        <div className="bg-red-50 border border-red-200 p-4 rounded-xl max-w-md w-full shadow-sm">
          <h1 className="font-bold flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5" />
            Datenbankfehler
          </h1>
          <p className="text-sm opacity-80">{error.message}</p>
        </div>
      </div>
    );
  }

  return <EmailFeed emails={emails || []} />;
}
