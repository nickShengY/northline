import { Icon, NorthlineBrand } from "@northline/ui";
import "./landing.css";
import overview from "./content/overview.html?raw";

export interface LandingExperienceProps {
  onEnterPortal: () => void;
}

export function LandingExperience({ onEnterPortal }: LandingExperienceProps) {
  return (
    <div className="northline-welcome">
      <header className="welcome-header">
        <a href="#" aria-label="Northline home">
          <NorthlineBrand />
        </a>
        <nav aria-label="Explore Northline">
          <a href="#workspaces">Workspaces</a>
          <a href="#platform">Platform guides</a>
        </nav>
        <button type="button" onClick={onEnterPortal}>
          Open workspace <Icon name="ArrowRight" size={16} />
        </button>
      </header>
      <main>
        <section className="welcome-hero">
          <div className="welcome-hero-copy">
            <span className="welcome-eyebrow">
              <Icon name="Radio" size={16} />
              FROM SHORE TO WHEELHOUSE
            </span>
            <h1>
              Your fleet.
              <br />
              One clear picture.
            </h1>
            <p>
              Keep trips, crew safety, and catch records connected. A calmer
              workspace for the people who keep the fleet moving.
            </p>
            <div className="welcome-actions">
              <button type="button" onClick={onEnterPortal}>
                Enter fleet workspace <Icon name="ArrowRight" size={20} />
              </button>
              <a href="#workspaces">Explore the platform</a>
            </div>
            <div className="welcome-capabilities">
              <span>
                <Icon name="ShieldCheck" size={16} />
                Role-aware access
              </span>
              <span>
                <Icon name="Archive" size={16} />
                Offline field records
              </span>
            </div>
          </div>
          <div className="welcome-visual">
            <img
              src="/landing/northline-fleet.webp"
              alt="Working fishing vessels on northern coastal waters"
            />
            <div className="welcome-photo-caption">
              <Icon name="Ship" size={24} />
              <div>
                <strong>Built around your operation</strong>
                <span>Fleet oversight · Field work · Bridge decisions</span>
              </div>
            </div>
          </div>
        </section>
        <section className="welcome-workspaces" id="workspaces">
          <div className="welcome-section-title">
            <span className="welcome-eyebrow">
              ONE PLATFORM, THREE WORKSPACES
            </span>
            <h2>The right view for every crew.</h2>
            <p>
              Shared context. Purpose-built tools. From planning to the next
              handoff.
            </p>
          </div>
          <div className="welcome-workspace-grid">
            {[
              {
                icon: "Radar" as const,
                number: "01",
                title: "Fleet operations",
                text: "Review trips, monitor risk, and keep certificates and operational records within reach.",
                tags: "Fleet overview / Trips / Compliance",
              },
              {
                icon: "Anchor" as const,
                number: "02",
                title: "Field operations",
                text: "Run safety checks, record hazards, and queue field events when connectivity drops.",
                tags: "Safety / Offline queue / Training",
              },
              {
                icon: "Ship" as const,
                number: "03",
                title: "Vessel operations",
                text: "Keep deck actions, gear status, watch handoffs, and the bridge log in one focused view.",
                tags: "Bridge / Gear / Handoffs",
              },
            ].map((workspace) => (
              <article key={workspace.title}>
                <div className="welcome-card-icon">
                  <Icon name={workspace.icon} size={32} />
                  <span>{workspace.number}</span>
                </div>
                <h3>{workspace.title}</h3>
                <p>{workspace.text}</p>
                <small>{workspace.tags}</small>
              </article>
            ))}
          </div>
        </section>
        <section className="welcome-cta">
          <div>
            <span className="welcome-eyebrow">READY FOR THE NEXT SHIFT</span>
            <h2>Pick up where the crew left off.</h2>
            <p>Sign in to your Northline fleet workspace.</p>
          </div>
          <button type="button" onClick={onEnterPortal}>
            Open workspace <Icon name="ArrowRight" size={20} />
          </button>
        </section>
        <div
          className="welcome-guides"
          dangerouslySetInnerHTML={{ __html: overview.replace("<main ", "<section ").replace("</main>", "</section>").replace("<h1>", "<h2>").replace("</h1>", "</h2>") }}
        />
      </main>
      <footer className="welcome-footer">
        <NorthlineBrand />
        <span>Fleet, field, and vessel operations.</span>
        <a href="#platform">
          Explore the guides <Icon name="ArrowRight" size={16} />
        </a>
      </footer>
    </div>
  );
}
