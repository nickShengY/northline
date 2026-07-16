import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./landing.css";

export interface LandingExperienceProps {
  onEnterPortal: () => void;
}

type StoryBeat = {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  detail: string;
  tags: readonly string[];
  clip: string;
  poster: string;
  reducedStill: string;
  linger: number;
};

const storyBeats: readonly StoryBeat[] = [
  {
    id: "horizon",
    label: "Fleet",
    eyebrow: "One operational picture",
    title: "One clear line through every operation.",
    body: "Northline turns scattered vessel, trip, gear, and field signals into one calm command view.",
    detail: "A shared picture from shore to wheelhouse",
    tags: ["Fleet awareness", "Role-aware", "Live context"],
    clip: "/landing/video-1080p/01-approach.mp4",
    poster: "/landing/video-1080p/01-approach-poster.webp",
    reducedStill: "/landing/northline-fleet.webp",
    linger: 0.2,
  },
  {
    id: "deck",
    label: "Safety",
    eyebrow: "Vessel & crew safety",
    title: "See the next risk before it becomes the next incident.",
    body: "Keep hazards, crew readiness, and trip context close to the people coordinating the work.",
    detail: "Operational context where decisions happen",
    tags: ["Hazards", "Incidents", "Readiness"],
    clip: "/landing/video-1080p/02-deck.mp4",
    poster: "/landing/video-1080p/02-deck-poster.webp",
    reducedStill: "/landing/northline-safety.webp",
    linger: 0.3,
  },
  {
    id: "bridge",
    label: "Offline",
    eyebrow: "Built beyond the signal",
    title: "The work keeps moving when coverage disappears.",
    body: "Offline-first workflows preserve essential activity at sea and reconcile cleanly when connection returns.",
    detail: "Resilient by design, not as an afterthought",
    tags: ["Offline-first", "Field resilient", "Reliable sync"],
    clip: "/landing/video-1080p/03-bridge.mp4",
    poster: "/landing/video-1080p/03-bridge-poster.webp",
    reducedStill: "/landing/northline-offline-v2.webp",
    linger: 0.34,
  },
  {
    id: "closeout",
    label: "Compliance",
    eyebrow: "Readiness in the workflow",
    title: "Close the trip without opening a paper chase.",
    body: "Track completion, signatures, certificates, and audit history from departure through closeout.",
    detail: "A traceable record, assembled as work happens",
    tags: ["Digital closeout", "Certificates", "Audit history"],
    clip: "/landing/video-1080p/04-closeout.mp4",
    poster: "/landing/video-1080p/04-closeout-poster.webp",
    reducedStill: "/landing/northline-compliance.webp",
    linger: 0.36,
  },
  {
    id: "landing",
    label: "Traceability",
    eyebrow: "From working water to verified record",
    title: "Every landing carries its story forward.",
    body: "Connect trips, lots, certificates, and provenance so the chain of custody stays clear and useful.",
    detail: "One connected line from vessel to verified lot",
    tags: ["Lot provenance", "Chain of custody", "Verified record"],
    clip: "/landing/video-1080p/05-landing.mp4",
    poster: "/landing/video-1080p/05-landing-poster.webp",
    reducedStill: "/landing/northline-traceability.webp",
    linger: 0.25,
  },
] as const;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smooth = (value: number) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const linger = (value: number, amount: number) => {
  const centered = value - 0.5;
  return (1 - amount) * value + amount * (4 * centered * centered * centered + 0.5);
};

