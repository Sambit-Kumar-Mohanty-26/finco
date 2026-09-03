"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

/**
 * The last resort: an error thrown in the root layout, where no other boundary
 * exists. It replaces the layout entirely, so it ships its own <html>/<body>
 * and cannot rely on anything the layout provides.
 *
 * It exists mostly so Sentry sees these at all — an uncaught root-layout error
 * otherwise renders Next's default page and is never reported.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body className="bg-paper">
        <main className="mx-auto max-w-[38rem] px-6 py-24">
          <h1 className="text-[22px] leading-[1.3]">Something broke before the page could render.</h1>
          <p className="mt-3 text-[14px] leading-[1.55] text-ink-hush">
            Nothing was posted and nothing was lost — the close runs in a separate process and does
            not depend on this screen. Reload, and if it happens again quote the reference below.
          </p>
          <p className="mt-4 font-mono text-[11.5px] text-ink-hush">
            reference: {error.digest ?? "none — the error never reached the server"}
          </p>
          {/* A real navigation, not <Link>: the root layout is what failed, so a
              client-side transition would re-render the broken tree. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/runs"
            className="mt-8 inline-block bg-ink px-5 py-2.5 font-mono text-[11px] tracking-[0.06em] text-on-ink uppercase"
          >
            Back to runs
          </a>
        </main>
      </body>
    </html>
  );
}
