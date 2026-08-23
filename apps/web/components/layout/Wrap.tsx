import type { ReactNode } from "react";

/** One max-width and one set of gutters, shared by marketing and the app. */
export function Wrap({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[1440px] px-6 md:px-10 lg:px-14 ${className}`}>
      {children}
    </div>
  );
}