export function LandingExperience({ onEnterPortal }: LandingExperienceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const sceneRefs = useRef<Array<HTMLDivElement | null>>([]);
  const copyRefs = useRef<Array<HTMLElement | null>>([]);
  const targetTimes = useRef(storyBeats.map(() => 0));
  const currentTimes = useRef(storyBeats.map(() => 0));
  const objectUrls = useRef<string[]>([]);
  const [activeBeat, setActiveBeat] = useState(0);
  const activeRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    let scrollFrame = 0;
    let animationFrame = 0;
    let stopped = false;
    const loading = new Set<number>();

    const loadVideo = async (index: number) => {
      if (reducedMotion.matches || loading.has(index) || videoRefs.current[index]?.src) return;
      const beat = storyBeats[index];
      if (!beat) return;
      loading.add(index);
      try {
        const response = await fetch(beat.clip);
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        if (stopped) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrls.current.push(url);
        const video = videoRefs.current[index];
        if (video) {
          video.addEventListener("loadedmetadata", requestUpdate, { once: true });
          video.src = url;
        }
      } catch {
        // The premium still remains visible if a clip is unavailable.
      } finally {
        loading.delete(index);
      }
    };

    const loadVideosAround = (index: number) => {
      [index - 1, index, index + 1].forEach((candidate) => {
        if (candidate >= 0 && candidate < storyBeats.length) void loadVideo(candidate);
      });
    };

    const update = () => {
      scrollFrame = 0;
      const rect = root.getBoundingClientRect();
      const available = Math.max(root.offsetHeight - window.innerHeight, 1);
      const progress = clamp(-rect.top / available);
      const scaled = progress * storyBeats.length;
      const index = Math.min(storyBeats.length - 1, Math.floor(scaled));
      const local = index === storyBeats.length - 1 && progress === 1 ? 1 : scaled - index;
      loadVideosAround(index);

      if (index !== activeRef.current) {
        activeRef.current = index;
        setActiveBeat(index);
      }

      root.style.setProperty("--nl-progress", progress.toFixed(4));
      root.style.setProperty("--nl-scene", String(index));

      storyBeats.forEach((beat, sceneIndex) => {
        let opacity = 0;
        if (sceneIndex === index) opacity = 1;
        if (sceneIndex === index + 1) opacity = smooth((local - 0.92) / 0.08);
        sceneRefs.current[sceneIndex]?.style.setProperty("opacity", opacity.toFixed(4));

        const copyOpacity = sceneIndex === index
          ? (sceneIndex === 0 ? smooth(1 - local / 0.78) : sceneIndex === storyBeats.length - 1 ? smooth(local / 0.24) : smooth(1 - Math.abs(local - 0.5) / 0.5))
          : 0;
        copyRefs.current[sceneIndex]?.style.setProperty("opacity", String(copyOpacity));
        copyRefs.current[sceneIndex]?.style.setProperty("transform", reducedMotion.matches ? "none" : `translate3d(0, ${(0.5 - local) * 4}vh, 0)`);
        copyRefs.current[sceneIndex]?.style.setProperty("pointer-events", copyOpacity > 0.5 ? "auto" : "none");

        const video = videoRefs.current[sceneIndex];
        if (video?.duration && Number.isFinite(video.duration)) {
          const sceneLocal = sceneIndex < index
            ? 1
            : sceneIndex === index
              ? linger(clamp(local), beat.linger)
              : 0;
          targetTimes.current[sceneIndex] = clamp(sceneLocal, 0, 0.999) * video.duration;
        }
      });
    };

    const requestUpdate = () => {
      if (!scrollFrame) scrollFrame = window.requestAnimationFrame(update);
    };

    const animate = () => {
      const threshold = coarsePointer ? 0.02 : 0.008;
      videoRefs.current.forEach((video, index) => {
        if (!video || video.readyState < 1 || video.seeking) return;
        const current = currentTimes.current[index] ?? 0;
        const target = targetTimes.current[index] ?? 0;
        const next = current + (target - current) * 0.2;
        currentTimes.current[index] = next;
        if (Math.abs(video.currentTime - next) > threshold) {
          try { video.currentTime = next; } catch { /* decoder not ready */ }
        }
      });
      if (!stopped) animationFrame = window.requestAnimationFrame(animate);
    };

    const prime = () => {
      if (!coarsePointer) return;
      videoRefs.current.forEach((video) => {
        if (!video) return;
        video.muted = true;
        void video.play().then(() => video.pause()).catch(() => undefined);
      });
    };

    update();
    animationFrame = window.requestAnimationFrame(animate);
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate, { passive: true });
    window.addEventListener("pointerdown", prime, { once: true, passive: true });

    return () => {
      stopped = true;
      if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current = [];
    };
  }, []);

  const jumpTo = (index: number) => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const available = Math.max(root.offsetHeight - window.innerHeight, 1);
    window.scrollTo({ top: window.scrollY + root.getBoundingClientRect().top + available * ((index + 0.48) / storyBeats.length), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div
      className="nl-world"
      data-active={activeBeat}
      ref={rootRef}
      style={{ "--nl-progress": "0" } as CSSProperties}
    >
      <a className="nl-world__skip" href="#northline-story">Skip to the story</a>

      <div className="nl-world__stage" aria-live="off">
        <div className="nl-world__scenes" aria-hidden="true">
          {storyBeats.map((beat, index) => (
            <div className="nl-world__scene" key={beat.id} ref={(node) => { sceneRefs.current[index] = node; }}>
              <picture>
                <source media="(prefers-reduced-motion: reduce)" srcSet={beat.reducedStill} />
                <img alt="" decoding={index === 0 ? "sync" : "async"} src={beat.poster} />
              </picture>
              <video
                muted
                playsInline
                preload="metadata"
                ref={(node) => { videoRefs.current[index] = node; }}
                onLoadedData={(event) => event.currentTarget.parentElement?.classList.add("has-video")}
              />
            </div>
          ))}
          <div className="nl-world__grade" />
          <div className="nl-world__grain" />
        </div>

        <header className="nl-world__topbar">
          <button className="nl-world__brand" type="button" onClick={() => jumpTo(0)} aria-label="Northline home">
            <span className="nl-world__brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <span>NORTHLINE</span>
          </button>
          <nav className="nl-world__nav" aria-label="Explore Northline">
            {storyBeats.map((beat, index) => (
              <button className={index === activeBeat ? "is-active" : ""} key={beat.id} onClick={() => jumpTo(index)} type="button">{beat.label}</button>
            ))}
          </nav>
          <button className="nl-world__portal" type="button" onClick={onEnterPortal}>Sign in <span aria-hidden="true">↗</span></button>
        </header>

        <div className="nl-world__copy" id="northline-story">
          {storyBeats.map((beat, index) => (
            <article key={beat.id} ref={(node) => { copyRefs.current[index] = node; }}>
              <p className="nl-world__index">{String(index + 1).padStart(2, "0")} / {String(storyBeats.length).padStart(2, "0")}</p>
              <p className="nl-world__eyebrow">{beat.eyebrow}</p>
              <h1>{beat.title}</h1>
              <p className="nl-world__body">{beat.body}</p>
              <ul>{beat.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
              <p className="nl-world__detail"><span />{beat.detail}</p>
              {index === storyBeats.length - 1 && (
                <div className="nl-world__actions">
                  <button type="button" onClick={onEnterPortal}>Start with Northline <span aria-hidden="true">→</span></button>
                  <button type="button" onClick={() => jumpTo(0)}>Replay the journey</button>
                </div>
              )}
            </article>
          ))}
        </div>

        <div className="nl-world__route" aria-label="Story chapters">
          {storyBeats.map((beat, index) => (
            <button className={index === activeBeat ? "is-active" : ""} key={beat.id} onClick={() => jumpTo(index)} type="button" aria-label={`Go to ${beat.label}`}>
              <span>{beat.label}</span><i />
            </button>
          ))}
        </div>

        <div className="nl-world__progress"><i /></div>
        <div className="nl-world__scroll" aria-hidden="true"><span>Scroll to navigate</span><i /></div>
        <footer><span>NORTH ATLANTIC / WORKING VIEW</span><span>SCROLL-SCRUBBED / 24 FPS</span></footer>
      </div>

      <div className="nl-world__track" aria-hidden="true">
        {storyBeats.map((beat) => <div key={beat.id} />)}
      </div>
    </div>
  );
}
