import { useEffect, useMemo, useState } from "react";
import "./index.css";
import logo from "./marist-logo.png"; // place your uploaded logo in src folder
import {
  askParking,
  fetchParkingLots,
  fetchParkingSummary,
  type ParkingAskResponse,
  type ParkingLotListItem,
  type ParkingLotSummary,
} from "./parkingApi";

type UserType = "resident" | "commuter" | "faculty" | "visitor";
type TimeView = "now" | "1h" | "2h";

interface ForecastParkingLot {
  lotCode: string;
  lotName: string;
  zoneType: string;
  occupancyPercent: number | null;
  latestSnapshotTime: string | null;
}

function getColor(v: number) {
  if (v > 0.8) return "#eab308"; // yellow
  if (v > 0.6) return "#22c55e"; // green
  return "#2563eb"; // blue
}

function percent(v: number) {
  return `${Math.round(v * 100)}%`;
}

export default function App() {
  const [user, setUser] = useState<UserType>("commuter");
  const [time, setTime] = useState<TimeView>("now");
  const [clock, setClock] = useState("");
  const [apiLots, setApiLots] = useState<ForecastParkingLot[] | null>(null);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [askInput, setAskInput] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<ParkingAskResponse | null>(null);

  useEffect(() => {
    const update = () => {
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  const forecastContext = useMemo(() => {
    const anchor = new Date();
    if (time === "1h") {
      anchor.setHours(anchor.getHours() + 1);
    } else if (time === "2h") {
      anchor.setHours(anchor.getHours() + 2);
    }
    return { hour: anchor.getHours(), dayOfWeek: anchor.getDay(), label: anchor.toLocaleString() };
  }, [time]);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary(): Promise<void> {
      setApiLoading(true);
      setApiError(null);
      try {
        const [summaryRows, lotRows] = await Promise.all([
          fetchParkingSummary({
            hour: forecastContext.hour,
            dayOfWeek: forecastContext.dayOfWeek,
          }),
          fetchParkingLots(),
        ]);
        const zoneByCode = new Map<string, string>(
          lotRows.map((row: ParkingLotListItem) => [row.lotCode, row.zoneType]),
        );
        const merged: ForecastParkingLot[] = summaryRows.map((row: ParkingLotSummary) => ({
          ...row,
          zoneType: zoneByCode.get(row.lotCode) ?? row.zoneType,
        }));
        if (!cancelled) {
          setApiLots(merged);
        }
      } catch (err) {
        if (!cancelled) {
          setApiError(err instanceof Error ? err.message : "Could not load summary");
          setApiLots(null);
        }
      } finally {
        if (!cancelled) {
          setApiLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [forecastContext.dayOfWeek, forecastContext.hour]);

  const allowedZones = useMemo(() => {
    if (user === "faculty") return new Set(["faculty"]);
    if (user === "visitor") return new Set(["visitor"]);
    return new Set(["student"]);
  }, [user]);

  const availableLots = useMemo(() => {
    return (apiLots ?? []).filter((lot) => allowedZones.has(lot.zoneType.toLowerCase()));
  }, [allowedZones, apiLots]);

  const stats = useMemo(() => {
    let light = 0;
    let busy = 0;
    let heavy = 0;

    availableLots.forEach((lot) => {
      if (lot.occupancyPercent === null) {
        return;
      }
      if (lot.occupancyPercent >= 85) heavy++;
      else if (lot.occupancyPercent >= 70) busy++;
      else light++;
    });

    return { light, busy, heavy };
  }, [availableLots]);

  const bestLot = useMemo(() => {
    return [...availableLots].sort((a, b) => {
      const scoreA = a.occupancyPercent ?? Number.POSITIVE_INFINITY;
      const scoreB = b.occupancyPercent ?? Number.POSITIVE_INFINITY;
      return scoreA - scoreB;
    })[0];
  }, [availableLots]);

  async function submitAsk(): Promise<void> {
    const question = askInput.trim();
    if (!question) {
      setAskError("Enter a parking question first.");
      return;
    }
    setAskLoading(true);
    setAskError(null);
    setAskResult(null);
    try {
      const contextualQuestion = `${question} (arrival context: ${forecastContext.label})`;
      const response = await askParking(contextualQuestion);
      setAskResult(response);
      requestAnimationFrame(() => {
        document.getElementById("ask-result")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Could not get an answer");
    } finally {
      setAskLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: 24,
        fontFamily: "Inter, sans-serif",
        color: "#111827",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 10px 25px rgba(0,0,0,.06)",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src={logo} alt="Marist" style={{ height: 55 }} />

          <div>
            <h1 style={{ margin: 0, color: "#be123c" }}>
              Campus Parking Finder
            </h1>
            <p style={{ margin: 0, color: "#6b7280" }}>
              Forecasted parking patterns • Smart recommendations • {clock}
            </p>
          <p style={{ margin: "8px 0 0 0", color: "#94a3b8", fontSize: 12 }}>
            Forecasts are based on stored parking history, not live sensor feeds.
          </p>
          </div>
        </div>

        {/* FILTERS */}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          {["resident", "commuter", "faculty", "visitor"].map((u) => (
            <button
              key={u}
              onClick={() => setUser(u as UserType)}
              style={{
                padding: "10px 16px",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                background: user === u ? "#be123c" : "#f1f5f9",
                color: user === u ? "white" : "#111827",
                fontWeight: 600,
              }}
            >
              {u}
            </button>
          ))}

          {["now", "1h", "2h"].map((t) => (
            <button
              key={t}
              onClick={() => setTime(t as TimeView)}
              style={{
                padding: "10px 16px",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                background: time === t ? "#be123c" : "#f1f5f9",
                color: time === t ? "white" : "#111827",
                fontWeight: 600,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* FORECAST API SUMMARY (real backend) */}
      <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 8px 20px rgba(0,0,0,.05)",
          marginBottom: 24,
        }}
      >
        <h2 style={{ color: "#be123c", marginTop: 0 }}>Forecasted lot busyness (API)</h2>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>
          Data from <code style={{ fontSize: 13 }}>GET /api/parking/summary</code> — same fields as
          the backend JSON, estimated for {forecastContext.label} using historical snapshots.
        </p>

        {apiLoading && <p style={{ color: "#64748b" }}>Loading…</p>}
        {apiError && (
          <p style={{ color: "#b91c1c", fontWeight: 600 }}>
            {apiError}
            <span style={{ display: "block", fontWeight: 400, fontSize: 14, marginTop: 8 }}>
              Start the server on port 3001 (see <code>server/README.md</code>) and use{" "}
              <code>npm run dev</code> here so Vite can proxy <code>/api</code>, or set{" "}
              <code>VITE_API_BASE_URL</code>.
            </span>
          </p>
        )}
        {!apiLoading && !apiError && apiLots && apiLots.length === 0 && (
          <p style={{ color: "#64748b" }}>No lots returned yet (empty database or no rows).</p>
        )}
        {!apiLoading && !apiError && apiLots && apiLots.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Lot code</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Lot name</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>Zone</th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>
                    Expected occupancy %
                  </th>
                  <th style={{ padding: "8px 6px", borderBottom: "1px solid #e2e8f0" }}>
                    Latest supporting snapshot
                  </th>
                </tr>
              </thead>
              <tbody>
                {apiLots.map((row) => (
                  <tr key={row.lotCode}>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {row.lotCode}
                    </td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {row.lotName}
                    </td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {row.zoneType}
                    </td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {row.occupancyPercent === null ? "—" : `${row.occupancyPercent}%`}
                    </td>
                    <td style={{ padding: "10px 6px", borderBottom: "1px solid #f1f5f9" }}>
                      {row.latestSnapshotTime === null
                        ? "—"
                        : new Date(row.latestSnapshotTime).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* STATS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 18,
          marginBottom: 24,
        }}
      >
        {[
          ["Light Forecast", stats.light, "#2563eb"],
          ["Busy Lots", stats.busy, "#22c55e"],
          ["Heavy Forecast", stats.heavy, "#eab308"],
          ["Your Access", availableLots.length, "#be123c"],
        ].map(([title, value, color]) => (
          <div
            key={title as string}
            style={{
              background: "white",
              borderRadius: 18,
              padding: 20,
              boxShadow: "0 8px 20px rgba(0,0,0,.05)",
            }}
          >
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: color as string,
              }}
            >
              {value}
            </div>
            <div style={{ color: "#6b7280" }}>{title}</div>
          </div>
        ))}
      </div>

      {/* BEST LOT */}
      {bestLot && (
        <div
          style={{
            background: "white",
            borderRadius: 18,
            padding: 24,
            marginBottom: 24,
            border: "2px solid #fecdd3",
          }}
        >
          <h2 style={{ marginTop: 0, color: "#be123c" }}>Predicted Best Lot</h2>
          <h3 style={{ marginBottom: 8 }}>
            {bestLot.lotName} ({bestLot.lotCode})
          </h3>

          <p style={{ color: "#475569" }}>
            Expected occupancy:{" "}
            {bestLot.occupancyPercent === null
              ? "Unknown"
              : `${bestLot.occupancyPercent}%`}{" "}
            • Zone: {bestLot.zoneType}
          </p>

          <p style={{ color: "#16a34a", fontWeight: 600 }}>
            Lowest forecasted occupancy in your selected access category, based on historical patterns.
          </p>
        </div>
      )}

      {/* ASK AI */}
      <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 8px 20px rgba(0,0,0,.05)",
          marginBottom: 24,
        }}
      >
        <h2 style={{ color: "#be123c", marginTop: 0 }}>Ask the AI</h2>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>
          Questions go to <code>POST /api/parking/ask</code>: lot forecasts and recommendations use stored
          historical snapshots; permit and policy questions use Marist's official Parking FAQ when matched.
          Time-based parking questions may also include optional advisory context from Marist's official
          athletics composite schedule.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitAsk();
              }
            }}
            placeholder="Try: which faculty lot is usually best around 11am?"
            style={{
              flex: 1,
              minWidth: 260,
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
            }}
          />
          <button
            onClick={() => void submitAsk()}
            disabled={askLoading}
            style={{
              padding: "10px 16px",
              border: "none",
              borderRadius: 10,
              cursor: askLoading ? "not-allowed" : "pointer",
              background: "#be123c",
              color: "white",
              fontWeight: 600,
              opacity: askLoading ? 0.7 : 1,
            }}
          >
            {askLoading ? "Asking..." : "Ask"}
          </button>
        </div>
        {askError && <p style={{ color: "#b91c1c", marginBottom: 0 }}>{askError}</p>}
        {askResult && (
          <div
            id="ask-result"
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
            }}
          >
            <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Intent: {askResult.intent}
            </p>
            <p style={{ margin: 0, color: "#334155", whiteSpace: "pre-wrap" }}>
              {askResult.answer.trim() === ""
                ? "(Empty answer from API — check backend logs and response shape.)"
                : askResult.answer}
            </p>
            {askResult.intent === "parking_rules_faq" && askResult.sourceUrl && (
              <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#64748b" }}>
                {askResult.sourceTitle ?? "Source"}:{" "}
                <a href={askResult.sourceUrl} target="_blank" rel="noreferrer">
                  {askResult.sourceUrl}
                </a>
                {askResult.lastCheckedAt && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    FAQ text last fetched: {new Date(askResult.lastCheckedAt).toLocaleString()}
                  </span>
                )}
              </p>
            )}
            {askResult.sourceType === "official_athletics_schedule" && askResult.sourceUrl && (
              <p style={{ margin: "10px 0 0 0", fontSize: 12, color: "#64748b" }}>
                Athletics schedule (advisory):{" "}
                <a href={askResult.sourceUrl} target="_blank" rel="noreferrer">
                  {askResult.sourceUrl}
                </a>
                {askResult.lastCheckedAt && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    Schedule data last checked: {new Date(askResult.lastCheckedAt).toLocaleString()}
                  </span>
                )}
                {askResult.eventTitle && (
                  <span style={{ display: "block", marginTop: 4 }}>
                    Matched event: {askResult.eventTitle}
                    {askResult.eventTime ? ` (${askResult.eventTime})` : ""}
                  </span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* LOT LIST */}
      <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 8px 20px rgba(0,0,0,.05)",
        }}
      >
        <h2 style={{ color: "#be123c", marginTop: 0 }}>
          Parking Lots and Forecast Snapshot
        </h2>

        {availableLots.map((lot) => {
          const occupancyFraction =
            lot.occupancyPercent === null ? null : lot.occupancyPercent / 100;

          return (
            <div
              key={lot.lotCode}
              style={{
                borderBottom: "1px solid #e5e7eb",
                padding: "18px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <strong>
                  {lot.lotName} ({lot.lotCode})
                </strong>
                <strong style={{ color: occupancyFraction === null ? "#64748b" : getColor(occupancyFraction) }}>
                  {lot.occupancyPercent === null ? "Unknown" : `${lot.occupancyPercent}%`}
                </strong>
              </div>

              <div
                style={{
                  background: "#e5e7eb",
                  height: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                {occupancyFraction !== null && (
                  <div
                    style={{
                      width: percent(occupancyFraction),
                      height: "100%",
                      background: getColor(occupancyFraction),
                    }}
                  />
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                  color: "#6b7280",
                  fontSize: 14,
                }}
              >
                <span>Zone: {lot.zoneType}</span>
                <span>
                  Historical sample:{" "}
                  {lot.latestSnapshotTime === null
                    ? "—"
                    : new Date(lot.latestSnapshotTime).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
