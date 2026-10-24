import { AuthForm } from "@/components/app/AuthForm";
import { apiGet, isErr } from "@/lib/api";

/**
 * Sign up.
 *
 * Signing up creates a NEW TENANT with you as its approver — your own empty
 * books, not a seat in somebody else's. Joining an existing workspace is an
 * invite flow and there isn't one yet, so a colleague who signs up here lands in
 * their own workspace rather than yours.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [config, params] = await Promise.all([
    apiGet<{ google: boolean }>("/v1/auth/config"),
    searchParams,
  ]);

  return (
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-story">
          <div className="auth-orbit auth-orbit-one" />
          <div className="auth-orbit auth-orbit-two" />
          <div className="relative z-10">
            <div className="auth-eyebrow">
              <span className="auth-pulse" />
              your books, your proof
            </div>
            <h1 className="auth-display">
              A clearer
              <br />
              <em>close starts here.</em>
            </h1>
            <p className="auth-lede">
              Create a private workspace for your books. Bring in your data,
              resolve what is real, and lock each period with confidence.
            </p>
            <div className="auth-signal-grid">
              <div><span className="auth-signal-value">01</span><span className="auth-signal-label">private workspace</span></div>
              <div><span className="auth-signal-value">∞</span><span className="auth-signal-label">evidence trail</span></div>
              <div><span className="auth-signal-value">₹</span><span className="auth-signal-label">paise precise</span></div>
            </div>
          </div>
          <div className="auth-dial" aria-hidden="true">
            <div className="auth-dial-ring auth-dial-ring-one" />
            <div className="auth-dial-ring auth-dial-ring-two" />
            <div className="auth-dial-core">
              <span className="auth-dial-kicker">workspace state</span>
              <strong>READY</strong>
              <span className="auth-dial-value">₹ -</span>
            </div>
            <span className="auth-dial-mark auth-dial-mark-one">IMPORT</span>
            <span className="auth-dial-mark auth-dial-mark-two">MATCH</span>
            <span className="auth-dial-mark auth-dial-mark-three">PROVE</span>
          </div>
          <span className="auth-corner-label">FINCO / 01</span>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-top"><span>New workspace</span><span className="auth-lock">● encrypted session</span></div>
          <div className="auth-form-card">
            <AuthForm mode="signup" google={!isErr(config) && config.google} notice={params.error} />
          </div>
          <p className="auth-panel-foot">A workspace of one, ready to grow.<span> &copy; FinCo</span></p>
        </section>
      </div>
    </main>
  );
}
