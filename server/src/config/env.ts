/**
 * Loads and validates environment variables for the server.
 */
import "dotenv/config";

/**
 * Reads a required environment variable.
 *
 * @param variableName The environment variable name.
 * @returns The environment variable value.
 * @throws Error if the value is missing or empty.
 */
function requireEnv(variableName: string): string {
  const value = process.env[variableName];

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${variableName}`);
  }

  return value;
}

/**
 * Central environment configuration object.
 */
export const env = {
  port: Number(process.env.PORT) || 3001,
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: requireEnv("DATABASE_URL"),
};