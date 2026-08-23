import next from "eslint-config-next/core-web-vitals";

const config = [
  { ignores: [".next/**", "e2e/shots/**", "next-env.d.ts"] },
  ...next,
  {
    rules: {
      // Money is bigint paise. Summing it on the client is a review-blocking
      // defect: a rounding difference between server and client in a ledger UI
      // destroys trust instantly and is nearly impossible to debug from a
      // screenshot. Every total arrives already computed (see @finco/core).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='reduce'] > MemberExpression[property.name=/^(paise|amounts?|debits?|credits?)$/]",
          message:
            "Do not sum money on the client — totals must arrive computed (@finco/core).",
        },
      ],
    },
  },
];

export default config;
