import { useEffect, useMemo, useState } from "react";
import "./index.css";
import logo from "./marist-logo.png";
import {
  askParking,
  fetchParkingLots,
  fetchParkingSummary,
  type ParkingAskResponse,
  type ParkingLotListItem,
  type ParkingLotSummary,
} from "./parkingApi";

type UserType = "all" | "resident" | "commuter" | "faculty" | "visitor";
type TimeView = "now" | "1h" | "2h";
interface ForecastParkingLot {
  lotCode: string;
  lotName: string;
  zoneType: string;
  occupancyPercent: number | null;
  latestSnapshotTime: string | null;
}

function getColor(v: number) {
  if (v > 0.8) return "#eab308";
  if (v > 0.6) return "#22c55e";
  return "#2563eb";
}

function percent(v: number) {
  return `${Math.round(v * 100)}%`;
}

function toSearchableText(lot: ForecastParkingLot): string {
  const record = lot as unknown as Record<string, unknown>;
  return [
    lot.lotCode,
    lot.lotName,
    lot.zoneType,
    typeof record.accessType === "string" ? record.accessType : "",
    typeof record.permitType === "string" ? record.permitType : "",
    typeof record.category === "string" ? record.category : "",
    typeof record.tags === "string" ? record.tags : "",
    Array.isArray(record.tags) ? record.tags.join(" ") : "",
  ]
    .join(" ")
    .toLowerCase();
}

function isAccessibleLot(lot: ForecastParkingLot): boolean {
  const text = toSearchableText(lot);
  return /(accessible|accessibility|ada|disabled|disability|handicap)/.test(
    text,
  );
}

