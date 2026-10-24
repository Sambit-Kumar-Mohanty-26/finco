"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { API_BASE, apiSend, type Actor } from "@/lib/api";

/**
 * Sign in and sign up, one component.
 *
 * They differ in four strings and one endpoint, and two files would have drifted
 * the moment either changed. What does NOT differ is worth stating: neither form
 * tells you whether an address is already registered. Sign-in answers "email or
 * password is wrong" whichever half was wrong, and sign-up answers "if that
 * address can be used, it is already in use" — because a form that confirms an
 * address has an account is a free list of everyone who works at a company, and
 * these accounts hold its books.
 *
 * The Google button is a real navigation, not a fetch: OAuth needs a top-level
 * redirect, and an <a> is the whole implementation. It is the same endpoint for
 * both modes — Google does not report which button was clicked, and the answer
 * is the same either way.
 *
 * Nothing here ever touches a token. The session is an httpOnly cookie the API
 * sets, revocable server-side, which is the property that matters.
 */

const COPY = {
  login: {
    title: "Sign in",
    blurb: "Every posting carries the name of the person who made it.",
    button: "Sign in",
    path: "/v1/auth/login",
    autoComplete: "current-password",
    swapText: "New here? Create an account",
    swapHref: "/signup",
  },
  signup: {
    title: "Create your workspace",
    blurb: "Your own books, empty, in your own tenant. Nobody else can see them.",
    button: "Create account",
    path: "/v1/auth/signup",
    autoComplete: "new-password",
    swapText: "Already have an account? Sign in",
    swapHref: "/login",
  },
} as const;

export function AuthForm({
  mode,
  google,
  notice,
}: {
  mode: "login" | "signup";
  google: boolean;
  notice?: string;
}) {
  const copy = COPY[mode];
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const r = await apiSend<Actor>(copy.path, {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      name: String(form.get("name") ?? ""),
    });
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    // Both endpoints set the session cookie, so there is no "now sign in with
    // it" step — being made to log in immediately after signing up is a form
    // asking you to prove you were paying attention.
    router.push("/runs");
    router.refresh();
  }

  return (
    <>
      <h2 className="font-display text-[34px] leading-[1.05] tracking-[-0.035em] text-ink">{copy.title}</h2>
      <p className="mt-3 max-w-[34ch] font-mono text-[11px] leading-[1.65] text-ink-hush">{copy.blurb}</p>

      {google ? (
        <>
          <a
            href={`${API_BASE}/v1/auth/google`}
            className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-[2px] border border-line-light bg-white px-5 py-3 text-[13.5px] transition-all hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-card"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line-light" />
            <span className="font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">or</span>
            <span className="h-px flex-1 bg-line-light" />
          </div>
        </>
      ) : (
        <div className="mt-8" />
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === "signup" ? (
          <Field label="your name" name="name" type="text" autoComplete="name" required={false} />
        ) : null}
        <Field label="email" name="email" type="email" autoComplete="username" />
        <Field
          label={mode === "signup" ? "password — at least 12 characters" : "password"}
          name="password"
          type="password"
          autoComplete={copy.autoComplete}
          minLength={mode === "signup" ? 12 : undefined}
        />
        <button
          type="submit"
          disabled={busy}
          className="group relative w-full overflow-hidden bg-ink px-5 py-3 font-mono text-[11px] tracking-[0.08em] text-on-ink uppercase transition-transform hover:-translate-y-0.5 disabled:opacity-30"
        >
          {busy ? "…" : copy.button}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-4 font-mono text-[11.5px] leading-[1.5] text-refused">
          {error}
        </p>
      ) : null}

      <Link href={copy.swapHref} className="mt-6 inline-block font-mono text-[10.5px] text-ink-hush underline hover:text-ink">
        {copy.swapText}
      </Link>
    </>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  minLength,
  required = true,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-hush uppercase">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-[2px] border border-line-light bg-paper-cool px-3.5 py-3 font-mono text-[13px] outline-none transition-colors placeholder:text-ink-hush focus:border-signal-deep focus:bg-white"
      />
    </label>
  );
}

/** Google's mark, inline. A 1 KB SVG beats a font or an image request. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.7-3.7-13.6-9.9l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
