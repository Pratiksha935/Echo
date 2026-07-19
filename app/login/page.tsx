import Link from "next/link";
import { redirect } from "next/navigation";
import { getFoundUser } from "../auth";
import { getSupabasePublicConfig } from "../../lib/auth/config";
import { safeReturnPath } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type LoginPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnPath(single(params.return_to), "/workspace");
  const user = await getFoundUser();
  if (user) redirect(returnTo);

  const configured = Boolean(getSupabasePublicConfig());
  const demoAccessEnabled = Boolean(
    process.env.NEXT_PUBLIC_DEMO_ACCESS_VISIBLE === "true" &&
    process.env.DEMO_ACCESS_EMAIL &&
    process.env.DEMO_ACCESS_CODE,
  );
  const email = single(params.email) ?? "";
  const sent = single(params.sent) === "true" && email;
  const error = single(params.error);

  return <main className="loginPage">
    <nav><Link href="/">Found<span>.</span></Link><small>SECURE WORKSPACE ACCESS</small></nav>
    <section className="loginPanel">
      <div className="loginStory"><span>COMPANY KNOWLEDGE</span><h1>Your company memory, live where work happens.</h1><p>Sign in once, connect Google Workspace and Slack, then let Found surface source-linked battlecards and Ask Found answers across the dashboard, browser and Slack.</p><dl><div><dt>01</dt><dd>Review the executive memory overview</dd></div><div><dt>02</dt><dd>Pair the browser companion for ambient battlecards</dd></div><div><dt>03</dt><dd>Approve Google Workspace and Slack source scopes</dd></div><div><dt>04</dt><dd>Use Ask Found privately when a decision needs context</dd></div></dl></div>
      <div className="loginCard">
        <span>{sent ? "CHECK YOUR EMAIL" : "SECURE FOUND LOGIN"}</span>
        <h2>{sent ? "Open your recovery link." : "Continue to Found."}</h2>
        {error && <p className="loginError">{humanError(error)}</p>}
        {!configured ? <><div className="loginNotice">Authentication is ready in code. Add the Supabase environment values in Netlify to activate public login.</div><span className="googleLogin" aria-disabled="true"><span>Continue with Google</span><b>G</b></span></> : sent ? <div className="loginNotice">We sent a one-time recovery link to <b>{email}</b>. Open it in this browser to continue to source setup.<br/><Link href={`/login?return_to=${encodeURIComponent(returnTo)}`}>Return to password login</Link></div> : <><a className="googleLogin" href={`/auth/google?return_to=${encodeURIComponent(returnTo)}`}><span>Continue with Google</span><b>G</b></a><div className="loginDivider">OR USE WORK EMAIL</div><form action="/auth/password" method="post"><input type="hidden" name="return_to" value={returnTo}/><label>Work email<input type="email" name="email" required autoComplete="email" maxLength={254} placeholder="you@company.com"/></label><label>Password<input type="password" name="password" required autoComplete="current-password" maxLength={1024} placeholder="Enter your password"/></label><button type="submit">Continue to onboarding ↗</button></form><div className="loginDivider">RECOVERY</div><form action="/auth/email" method="post" className="magicRecovery"><input type="hidden" name="return_to" value={returnTo}/><label>Can’t access your password?<input type="email" name="email" required autoComplete="email" maxLength={254} placeholder="you@company.com"/></label><button type="submit">Email me a magic link ↗</button></form></>}
        {demoAccessEnabled && !sent && <div className="demoAccessOption"><span>TESTING THE SEEDED DEMO?</span><form action="/auth/demo" method="post"><input type="hidden" name="return_to" value="/workspace"/><label>Private demo code<input type="password" name="code" required autoComplete="off" placeholder="Enter demo code"/></label><button type="submit">Open demo ↗</button></form></div>}
        <small>One Found login. Slack and Google Workspace are approved separately after sign-in, and nothing is indexed until the workspace admin reviews the scope.</small>
      </div>
    </section>
  </main>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function humanError(code: string): string {
  if (code === "invalid_credentials") return "The email or password is incorrect. Please try again.";
  if (code === "invalid_code") return "That code is invalid or expired. Request a new one and try again.";
  if (code === "oauth_failed") return "Google sign-in could not be completed. Please try again.";
  if (code === "email_failed") return "The verification email could not be sent. Please try again.";
  if (code === "demo_failed") return "That demo access code is invalid or the test account is unavailable.";
  return "Sign-in could not be completed.";
}
