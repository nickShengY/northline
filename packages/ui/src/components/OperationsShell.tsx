import React, { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface WorkspaceDestination {
  id: string;
  label: string;
  icon: IconName;
}
export function NorthlineBrand({
  subtitle = "Fleet operations",
}: {
  subtitle?: string;
}) {
  return (
    <div className="northline-brand">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M25 4 39 27 29 25 22 14 15 25 7 25Z" fill="currentColor" />
        <path
          d="M3 32Q14 23 25 32T46 31Q35 44 23 37T3 36Z"
          fill="currentColor"
        />
      </svg>
      <div>
        <strong>Northline</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
export function OperationsShell({
  children,
  destinations,
  activeId,
  onNavigate,
  subtitle,
  compact = false,
}: {
  children: React.ReactNode;
  destinations: WorkspaceDestination[];
  activeId: string;
  onNavigate: (id: string) => void;
  subtitle: string;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [time, setTime] = useState(() => new Date());
  const menuButton = useRef<HTMLButtonElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    const timer = window.setInterval(() => setTime(new Date()), 60000);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.clearInterval(timer);
    };
  }, []);
  const navigate = (id: string) => {
    onNavigate(id);
    setQuery("");
    setMenuOpen(false);
    requestAnimationFrame(() => {
      main.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  };
  const matches = destinations.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase().trim()),
  );
  return (
    <div
      className={`operations-shell ${compact ? "operations-shell--field" : ""}`}
    >
      <a href="#workspace-content" className="workspace-skip">
        Skip to workspace
      </a>
      <aside
        className={`workspace-sidebar ${menuOpen ? "is-open" : ""}`}
        id="workspace-navigation"
        aria-label="Workspace navigation"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <NorthlineBrand subtitle={subtitle} />
        <p className="workspace-nav-caption">Workspace</p>
        <nav aria-label={subtitle}>
          {destinations.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={activeId === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              <span className="nav-current-mark" />
            </button>
          ))}
        </nav>
        <div className="workspace-sidebar-footer">
          <Icon name="ShieldCheck" size={20} />
          <div>
            <strong>Built for the working fleet</strong>
            <span>Northline operations workspace</span>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <button
            ref={menuButton}
            className="workspace-menu"
            type="button"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name={menuOpen ? "X" : "Menu"} size={20} />
          </button>
          <div className="workspace-search">
            <Icon name="Search" size={20} />
            <input
              aria-label="Find a workspace screen"
              placeholder="Find a workspace screen…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
                if (event.key === "Enter" && matches[0])
                  navigate(matches[0].id);
              }}
            />
            {query && (
              <div className="workspace-search-results">
                <p>{matches.length ? "Go to screen" : "No matching screens"}</p>
                {matches.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => navigate(item.id)}
                  >
                    <Icon name={item.icon} size={16} />
                    {item.label}
                    <Icon name="ArrowRight" size={16} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <time className="workspace-clock" dateTime={time.toISOString()}>
            <Icon name="Sun" size={20} />
            {time.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            <span>
              {time.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </time>
          <div
            className={`workspace-connection ${online ? "" : "is-offline"}`}
            role="status"
            aria-label={online ? "Device network available" : "Network unavailable"}
          >
            <Icon name={online ? "Radio" : "AlertCircle"} size={24} />
            <div>
              <strong>{online ? "Connected" : "Offline"}</strong>
              <span>
                {online ? "Device network available" : "Network unavailable"}
              </span>
            </div>
          </div>
        </header>
        <main
          id="workspace-content"
          ref={main}
          tabIndex={-1}
          className="workspace-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