function getDistanceRank(lot: ForecastParkingLot): number | null {
  const record = lot as unknown as Record<string, unknown>;
  const candidates = [
    record.distanceMeters,
    record.distanceMiles,
    record.distance,
    record.distanceRank,
    record.rank,
    record.proximityRank,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function getAllowedZoneTypesForAudience(user: UserType): Set<string> | null {
  if (user === "all") {
    return null;
  }

  const allAudienceZoneTypes = [
    "all",
    "all_audiences",
    "allaudiences",
    "mixed",
  ];

  if (user === "resident") {
    return new Set(["resident", "student", ...allAudienceZoneTypes]);
  }
  if (user === "commuter") {
    return new Set(["commuter", "student", ...allAudienceZoneTypes]);
  }
  if (user === "faculty") {
    return new Set(["faculty", ...allAudienceZoneTypes]);
  }
  return new Set(["visitor", ...allAudienceZoneTypes]);
}

export default function App() {
  const [user, setUser] = useState<UserType>("all");
  const [clock, setClock] = useState("");
  const [time, setTime] = useState<TimeView>("now");
  const [apiLots, setApiLots] = useState<ForecastParkingLot[] | null>(null);
  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showAccessibleOnly, setShowAccessibleOnly] = useState(false);
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
    return {
      hour: anchor.getHours(),
      dayOfWeek: anchor.getDay(),
      label: anchor.toLocaleString(),
    };
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
            accessibleOnly: showAccessibleOnly,
          }),
          fetchParkingLots(),
        ]);
        const zoneByCode = new Map<string, string>(
          lotRows.map((row: ParkingLotListItem) => [row.lotCode, row.zoneType]),
        );
        const merged: ForecastParkingLot[] = summaryRows.map(
          (row: ParkingLotSummary) => ({
            ...row,
            zoneType: zoneByCode.get(row.lotCode) ?? row.zoneType,
          }),
        );
        if (!cancelled) {
          setApiLots(merged);
        }
      } catch (err) {
        if (!cancelled) {
          setApiError(
            err instanceof Error ? err.message : "Could not load summary",
          );
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

  const allowedZoneTypes = useMemo(
    () => getAllowedZoneTypesForAudience(user),
    [user],
  );

  // const availableLots = useMemo(() => {
  //   const lots = apiLots ?? [];

  //   if (showAccessibleOnly) {
  //     return [...lots]
  //       .filter((lot) => isAccessibleLot(lot))
  //       .sort((a, b) => {
  //         const distanceA = getDistanceRank(a);
  //         const distanceB = getDistanceRank(b);

  //         if (distanceA !== null && distanceB !== null) {
  //           return distanceA - distanceB;
  //         }
  //         if (distanceA !== null) return -1;
  //         if (distanceB !== null) return 1;

  //         const occupancyA = a.occupancyPercent ?? Number.POSITIVE_INFINITY;
  //         const occupancyB = b.occupancyPercent ?? Number.POSITIVE_INFINITY;
  //         return occupancyA - occupancyB;
  //       });
  //   }

  //   if (!allowedZoneTypes) {
  //     return lots;
  //   }

  //   return lots.filter((lot) =>
  //     allowedZoneTypes.has(lot.zoneType.toLowerCase()),
  //   );
  // }, [allowedZoneTypes, apiLots, showAccessibleOnly]);

  const availableLots = useMemo(() => {
    const lots = apiLots ?? [];

    if (showAccessibleOnly) {
      return [...lots].sort((a, b) => {
        const distanceA = getDistanceRank(a);
        const distanceB = getDistanceRank(b);

        if (distanceA !== null && distanceB !== null) {
          return distanceA - distanceB;
        }
        if (distanceA !== null) return -1;
        if (distanceB !== null) return 1;

        const occupancyA = a.occupancyPercent ?? Number.POSITIVE_INFINITY;
        const occupancyB = b.occupancyPercent ?? Number.POSITIVE_INFINITY;
        return occupancyA - occupancyB;
      });
    }

    if (!allowedZoneTypes) {
      return lots;
    }

    return lots.filter((lot) =>
      allowedZoneTypes.has(lot.zoneType.toLowerCase()),
    );
  }, [allowedZoneTypes, apiLots, showAccessibleOnly]);

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
      if (showAccessibleOnly) {
        const distanceA = getDistanceRank(a);
        const distanceB = getDistanceRank(b);

        if (distanceA !== null && distanceB !== null) {
          return distanceA - distanceB;
        }
        if (distanceA !== null) return -1;
        if (distanceB !== null) return 1;
      }

      const scoreA = a.occupancyPercent ?? Number.POSITIVE_INFINITY;
      const scoreB = b.occupancyPercent ?? Number.POSITIVE_INFINITY;
      return scoreA - scoreB;
    })[0];
  }, [availableLots, showAccessibleOnly]);

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
        document
          .getElementById("ask-result")
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (err) {
      setAskError(
        err instanceof Error ? err.message : "Could not get an answer",
      );
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
            <h1
              style={{
                margin: 0,
                color: "#be123c",
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: "-0.5px",
              }}
            >
              Campus Parking Finder
            </h1>

            <p
              style={{
                margin: "4px 0 0 0",
                color: "#475569",
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              Live Statistics • Smart Recommendations • {clock}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 18,
            flexWrap: "wrap",
          }}
        >
          {["All", "Resident", "Commuter", "Faculty", "Visitor"].map((u) => (
            <button
              key={u}
              onClick={() => setUser(u.toLowerCase() as UserType)}
              style={{
                padding: "10px 16px",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                background: user === u.toLowerCase() ? "#be123c" : "#f1f5f9",
                color: user === u.toLowerCase() ? "white" : "#111827",
                fontWeight: 600,
              }}
            >
              {u}
            </button>
          ))}

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 10,
              background: showAccessibleOnly ? "#fee2e2" : "#f8fafc",
              border: "1px solid #e2e8f0",
              fontWeight: 600,
              color: "#334155",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={showAccessibleOnly}
              onChange={(e) => setShowAccessibleOnly(e.target.checked)}
            />
            Show accessibility spaces
          </label>
        </div>
      </div>

      {/* <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 8px 20px rgba(0,0,0,.05)",
          marginBottom: 24,
        }}
      >
        <h2 style={{ color: "#be123c", marginTop: 0 }}>
          Live lot summary (API)
        </h2>
        <p style={{ marginTop: 0, color: "#64748b", fontSize: 14 }}>
          Data from{" "}
          <code style={{ fontSize: 13 }}>GET /api/parking/summary</code> and{" "}
          <code style={{ fontSize: 13 }}>GET /api/parking/lots</code>.
        </p>

        {apiLoading && <p style={{ color: "#64748b" }}>Loading...</p>}
        {apiError && (
          <p style={{ color: "#b91c1c", fontWeight: 600 }}>
            {apiError}
            <span
              style={{
                display: "block",
                fontWeight: 400,
                fontSize: 14,
                marginTop: 8,
              }}
            >
              Start the server on port 3001 (see <code>server/README.md</code>){" "}
              and use <code>npm run dev</code> here so Vite can proxy{" "}
              <code>/api</code>, or set <code>VITE_API_BASE_URL</code>.
            </span>
          </p>
        )}
        {!apiLoading && !apiError && apiLots && apiLots.length === 0 && (
          <p style={{ color: "#64748b" }}>
            No lots returned yet (empty database or no rows).
          </p>
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
                  <th
                    style={{
                      padding: "8px 6px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Lot code
                  </th>
                  <th
                    style={{
                      padding: "8px 6px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Lot name
                  </th>
                  <th
                    style={{
                      padding: "8px 6px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Zone
                  </th>
                  <th
                    style={{
                      padding: "8px 6px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Occupancy %
                  </th>
                  <th
                    style={{
                      padding: "8px 6px",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    Latest snapshot
                  </th>
                </tr>
              </thead>
              <tbody>
                {apiLots.map((row) => (
                  <tr key={row.lotCode}>
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {row.lotCode}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {row.lotName}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {row.zoneType}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {row.occupancyPercent === null
                        ? "-"
                        : `${row.occupancyPercent}%`}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      {row.latestSnapshotTime === null
                        ? "-"
                        : new Date(row.latestSnapshotTime).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div> */}

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
          ["For you", availableLots.length, "#be123c"],
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
            {showAccessibleOnly
              ? "Showing accessible parking first. If the backend provides distance or rank fields, the nearest spots are prioritized."
              : "Lowest forecasted occupancy in your selected access category, based on historical patterns."}
          </p>
        </div>
      )}

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
          Questions go to <code>POST /api/parking/ask</code>: lot forecasts and
          recommendations use stored historical snapshots; permit and policy
          questions use Marist's official Parking FAQ when matched. Time-based
          parking questions may also include optional advisory context from
          Marist's official athletics composite schedule.
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
        {askError && (
          <p style={{ color: "#b91c1c", marginBottom: 0 }}>{askError}</p>
        )}
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
            <p
              style={{
                margin: "0 0 8px 0",
                fontSize: 12,
                color: "#64748b",
                fontWeight: 600,
              }}
            >
              Intent: {askResult.intent}
            </p>
            <p style={{ margin: 0, color: "#334155", whiteSpace: "pre-wrap" }}>
              {askResult.answer.trim() === ""
                ? "(Empty answer from API - check backend logs and response shape.)"
                : askResult.answer}
            </p>
            {askResult.explanation && (
              <p
                style={{
                  margin: "8px 0 0 0",
                  color: "#475569",
                  fontSize: 14,
                }}
              >
                {askResult.explanation}
              </p>
            )}
            {Array.isArray(askResult.supportingDetails) &&
              askResult.supportingDetails.length > 0 && (
                <ul
                  style={{
                    margin: "8px 0 0 18px",
                    color: "#64748b",
                    fontSize: 13,
                    padding: 0,
                  }}
                >
                  {askResult.supportingDetails.map((detail, idx) => (
                    <li key={`${detail}-${idx}`} style={{ marginBottom: 4 }}>
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            {askResult.disclaimer && (
              <p
                style={{
                  margin: "8px 0 0 0",
                  color: "#64748b",
                  fontSize: 12,
                }}
              >
                {askResult.disclaimer}
              </p>
            )}
            {askResult.intent === "parking_rules_faq" &&
              askResult.sourceUrl && (
                <p
                  style={{
                    margin: "10px 0 0 0",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  {askResult.sourceTitle ?? "Source"}:{" "}
                  <a
                    href={askResult.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {askResult.sourceUrl}
                  </a>
                  {askResult.lastCheckedAt && (
                    <span style={{ display: "block", marginTop: 4 }}>
                      FAQ text last fetched:{" "}
                      {new Date(askResult.lastCheckedAt).toLocaleString()}
                    </span>
                  )}
                </p>
              )}
            {askResult.sourceType === "official_athletics_schedule" &&
              askResult.sourceUrl && (
                <p
                  style={{
                    margin: "10px 0 0 0",
                    fontSize: 12,
                    color: "#64748b",
                  }}
                >
                  Athletics schedule (advisory):{" "}
                  <a
                    href={askResult.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    S{askResult.sourceUrl}
                  </a>
                  {askResult.lastCheckedAt && (
                    <span style={{ display: "block", marginTop: 4 }}>
                      Schedule data last checked:{" "}
                      {new Date(askResult.lastCheckedAt).toLocaleString()}
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

      <div
        style={{
          background: "white",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 8px 20px rgba(0,0,0,.05)",
        }}
      >
        <h2 style={{ color: "#be123c", marginTop: 0 }}>
          {showAccessibleOnly
            ? "Accessible Parking Lots"
            : "Available Parking Lots"}
        </h2>

        {availableLots.length === 0 && (
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            {showAccessibleOnly
              ? "No accessible lots were identified in the current API response."
              : "No lots match the current filter."}
          </p>
        )}

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
                <strong
                  style={{
                    color:
                      occupancyFraction === null
                        ? "#64748b"
                        : getColor(occupancyFraction),
                  }}
                >
                  {lot.occupancyPercent === null
                    ? "Unknown"
                    : `${lot.occupancyPercent}%`}
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
                    ? "-"
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
