import { redirect } from "next/navigation";
import { requireFoundUser } from "../../auth";
import { getFoundWorkspace } from "../../../lib/auth/workspace";

export const dynamic = "force-dynamic";

type AuthorizePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function BrowserAuthorizePage({ searchParams }: AuthorizePageProps) {
  const params = await searchParams;
  const redirectUri = single(params.redirect_uri);
  if (!validChromeRedirect(redirectUri)) redirect("/browser/connect?error=invalid_extension");
  const returnTo = `/browser/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const user = await requireFoundUser(returnTo);
  const workspace = await getFoundWorkspace();
  if (!workspace) redirect(`/integrations?return_to=${encodeURIComponent(returnTo)}`);

  return <main className="browserPairPage"><section className="browserPairCard">
    <span>FOUND · SECURE BROWSER CONNECTION</span><i aria-hidden="true">F</i>
    <h1>Connect this browser?</h1>
    <p>Found will return a signed, workspace-bound browser session to the installed extension. It cannot read knowledge from another workspace, and membership is rechecked on every request.</p>
    <dl><div><dt>WORKSPACE</dt><dd>{workspace.organisationName}</dd></div><div><dt>ACCOUNT</dt><dd>{user.email}</dd></div><div><dt>ACCESS</dt><dd>{workspace.role}</dd></div></dl>
    <form action="/browser/authorize/complete" method="post" className="browserAuthorizeForm">
      <input type="hidden" name="redirect_uri" value={redirectUri}/>
      <button type="submit">Connect browser ↗</button>
    </form>
    <small>The source documents remain unchanged. Workspace access is revalidated on every insight request.</small>
  </section></main>;
}

function single(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function validChromeRedirect(value: string | undefined): value is string { return Boolean(value && /^https:\/\/[a-p]{32}\.chromiumapp\.org\/found\/?$/.test(value)); }
