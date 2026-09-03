import Link from "next/link";

const TABS = [
  { href: "/settings/connections", key: "connections", label: "Connections" },
  { href: "/settings/policy", key: "policy", label: "Policy & audit" },
];

/** Two settings pages, one strip. A server component, so no hook is needed. */
export function SettingsNav({ active }: { active: "connections" | "policy" }) {
  return (
    <nav className="mt-6 flex gap-4 border-b border-line-light font-mono text-[11px] tracking-[0.04em]">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 pb-2 ${
            t.key === active ? "border-signal-deep text-ink" : "border-transparent text-ink-hush hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
