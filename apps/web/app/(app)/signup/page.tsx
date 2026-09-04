import { Wrap } from "@/components/layout/Wrap";
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
    <main className="py-20">
      <Wrap className="max-w-[420px]">
        <AuthForm mode="signup" google={!isErr(config) && config.google} notice={params.error} />
        <p className="mt-8 border-t border-line-light pt-5 font-mono text-[10.5px] leading-[1.6] text-ink-hush">
          You become the approver of a workspace of one. Adding your team needs an
          invite flow, which is not built yet — until it is, a colleague who signs
          up gets their own workspace, not a seat in yours.
        </p>
      </Wrap>
    </main>
  );
}
