/**
 * HTTP entry point: starts listening; route definitions live in `app.ts`.
 */
import { app } from "./app";
import { env } from "./config/env";

/**
 * Starts the HTTP server on `env.port` (see `src/config/env.ts`).
 */
function startServer(): void {
  app.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
    console.log(`Swagger UI: http://localhost:${env.port}/api-docs`);
  });
}

startServer();
