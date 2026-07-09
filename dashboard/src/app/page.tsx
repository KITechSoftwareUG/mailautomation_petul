import { fetchEmails } from "./emails/actions";
import { EmailFeed } from "./EmailFeed";

export const revalidate = 0;

export default async function DashboardPage() {
  const emails = await fetchEmails();
  return <EmailFeed emails={emails} />;
}
