import { useEffect, useMemo, useState } from "react";
import "./index.css";
import logo from "./marist-logo.png"; // place your uploaded logo in src folder

type UserType = "resident" | "commuter" | "faculty" | "visitor";
type TimeView = "now" | "1h" | "2h";

interface ParkingLot {
  name: string;
  permit: UserType[];
  spaces: number;
  handicapSpaces: number;
  walk: number;
  occupancy: {
    now: number;
    "1h": number;
    "2h": number;
  };
}

const LOTS: ParkingLot[] = [
  {
    name: "McCann / Sheahan",
    permit: ["resident", "commuter", "faculty"],
    spaces: 220,
    handicapSpaces: 10,
    walk: 4,
    occupancy: { now: 0.6, "1h": 0.72, "2h": 0.55 },
  },
  {
    name: "Foy",
    permit: ["faculty"],
    spaces: 80,
    handicapSpaces: 5,
    walk: 2,
    occupancy: { now: 0.85, "1h": 0.94, "2h": 0.72 },
  },
  {
    name: "Dyson",
    permit: ["faculty"],
    spaces: 75,
    handicapSpaces: 3,
    walk: 3,
    occupancy: { now: 0.78, "1h": 0.86, "2h": 0.66 },
  },
  {
    name: "Beck West",
    permit: ["resident", "commuter", "faculty"],
    spaces: 170,
    handicapSpaces: 8,
    walk: 5,
    occupancy: { now: 0.52, "1h": 0.63, "2h": 0.56 },
  },
  {
    name: "Riverview",
    permit: ["resident", "commuter", "faculty"],
    spaces: 250,
    handicapSpaces: 15,
    walk: 7,
    occupancy: { now: 0.38, "1h": 0.51, "2h": 0.42 },
  },
  {
    name: "Midrise",
    permit: ["visitor", "faculty"],
    spaces: 95,
    handicapSpaces: 5,
    walk: 2,
    occupancy: { now: 0.57, "1h": 0.67, "2h": 0.6 },
  },
];

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

  const availableLots = useMemo(() => {
    return LOTS.filter((lot) => lot.permit.includes(user));
  }, [user]);

  const stats = useMemo(() => {
    let open = 0;
    let busy = 0;
    let full = 0;

    availableLots.forEach((lot) => {
      const occ = lot.occupancy[time];
      if (occ > 0.8) full++;
      else if (occ > 0.6) busy++;
      else open++;
    });

    return { open, busy, full };
  }, [availableLots, time]);

  const bestLot = useMemo(() => {
    return [...availableLots].sort((a, b) => {
      const scoreA = a.occupancy[time] * 100 + a.walk * 4;
      const scoreB = b.occupancy[time] * 100 + b.walk * 4;
      return scoreA - scoreB;
    })[0];
  }, [availableLots, time]);

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
              Live statistics • Smart recommendations • {clock}
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
          ["Open Lots", stats.open, "#2563eb"],
          ["Busy Lots", stats.busy, "#22c55e"],
          ["Nearly Full", stats.full, "#eab308"],
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
          <h2 style={{ marginTop: 0, color: "#be123c" }}>Best Suggested Lot</h2>
          <h3 style={{ marginBottom: 8 }}>{bestLot.name}</h3>

          <p style={{ color: "#475569" }}>
            Occupancy: {percent(bestLot.occupancy[time])} • {bestLot.walk} min
            walk
          </p>

          <p style={{ color: "#16a34a", fontWeight: 600 }}>
            Lowest traffic + closest available option for your permit.
          </p>
        </div>
      )}

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
          Available Parking Lots
        </h2>

        {availableLots.map((lot) => {
          const occ = lot.occupancy[time];
          const free = Math.round(lot.spaces * (1 - occ));

          return (
            <div
              key={lot.name}
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
                <strong>{lot.name}</strong>
                <strong style={{ color: getColor(occ) }}>{percent(occ)}</strong>
              </div>

              <div
                style={{
                  background: "#e5e7eb",
                  height: 10,
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: percent(occ),
                    height: "100%",
                    background: getColor(occ),
                  }}
                />
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
                <span>{free} spots free</span>
                <span>{lot.walk} min walk</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
