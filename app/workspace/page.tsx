import { requireFoundUser } from "../auth";
import WorkspaceDashboard from "./workspace-dashboard";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireFoundUser("/workspace");
  return <WorkspaceDashboard displayName={user.displayName} />;
}
