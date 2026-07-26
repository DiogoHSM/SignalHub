import { defineConfig } from "vitest/config";

const pnpm = "/Users/diogo/Developer/Github/SignalHub/node_modules/.pnpm";

export default defineConfig({
  esbuild: { jsx: "automatic", jsxDev: false },
  resolve: {
    alias: [
      { find: /^react\/(.*)$/, replacement: `${pnpm}/react@19.2.5/node_modules/react/$1` },
      { find: /^react$/, replacement: `${pnpm}/react@19.2.5/node_modules/react` },
      { find: /^react-dom\/(.*)$/, replacement: `${pnpm}/react-dom@19.2.5_react@19.2.5/node_modules/react-dom/$1` },
      { find: /^react-dom$/, replacement: `${pnpm}/react-dom@19.2.5_react@19.2.5/node_modules/react-dom` },
      {
        find: /^@testing-library\/react$/,
        replacement: `${pnpm}/@testing-library+react@16.3.2_@testing-library+dom@10.4.1_@types+react-dom@19.2.3_@type_42bd4be5b674570827b99e11cad0b44b/node_modules/@testing-library/react`
      },
      {
        find: /^@testing-library\/user-event$/,
        replacement: `${pnpm}/@testing-library+user-event@14.6.1_@testing-library+dom@10.4.1/node_modules/@testing-library/user-event`
      },
      {
        find: /^@testing-library\/jest-dom\/(.*)$/,
        replacement: `${pnpm}/@testing-library+jest-dom@6.9.1/node_modules/@testing-library/jest-dom/$1`
      }
    ]
  },
  test: {
    root: "/Users/diogo/Developer/Github/SignalHub",
    environment: "jsdom",
    include: [".claude/docs/AUDIT-2026-07-26/per434-probe.test.tsx"],
    setupFiles: ["/Users/diogo/Developer/Github/SignalHub/apps/console/src/test/setup.ts"]
  }
});
