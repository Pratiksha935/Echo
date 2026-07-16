import Link from "next/link";
import { redirect } from "next/navigation";
import { getFoundUser } from "../auth";
import { getSupabasePublicConfig } from "../../lib/auth/config";
import { safeReturnPath } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type LoginPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnPath(single(params.return_to), "/integrations");
  const user = await getFoundUser();
  if (user) redirect(returnTo);

  const configured = Boolean(getSupabasePublicConfig());
  const demoAccessEnabled = Boolean(process.env.DEMO_ACCESS_EMAIL && process.env.DEMO_ACCESS_CODE);
  const email = single(params.email) ?? "";
  const verify = single(params.step) === "verify" && email;
  const error = single(params.error);

  return <main className="loginPage">
    <nav><Link href="/">Found<span>.</span></Link><small>SECURE WORKSPACE ACCESS</small></nav>
    <section className="loginPanel">
      <div className="loginStory"><span>FOUNDER ONBOARDING</span><h1>Connect your company’s<br/>shared intelligence.</h1><p>Access is limited to invited work emails. Google Workspace and Slack each require a separate, explicit OAuth approval before the workspace opens.</p><dl><div><dt>01</dt><dd>Verify invited work email</dd></div><div><dt>02</dt><dd>Approve Google Workspace</dd></div><div><dt>03</dt><dd>Approve Slack, then enter workspace</dd></div></dl></div>
      <div className="loginCard">
        <span>{verify ? "CHECK YOUR EMAIL" : "INVITED FOUNDER ACCESS"}</span>
        <h2>{verify ? "Enter your verification code." : "Your workspace is waiting."}</h2>
        {error && <p className="loginError">{humanError(error)}</p>}
        {!configured ? <div className="loginNotice">Authentication is ready in code. Add the Supabase environment values in Netlify to activate public login.</div> : verify ? <form action="/auth/verify" method="post">
          <input type="hidden" name="email" value={email}/><input type="hidden" name="return_to" value={returnTo}/>
          <label>Verification code<input name="token" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={8} required placeholder="000000"/></label>
          <button type="submit">Verify and continue ↗</button><Link href={`/login?return_to=${encodeURIComponent(returnTo)}`}>Use another email</Link>
        </form> : <form action="/auth/email" method="post"><input type="hidden" name="return_to" value={returnTo}/><label>Work email<input type="email" name="email" required autoComplete="email" placeholder="you@company.com"/></label><button type="submit">Continue with email ↗</button></form>}
        {demoAccessEnabled && !verify && <div className="demoAccessOption"><span>TESTING THE SEEDED DEMO?</span><form action="/auth/demo" method="post"><input type="hidden" name="return_to" value="/workspace"/><label>Private demo code<input type="password" name="code" required autoComplete="off" placeholder="Enter demo code"/></label><button type="submit">Open demo ↗</button></form></div>}
        <small>One Found login. Slack and Google Workspace are approved separately after sign-in, and nothing is indexed until you review the scope.</small>
      </div>
    </section>
  </main>;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function humanError(code: string): string {
  if (code === "invalid_code") return "That code is invalid or expired. Request a new one and try again.";
  if (code === "oauth_failed") return "Google sign-in could not be completed. Please try again.";
  if (code === "email_failed") return "The verification email could not be sent. Please try again.";
  if (code === "demo_failed") return "That demo access code is invalid or the test account is unavailable.";
  if (code === "access_denied") return "This work email has not been invited to Found.";
  return "Sign-in could not be completed.";
}
