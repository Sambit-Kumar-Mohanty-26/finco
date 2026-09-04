import { Wrap } from "@/components/layout/Wrap";
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

  return (
    <main className="py-20">
      <Wrap className="max-w-[420px]">
        <AuthForm mode="login" google={!isErr(config) && config.google} notice={params.error} />
      </Wrap>
    </main>
  );
}
