/**
 * HTTP entry point: starts listening; route definitions live in `app.ts`.
 */
import { app } from "./app";
import { env } from "./config/env";
import { warmAthleticsScheduleCache } from "./services/maristAthleticsScheduleService";
import { warmOfficialParkingFaqCache } from "./services/officialParkingRulesService";

/**
 * Starts the HTTP server on `env.port` (see `src/config/env.ts`).
 */
function startServer(): void {
  app.listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port}`);
    console.log(`Swagger UI: http://localhost:${env.port}/api-docs`);
  });

  void warmOfficialParkingFaqCache().catch((err) => {
    console.error("[faq] warmOfficialParkingFaqCache failed (non-fatal):", err);
  });
  void warmAthleticsScheduleCache().catch((err) => {
    console.error("[athletics] warmAthleticsScheduleCache failed (non-fatal):", err);
  });
}

startServer();
