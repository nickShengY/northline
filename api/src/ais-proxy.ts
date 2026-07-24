/**
 * AISStream WebSocket Proxy Server
 *
 * This Cloudflare Worker acts as a secure proxy between the browser and AISStream.io
 * Bypasses CORS restrictions and protects the API key
 *
 * Features:
 * - WebSocket relay to AISStream
 * - Vessel data caching
 * - AI-powered risk analysis
 * - Real-time broadcasting to connected clients
 */

import { DurableObject } from "cloudflare:workers";

interface Env {
  AISSTREAM_API_KEY: string;
  VESSEL_DATA_CACHE: DurableObjectNamespace<VesselDataCache>;
  AI_RISK_ANALYZER: DurableObjectNamespace<AIRiskAnalyzer>;
}

// Durable Object for caching vessel data
export class VesselDataCache extends DurableObject {
  private vessels = new Map<string, VesselInfo>();
  private lastUpdate = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/vessels":
        return this.getVessels();
      case "/vessel":
        return this.getVessel(url.searchParams.get("mmsi") || "");
      case "/nearby":
        return this.getNearbyVessels(
          parseFloat(url.searchParams.get("lat") || "0"),
          parseFloat(url.searchParams.get("lon") || "0"),
          parseFloat(url.searchParams.get("radius") || "10")
        );
      case "/stats":
        return this.getStats();
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async updateVessel(vessel: VesselInfo) {
    this.vessels.set(vessel.mmsi, {
      ...this.vessels.get(vessel.mmsi),
      ...vessel,
      lastUpdated: Date.now()
    });
    this.lastUpdate = Date.now();
  }

