/** @type {import("jest").Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  globalTeardown: "<rootDir>/src/test/jestGlobalTeardown.ts",
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  /** Avoid hanging when `pg` or other deps leave short-lived handles after `closePool()`. */
  forceExit: true,
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.jest.json",
      },
    ],
  },
};
