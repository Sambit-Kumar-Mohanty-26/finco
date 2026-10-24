import { AuthForm } from "@/components/app/AuthForm";
import { apiGet, isErr } from "@/lib/api";

/**
 * Sign in.
 *
 * A server component so it can ask the API whether Google is configured, rather
 * than carrying a second NEXT_PUBLIC_* flag that has to be kept in step with the
 * API's own credentials — the failure mode there is a button that 503s.
 *
 * `?error=` is where the Google callback bounces a failed sign-in. It has to be
 * rendered somewhere, or a cancelled Google flow lands on a login page with no
 * explanation of why it did nothing.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [config, params] = await Promise.all([
    apiGet<{ google: boolean }>("/v1/auth/config"),
    searchParams,
  ]);

  return <AuthPage mode="login" google={!isErr(config) && config.google} notice={params.error} />;
}

function AuthPage({
  mode,
  google,
  notice,
}: {
  mode: "login" | "signup";
  google: boolean;
  notice?: string;
}) {
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-story">
          <div className="auth-orbit auth-orbit-one" />
          <div className="auth-orbit auth-orbit-two" />
          <div className="relative z-10">
            <div className="auth-eyebrow">
              <span className="auth-pulse" />
              financial control, made visible
            </div>
            <h1 className="auth-display">
              Close the books
              <br />
              <em>with proof.</em>
            </h1>
            <p className="auth-lede">
              FinCo turns messy settlement data into a ledger you can stand behind.
              Every match is measured, every exception has an owner, and zero means zero.
            </p>
            <div className="auth-signal-grid" aria-label="FinCo product principles">
              <div>
                <span className="auth-signal-value">0.00</span>
                <span className="auth-signal-label">paise unproven</span>
              </div>
              <div>
                <span className="auth-signal-value">100%</span>
                <span className="auth-signal-label">traceable</span>
              </div>
              <div>
                <span className="auth-signal-value">T+2</span>
                <span className="auth-signal-label">settlement aware</span>
              </div>
            </div>
          </div>
          <div className="auth-dial" aria-hidden="true">
            <div className="auth-dial-ring auth-dial-ring-one" />
            <div className="auth-dial-ring auth-dial-ring-two" />
            <div className="auth-dial-core">
              <span className="auth-dial-kicker">close state</span>
              <strong>PROVEN</strong>
              <span className="auth-dial-value">₹ 0.00</span>
            </div>
            <span className="auth-dial-mark auth-dial-mark-one">BANK</span>
            <span className="auth-dial-mark auth-dial-mark-two">ERP</span>
            <span className="auth-dial-mark auth-dial-mark-three">GATE</span>
          </div>
          <span className="auth-corner-label">FINCO / 01</span>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-top">
            <span>{mode === "login" ? "Welcome back" : "Start a new close"}</span>
            <span className="auth-lock">● encrypted session</span>
          </div>
          <div className="auth-form-card">
            <AuthForm mode={mode} google={google} notice={notice} />
          </div>
          <p className="auth-panel-foot">
            Built for operators who need the numbers to hold up.
            <span> &copy; FinCo</span>
          </p>
        </section>
      </div>
    </main>
  );
}