  private getVessels(): Response {
    const vesselList = Array.from(this.vessels.values());
    return new Response(JSON.stringify({
      vessels: vesselList,
      count: vesselList.length,
      lastUpdate: this.lastUpdate
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private getVessel(mmsi: string): Response {
    const vessel = this.vessels.get(mmsi);
    if (!vessel) {
      return new Response(JSON.stringify({ error: "Vessel not found" }), { status: 404 });
    }
    return new Response(JSON.stringify(vessel), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private getNearbyVessels(lat: number, lon: number, radiusNm: number): Response {
    const nearby = Array.from(this.vessels.values()).filter(v => {
      if (!v.latitude || !v.longitude) return false;
      const distance = haversineDistance(lat, lon, v.latitude, v.longitude);
      return distance <= radiusNm;
    });

    return new Response(JSON.stringify({
      vessels: nearby,
      center: { lat, lon },
      radius: radiusNm,
      count: nearby.length
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private getStats(): Response {
    const vessels = Array.from(this.vessels.values());
    const byType = vessels.reduce((acc, v) => {
      const type = v.vesselType ?? "unknown";
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return new Response(JSON.stringify({
      totalVessels: vessels.length,
      byType,
      avgSpeed: vessels.reduce((sum, v) => sum + (v.speedOverGround || 0), 0) / vessels.length,
      lastUpdate: this.lastUpdate
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
}

// AI Risk Analyzer Durable Object
export class AIRiskAnalyzer extends DurableObject {
  private riskHistory: RiskAssessment[] = [];
  private vesselBehaviorModels = new Map<string, VesselBehaviorModel>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/assess":
        return this.assessRisk(request);
      case "/predict":
        return this.predictCollision(request);
      case "/recommendations":
        return this.getRecommendations(request);
      case "/behavior":
        return this.analyzeBehavior(request);
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async assessRisk(request: Request): Promise<Response> {
    const { vessels, weather, fishingZone } = await request.json() as {
      vessels: VesselInfo[];
      weather: WeatherConditions;
      fishingZone: { lat: number; lon: number; radius: number };
    };

    const risks: RiskAssessment[] = [];

    // Analyze each vessel
    for (const vessel of vessels) {
      const risk = this.calculateVesselRisk(vessel, weather, fishingZone);
      risks.push(risk);
    }

    // Store in history
    this.riskHistory.push(...risks);
    if (this.riskHistory.length > 1000) {
      this.riskHistory = this.riskHistory.slice(-500);
    }

    return new Response(JSON.stringify({
      assessments: risks,
      overallRisk: this.calculateOverallRisk(risks),
      timestamp: Date.now()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  async predictCollision(request: Request): Promise<Response> {
    const { vesselA, vesselB, timeHorizon = 30 } = await request.json() as {
      vesselA: VesselInfo;
      vesselB: VesselInfo;
      timeHorizon?: number; // minutes
    };

    const prediction = this.predictCollisionRisk(vesselA, vesselB, timeHorizon);

    return new Response(JSON.stringify(prediction), {
      headers: { "Content-Type": "application/json" }
    });
  }

  async getRecommendations(request: Request): Promise<Response> {
    const { tripData, weather, mode } = await request.json() as {
      tripData: TripData;
      weather: WeatherConditions;
      mode: "OFFSHORE" | "ICE";
    };

    const recommendations = this.generateAIRecommendations(tripData, weather, mode);

    return new Response(JSON.stringify({
      recommendations,
      confidence: recommendations.map(r => r.confidence),
      generatedAt: Date.now()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  async analyzeBehavior(request: Request): Promise<Response> {
    const { mmsi, observations } = await request.json() as {
      mmsi: string;
      observations: VesselObservation[];
    };

    const model = this.buildBehaviorModel(mmsi, observations);
    this.vesselBehaviorModels.set(mmsi, model);

    return new Response(JSON.stringify({
      mmsi,
      model,
      anomalyScore: this.detectAnomalies(observations),
      typicalPatterns: model.patterns
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  private calculateVesselRisk(
    vessel: VesselInfo,
    weather: WeatherConditions,
    fishingZone: { lat: number; lon: number; radius: number }
  ): RiskAssessment {
    let riskScore = 0;
    const factors: string[] = [];

    // Weather risk
    if (weather.waveHeight > 4) {
      riskScore += 30;
      factors.push("High waves: " + weather.waveHeight.toFixed(1) + "m");
    }
    if (weather.windSpeed > 35) {
      riskScore += 25;
      factors.push("High winds: " + weather.windSpeed.toFixed(0) + "km/h");
    }

    // Speed risk in fishing zone
    if (vessel.latitude != null && vessel.longitude != null) {
      const distanceToZone = haversineDistance(
        vessel.latitude, vessel.longitude,
        fishingZone.lat, fishingZone.lon
      );

      if (distanceToZone < fishingZone.radius && (vessel.speedOverGround ?? 0) > 12) {
        riskScore += 40;
        factors.push("High speed in fishing zone: " + (vessel.speedOverGround ?? 0).toFixed(1) + "kn");
      }
    }

    // CPA (Closest Point of Approach) risk
    if (vessel.cpa && vessel.cpa.distance < 0.5 && vessel.cpa.time < 30) {
      riskScore += 50;
      factors.push("Close approach in " + vessel.cpa.time.toFixed(0) + "min");
    }

    // Vessel type risk
    const dangerousTypes = [55, 70, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89]; // Various tankers and dangerous cargo
    if (dangerousTypes.includes(vessel.vesselType || 0)) {
      riskScore += 20;
      factors.push("Vessel carrying dangerous cargo");
    }

    // Determine risk level
    let level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
    if (riskScore >= 80) level = "CRITICAL";
    else if (riskScore >= 50) level = "HIGH";
    else if (riskScore >= 25) level = "MODERATE";
    else level = "LOW";

    return {
      mmsi: vessel.mmsi,
      vesselName: vessel.name,
      riskScore,
      level,
      factors,
      timestamp: Date.now(),
      location: { lat: vessel.latitude, lon: vessel.longitude },
      recommendation: this.getRiskRecommendation(level, factors)
    };
  }

  private predictCollisionRisk(
    vesselA: VesselInfo,
    vesselB: VesselInfo,
    timeHorizon: number
  ): CollisionPrediction {
    // Vector-based CPA calculation
    const positions = this.projectPositions(vesselA, vesselB, timeHorizon);
    let minDistance = Infinity;
    let cpaTime = 0;

    for (let t = 0; t <= timeHorizon; t += 1) {
      const idx = t;
      const position = positions[idx];
      if (!position || idx >= positions.length) break;

      const dist = haversineDistance(
        position.a.lat, position.a.lon,
        position.b.lat, position.b.lon
      );

      if (dist < minDistance) {
        minDistance = dist;
        cpaTime = t;
      }
    }

    const willCollide = minDistance < 0.5; // 0.5 nautical miles
    const riskLevel = willCollide ? "CRITICAL" : minDistance < 1 ? "HIGH" : minDistance < 2 ? "MODERATE" : "LOW";

    return {
      vesselA: { mmsi: vesselA.mmsi, name: vesselA.name },
      vesselB: { mmsi: vesselB.mmsi, name: vesselB.name },
      cpaDistance: minDistance,
      cpaTime,
      willCollide,
      riskLevel,
      recommendation: willCollide
        ? `URGENT: Alter course immediately! Collision predicted in ${cpaTime} minutes`
        : minDistance < 1
          ? `WARNING: Close approach in ${cpaTime} minutes. Monitor closely.`
          : `Safe passage predicted. CPA: ${minDistance.toFixed(2)}nm in ${cpaTime}min`
    };
  }

  private projectPositions(
    vesselA: VesselInfo,
    vesselB: VesselInfo,
    minutes: number
  ): Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }> {
    const positions: Array<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }> = [];

    for (let t = 0; t <= minutes; t++) {
      const hours = t / 60;

      // Default positions
      let newA = { lat: vesselA.latitude ?? 0, lon: vesselA.longitude ?? 0 };
      let newB = { lat: vesselB.latitude ?? 0, lon: vesselB.longitude ?? 0 };

      // Project position A
      const distA = (vesselA.speedOverGround ?? 0) * hours; // nautical miles
      if (vesselA.latitude != null && vesselA.longitude != null) {
        newA = this.projectPosition(
          vesselA.latitude, vesselA.longitude,
          distA, vesselA.courseOverGround || vesselA.heading || 0
        );
      }

      // Project position B
      const distB = (vesselB.speedOverGround ?? 0) * hours;
      if (vesselB.latitude != null && vesselB.longitude != null) {
        newB = this.projectPosition(
          vesselB.latitude, vesselB.longitude,
          distB, vesselB.courseOverGround || vesselB.heading || 0
        );
      }

      positions.push({ a: newA, b: newB });
    }

    return positions;
  }

  private projectPosition(
    lat: number, lon: number,
    distanceNm: number, courseDegrees: number
  ): { lat: number; lon: number } {
    const R = 3440; // Earth radius in nautical miles
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const course = courseDegrees * Math.PI / 180;
    const angularDist = distanceNm / R;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(course)
    );

    const lon2 = lon1 + Math.atan2(
      Math.sin(course) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
      lat: lat2 * 180 / Math.PI,
      lon: lon2 * 180 / Math.PI
    };
  }

  private generateAIRecommendations(
    tripData: TripData,
    weather: WeatherConditions,
    mode: "OFFSHORE" | "ICE"
  ): AIRecommendation[] {
    const recommendations: AIRecommendation[] = [];

    // Weather-based recommendations
    if (weather.waveHeight > 3) {
      recommendations.push({
        type: "SAFETY",
        priority: "HIGH",
        message: `Rough seas (${weather.waveHeight.toFixed(1)}m). Consider delaying gear operations.`,
        confidence: 0.85,
        action: "Monitor conditions hourly"
      });
    }

    // Mode-specific recommendations
    if (mode === "OFFSHORE") {
      // King crab specific
      if (tripData.catchRate && tripData.catchRate < 50) {
        recommendations.push({
          type: "EFFICIENCY",
          priority: "MEDIUM",
          message: "Low catch rate detected. Consider moving to grid " + this.suggestNewGrid(tripData),
          confidence: 0.72,
          action: "Review historical catch data for nearby grids"
        });
      }

      if (tripData.gearDepth && tripData.gearDepth > 100) {
        recommendations.push({
          type: "SAFETY",
          priority: "HIGH",
          message: "Deep gear deployment. Extended soak time required.",
          confidence: 0.91,
          action: "Increase soak time by 20-30 minutes"
        });
      }
    } else {
      // Ice fishing specific
      if (weather.temperature > -2) {
        recommendations.push({
          type: "SAFETY",
          priority: "CRITICAL",
          message: "WARNING: Ice may be unstable at " + weather.temperature.toFixed(1) + "°C",
          confidence: 0.94,
          action: "Check ice thickness before operations"
        });
      }

      recommendations.push({
        type: "EFFICIENCY",
        priority: "MEDIUM",
        message: "Ice fishing optimal in current conditions",
        confidence: 0.78,
        action: "Maintain standard check-in intervals"
      });
    }

    // Sync health recommendation
    if (tripData.syncLatency && tripData.syncLatency > 60) {
      recommendations.push({
        type: "TECHNICAL",
        priority: "HIGH",
        message: "High sync latency detected. Offline mode recommended.",
        confidence: 0.88,
        action: "Enable offline-first mode on all devices"
      });
    }

    return recommendations;
  }

  private suggestNewGrid(tripData: TripData): string {
    // Simple grid suggestion based on nearby areas
    // In production, this would use historical catch data
    const currentGrid = tripData.currentGrid || "8A";
    const gridLetter = currentGrid.charAt(currentGrid.length - 1);
    const nextGrid = String.fromCharCode(gridLetter.charCodeAt(0) + 1);
    return currentGrid.replace(gridLetter, nextGrid);
  }

  private buildBehaviorModel(mmsi: string, observations: VesselObservation[]): VesselBehaviorModel {
    // Analyze patterns
    const speeds = observations.map(o => o.speed).filter(s => s > 0);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;

    const courses = observations.map(o => o.course);
    const courseChanges = courses.slice(1).map((c, i) =>
      Math.abs(c - (courses[i] ?? c))
    ).filter(c => c > 5);

    return {
      mmsi,
      avgSpeed,
      typicalCourseChanges: courseChanges.length / observations.length,
      patterns: this.identifyPatterns(observations),
      lastUpdated: Date.now()
    };
  }

  private identifyPatterns(observations: VesselObservation[]): string[] {
    if (observations.length < 2) return [];

    const patterns: string[] = [];

    // Check for circling pattern
    const courseChanges = observations.slice(1).map((o, i) =>
      o.course - (observations[i]?.course ?? 0)
    );
    const totalChange = courseChanges.reduce((a, b) => a + b, 0);

    if (Math.abs(totalChange) > 300) {
      patterns.push("CIRCLING");
    }

    // Check for stationary
    const stationaryCount = observations.filter(o => o.speed < 1).length;
    if (stationaryCount > observations.length * 0.8) {
      patterns.push("STATIONARY");
    }

    // Check for steady transit
    if (observations.length > 0 && observations[0]) {
      const steadySpeed = observations.every((o, i, arr) =>
        i === 0 || Math.abs(o.speed - (arr[i-1]?.speed ?? 0)) < 2
      );
      if (steadySpeed && observations[0].speed > 5) {
        patterns.push("STEADY_TRANSIT");
      }
    }

    return patterns;
  }

  private detectAnomalies(observations: VesselObservation[]): number {
    if (observations.length < 3) return 0;

    const speeds = observations.map(o => o.speed);
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const variance = speeds.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / speeds.length;
    const stdDev = Math.sqrt(variance);

    // Count anomalies (values > 2 std dev from mean)
    const anomalies = speeds.filter(s => Math.abs(s - mean) > 2 * stdDev).length;
    return anomalies / speeds.length;
  }

  private calculateOverallRisk(risks: RiskAssessment[]): { level: string; score: number } {
    const critical = risks.filter(r => r.level === "CRITICAL").length;
    const high = risks.filter(r => r.level === "HIGH").length;
    const avgScore = risks.reduce((sum, r) => sum + r.riskScore, 0) / risks.length;

    let level = "LOW";
    if (critical > 0) level = "CRITICAL";
    else if (high > 2) level = "HIGH";
    else if (avgScore > 30) level = "MODERATE";

    return { level, score: avgScore };
  }

  private getRiskRecommendation(level: string, factors: string[]): string {
    const baseMsg = `Risk Level: ${level}. `;
    if (factors.length === 0) return baseMsg + "No significant risk factors.";

    if (level === "CRITICAL") {
      return baseMsg + "IMMEDIATE ACTION REQUIRED: " + factors[0];
    } else if (level === "HIGH") {
      return baseMsg + "Monitor closely. Primary concern: " + factors[0];
    } else {
      return baseMsg + "Stay aware of: " + factors.slice(0, 2).join("; ");
    }
  }
}

// Main WebSocket handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API endpoints
    if (url.pathname.startsWith("/api/")) {
      return handleAPI(request, env, url);
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      return handleWebSocket(request, env);
    }

    return new Response("Northline AIS Proxy Server", { status: 200 });
  }
};

async function handleAPI(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace("/api", "");
  const durableObjectUrl = new URL(request.url);
  durableObjectUrl.pathname = path;
  const durableObjectRequest = new Request(durableObjectUrl.toString(), request);

  // Route to appropriate Durable Object
  if (
    path.startsWith("/vessel") ||
    path.startsWith("/nearby") ||
    path.startsWith("/stats")
  ) {
    const id = env.VESSEL_DATA_CACHE.idFromName("cache");
    const cache = env.VESSEL_DATA_CACHE.get(id);
    return cache.fetch(durableObjectRequest);
  }

  if (path.startsWith("/risk") || path.startsWith("/ai")) {
    const id = env.AI_RISK_ANALYZER.idFromName("analyzer");
    const analyzer = env.AI_RISK_ANALYZER.get(id);
    return analyzer.fetch(durableObjectRequest);
  }

  return new Response("Unknown API endpoint", { status: 404 });
}

async function handleWebSocket(request: Request, env: Env): Promise<Response> {
  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];

  if (!server) {
    return new Response("WebSocket creation failed", { status: 500 });
  }

  // Connect to AISStream
  const aisSocket = new WebSocket("wss://stream.aisstream.io/v0/stream");

  // Get bounding box from query params or use default (Bering Sea)
  const url = new URL(request.url);
  const bbox = url.searchParams.get("bbox") || "[[[50,-170],[70,-130]]]";
  const boundingBoxes = JSON.parse(bbox);

  // Subscribe to AISStream
  aisSocket.addEventListener("open", () => {
    const subscription = {
      APIKey: env.AISSTREAM_API_KEY,
      BoundingBoxes: boundingBoxes,
      FilterMessageTypes: ["PositionReport", "ShipStaticData", "StaticDataReport"]
    };
    aisSocket.send(JSON.stringify(subscription));
  });

  // Relay messages from AISStream to client
  aisSocket.addEventListener("message", async (event) => {
    try {
      const rawData =
        typeof event.data === "string"
          ? event.data
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : await event.data.text();
      const data = JSON.parse(rawData);

      // Process and enhance the data
      const enhanced = enhanceAISData(data);

      // Send to client
      server.send(JSON.stringify(enhanced));
    } catch (err) {
      console.error("Failed to process AIS message:", err);
    }
  });

  // Handle client disconnect
  server.addEventListener("close", () => {
    aisSocket.close();
  });

  // Accept the WebSocket
  server.accept();

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}

function enhanceAISData(data: any): VesselInfo {
  // Extract data from different AIS message types
  const metadata = data.MetaData || {};
  const message = data.Message || {};
  const positionReport = message.PositionReport || {};
  const staticData = message.ShipStaticData || {};
  const staticReport = message.StaticDataReport || {};

  return {
    mmsi: String(metadata.MMSI || positionReport.UserID || staticData.UserID || "Unknown"),
    name: metadata.ShipName?.trim() ||
          staticData.Name?.trim() ||
          staticReport.ReportA?.Name?.trim() ||
          "Unknown Vessel",
    callSign: staticData.CallSign || staticReport.ReportB?.CallSign || null,
    imoNumber: staticData.ImoNumber || null,
    vesselType: staticData.Type || staticReport.ReportB?.ShipType || metadata.type || null,

    // Position data
    latitude: positionReport.Latitude || metadata.Latitude || null,
    longitude: positionReport.Longitude || metadata.Longitude || null,

    // Movement data
    speedOverGround: positionReport.Sog !== undefined ? positionReport.Sog : null,
    courseOverGround: positionReport.Cog !== undefined ? positionReport.Cog : null,
    heading: positionReport.TrueHeading !== undefined ? positionReport.TrueHeading :
             positionReport.Cog !== undefined ? positionReport.Cog : null,

    // Navigation status
    navigationalStatus: positionReport.NavigationalStatus || null,
    status: getNavigationalStatusName(positionReport.NavigationalStatus),

    // Vessel dimensions
    dimension: staticData.Dimension || staticReport.ReportB?.Dimension || null,
    length: staticData.Dimension ?
            (staticData.Dimension.A + staticData.Dimension.B) : null,
    width: staticData.Dimension ?
           (staticData.Dimension.C + staticData.Dimension.D) : null,

    // Destination and route
    destination: staticData.Destination || null,
    eta: staticData.Eta || null,
    draught: staticData.MaximumStaticDraught || null,

    // Metadata
    timestamp: new Date().toISOString(),
    messageType: data.MessageType,
    lastUpdated: Date.now()
  };
}

function getNavigationalStatusName(status: number | null): string {
  if (status === null) return "Unknown";
  const statuses: Record<number, string> = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuvrability",
    4: "Constrained by her draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    9: "Reserved",
    10: "Reserved",
    11: "Power-driven vessel towing astern",
    12: "Power-driven vessel pushing ahead or towing alongside",
    13: "Reserved",
    14: "AIS-SART / MOB / EPIRB",
    15: "Undefined"
  };
  return statuses[status] || "Unknown";
}

function haversineDistance(lat1: number | null, lon1: number | null, lat2: number, lon2: number): number {
  if (lat1 == null || lon1 == null) return Infinity;
  const R = 3440; // Earth radius in nautical miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Type definitions
interface VesselInfo {
  mmsi: string;
  name: string;
  callSign?: string | null;
  imoNumber?: number | null;
  vesselType?: number | null;
  latitude: number | null;
  longitude: number | null;
  speedOverGround: number | null;
  courseOverGround: number | null;
  heading: number | null;
  navigationalStatus: number | null;
  status: string;
  dimension?: { A: number; B: number; C: number; D: number } | null;
  length?: number | null;
  width?: number | null;
  destination?: string | null;
  eta?: { Day: number; Hour: number; Minute: number; Month: number } | null;
  draught?: number | null;
  timestamp: string;
  messageType?: string;
  lastUpdated: number;
  cpa?: { distance: number; time: number };
}

interface WeatherConditions {
  waveHeight: number;
  windSpeed: number;
  temperature: number;
  seaSurfaceTemperature?: number;
}

interface TripData {
  catchRate?: number;
  gearDepth?: number;
  currentGrid?: string;
  syncLatency?: number;
}

interface RiskAssessment {
  mmsi: string;
  vesselName: string;
  riskScore: number;
  level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  factors: string[];
  timestamp: number;
  location: { lat: number | null; lon: number | null };
  recommendation: string;
}

interface CollisionPrediction {
  vesselA: { mmsi: string; name: string };
  vesselB: { mmsi: string; name: string };
  cpaDistance: number;
  cpaTime: number;
  willCollide: boolean;
  riskLevel: string;
  recommendation: string;
}

interface AIRecommendation {
  type: "SAFETY" | "EFFICIENCY" | "TECHNICAL";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  confidence: number;
  action: string;
}

interface VesselObservation {
  timestamp: number;
  speed: number;
  course: number;
  lat: number;
  lon: number;
}

interface VesselBehaviorModel {
  mmsi: string;
  avgSpeed: number;
  typicalCourseChanges: number;
  patterns: string[];
  lastUpdated: number;
}
