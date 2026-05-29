import { useEffect, useMemo, useState } from "react";

interface LLMUsageLog {
  timestamp: string;
  model: string;
  requestType: string;
  success: boolean;
  responseTime: number;
}

export function LLMUsageDashboard() {
  const [logs, setLogs] = useState<LLMUsageLog[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;

    console.log = (...args) => {
      originalLog(...args);
      const message = args.join(" ");
      if (!message.includes("Successfully used model:")) return;
      const match = message.match(/Successfully used model: (.+?) for (.+?)(?:\s|$)/);
      if (!match) return;
      const [, model, requestType] = match;
      if (!model || !requestType) return;
      setLogs((prev) => [
        ...prev.slice(-19),
        {
          timestamp: new Date().toLocaleTimeString(),
          model,
          requestType,
          success: true,
          responseTime: 0
        }
      ]);
    };

    console.warn = (...args) => {
      originalWarn(...args);
      const message = args.join(" ");
      if (!message.includes("failed for") || !message.includes("trying next fallback")) return;
      const match = message.match(/Model (.+?) failed for (.+?), trying next fallback/);
      if (!match) return;
      const [, model, requestType] = match;
      if (!model || !requestType) return;
      setLogs((prev) => [
        ...prev.slice(-19),
        {
          timestamp: new Date().toLocaleTimeString(),
          model,
          requestType,
          success: false,
          responseTime: 0
        }
      ]);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
    };
  }, []);

  const stats = useMemo(() => {
    const summary: Record<string, { total: number; success: number; failed: number; avgTime: number }> = {};
    for (const log of logs) {
      if (!summary[log.model]) {
        summary[log.model] = { total: 0, success: 0, failed: 0, avgTime: 0 };
      }
      const row = summary[log.model];
      if (!row) continue;
      row.total += 1;
      if (log.success) {
        row.success += 1;
        row.avgTime = (row.avgTime * (row.success - 1) + log.responseTime) / row.success;
      } else {
        row.failed += 1;
      }
    }
    return summary;
  }, [logs]);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="secondary"
        style={{ position: "fixed", bottom: "1rem", right: "1rem", zIndex: 50 }}
      >
        LLM Usage
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1rem",
        right: "1rem",
        width: "min(25rem, calc(100vw - 2rem))",
        maxHeight: "75vh",
        overflow: "auto",
        zIndex: 50,
        background: "var(--glass-bg)",
        border: "1px solid var(--line-hover)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--glass-shadow)",
        padding: "1rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0 }}>LLM Usage Dashboard</h3>
        <button className="secondary" onClick={() => setIsVisible(false)} style={{ marginTop: 0, padding: "0.25rem 0.5rem" }}>
          Close
        </button>
      </div>

      <div className="list-section" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
        <h4>Model Performance</h4>
        <ul>
          {Object.entries(stats).map(([model, row]) => (
            <li key={model}>
              <strong>{model}</strong> success {row.success}/{row.total}, failed {row.failed}, avg {Math.round(row.avgTime)}ms
            </li>
          ))}
          {!Object.keys(stats).length ? <li>No model activity yet.</li> : null}
        </ul>
      </div>

      <div className="list-section">
        <h4>Recent Activity</h4>
        <ul>
          {logs.slice(-10).reverse().map((log, index) => (
            <li key={`${log.timestamp}-${index}`}>
              <strong>{log.timestamp}</strong> {log.model} {log.requestType} {log.success ? `${Math.round(log.responseTime)}ms` : "fallback"}
            </li>
          ))}
          {!logs.length ? <li>No recent requests.</li> : null}
        </ul>
      </div>
    </div>
  );
}
