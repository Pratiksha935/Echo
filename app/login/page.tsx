import Link from "next/link";
import { redirect } from "next/navigation";
import { getFoundUser } from "../auth";
import { getSupabasePublicConfig } from "../../lib/auth/config";
import { safeReturnPath } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type LoginPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const returnTo = safeReturnPath(single(params.return_to));
  const user = await getFoundUser();
  if (user) redirect(returnTo);

  const configured = Boolean(getSupabasePublicConfig());
  const email = single(params.email) ?? "";
  const verify = single(params.step) === "verify" && email;
  const error = single(params.error);

  return <main className="loginPage">
    <nav><Link href="/">Found<span>.</span></Link><small>SECURE WORKSPACE ACCESS</small></nav>
    <section className="loginPanel">
      <div className="loginStory"><span>COMPANY MEMORY, WITH RECEIPTS</span><h1>Enter your company’s<br/>shared intelligence.</h1><p>Every person signs in. Every retrieval is scoped to their company and the permissions inherited from connected sources.</p><dl><div><dt>01</dt><dd>Authenticate the person</dd></div><div><dt>02</dt><dd>Resolve workspace membership</dd></div><div><dt>03</dt><dd>Filter evidence before retrieval</dd></div></dl></div>
      <div className="loginCard">
        <span>{verify ? "CHECK YOUR EMAIL" : "SIGN IN TO FOUND"}</span>
        <h2>{verify ? "Enter your verification code." : "Your workspace is waiting."}</h2>
        {error && <p className="loginError">{humanError(error)}</p>}
        {!configured ? <div className="loginNotice">Authentication is ready in code. Add the Supabase environment values in Netlify to activate public login.</div> : verify ? <form action="/auth/verify" method="post">
          <input type="hidden" name="email" value={email}/><input type="hidden" name="return_to" value={returnTo}/>
          <label>Verification code<input name="token" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={8} required placeholder="000000"/></label>
          <button type="submit">Verify and continue ↗</button><Link href={`/login?return_to=${encodeURIComponent(returnTo)}`}>Use another email</Link>
        </form> : <>
          <Link className="googleLogin" href={`/auth/google?return_to=${encodeURIComponent(returnTo)}`}>Continue with Google <b>G</b></Link>
          <div className="loginDivider"><span>OR</span></div>
          <form action="/auth/email" method="post"><input type="hidden" name="return_to" value={returnTo}/><label>Work email<input type="email" name="email" required autoComplete="email" placeholder="you@company.com"/></label><button type="submit">Email me a code ↗</button></form>
        </>}
        <small>By continuing, you agree to your company’s workspace policies. Provider credentials never enter this page.</small>
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
  return "Sign-in could not be completed.";
}

