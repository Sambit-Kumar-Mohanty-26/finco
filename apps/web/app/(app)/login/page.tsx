"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wrap } from "@/components/layout/Wrap";
import { apiSend, type Actor } from "@/lib/api";

/**
 * Sign in.
 *
 * The form does not tell you whether an email exists — the API answers "email
 * or password is wrong" either way, and this page repeats exactly that. A
 * friendlier "no account with that address" would be a free list of everyone
 * who works here.
 *
 * The session lives in an httpOnly cookie set by the API, so nothing here ever
 * touches a token. There is deliberately no "remember me": the cookie is seven
 * days and revocable server-side, which is the property that matters.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const path = bootstrap ? "/v1/auth/bootstrap" : "/v1/auth/login";
    const r = await apiSend<Actor>(path, { email, password });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    if (bootstrap) {
      // Bootstrap creates the account but does not sign it in.
      setBootstrap(false);
      setBusy(false);
      setError("Account created. Sign in with it.");
      return;
    }
    router.push("/runs");
    router.refresh();
  }

  return (
    <main className="py-20">
      <Wrap className="max-w-[420px]">
        <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.02em]">
          {bootstrap ? "Create the first account" : "Sign in"}
        </h1>
        <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-hush">
          {bootstrap
            ? "Allowed only while no user exists. The first account is an approver."
            : "Every posting carries the name of the person who made it."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
              email
            </span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full border border-line-light bg-white px-3 py-2 font-mono text-[13px]"
            />
          </label>
          <label className="block">
            <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">
              password{bootstrap ? " — at least 12 characters" : ""}
            </span>
            <input
              type="password"
              required
              minLength={bootstrap ? 12 : undefined}
              autoComplete={bootstrap ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full border border-line-light bg-white px-3 py-2 font-mono text-[13px]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase disabled:opacity-30"
          >
            {busy ? "…" : bootstrap ? "Create account" : "Sign in"}
          </button>
        </form>

        {error ? (
          <p role="alert" className="mt-4 font-mono text-[11.5px] text-refused">
            {error}
          </p>
        ) : null}

        <button
          onClick={() => {
            setBootstrap((b) => !b);
            setError(null);
          }}
          className="mt-6 font-mono text-[10.5px] text-ink-hush underline hover:text-ink"
        >
          {bootstrap ? "← back to sign in" : "First run? Create the first account"}
        </button>
      </Wrap>
    </main>
  );
}
