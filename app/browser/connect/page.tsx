import { redirect } from "next/navigation";
import { requireFoundUser } from "../../auth";
import { getFoundWorkspace } from "../../../lib/auth/workspace";

export const dynamic = "force-dynamic";

export default async function BrowserConnectPage() {
  const user = await requireFoundUser("/browser/connect");
  const workspace = await getFoundWorkspace();
  if (!workspace) redirect("/integrations?return_to=%2Fbrowser%2Fconnect");

  return (
    <main className="browserPairPage">
      <section className="browserPairCard">
        <span>FOUND · BROWSER MEMORY</span>
        <i aria-hidden="true">F</i>
        <h1 data-found-pair-status>Connecting this browser…</h1>
        <p data-found-pair-detail>
          Keep this page open for a moment. Found is securely pairing the browser extension with this workspace.
        </p>
        <dl>
          <div><dt>WORKSPACE</dt><dd>{workspace.organisationName}</dd></div>
          <div><dt>ACCOUNT</dt><dd>{user.email}</dd></div>
          <div><dt>ACCESS</dt><dd>{workspace.role}</dd></div>
        </dl>
        <small>Only knowledge authorised for this workspace can be returned to the extension.</small>
      </section>
    </main>
  );
}
