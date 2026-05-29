/**
 * EXTERNAL MARINE DATA API CLIENT
 *
 * Integrates with free external APIs for real-world data:
 * - Open-Meteo Marine Weather API (free, no key required)
 * - AISStream.io through the API proxy when server-side credentials are configured.
 */

const OPEN_METEO_BASE = "https://marine-api.open-meteo.com/v1";
const AISSTREAM_WS = "wss://stream.aisstream.io/v0/stream";

export interface MarineWeatherData {
  time: string[];
  waveHeight: number[]; // meters
  waveDirection: number[]; // degrees
  wavePeriod: number[]; // seconds
  windSpeed: number[]; // km/h
  windDirection: number[]; // degrees
  seaSurfaceTemperature: number[]; // celsius
}

export interface AISVesselData {
  mmsi: string;
  name: string;
  latitude: number;
  longitude: number;
  speedOverGround: number; // knots
  courseOverGround: number; // degrees
  heading: number; // degrees
  timestamp: string;
  vesselType: string;
  status: string;
  destination?: string;
}

/**
 * Fetch marine weather forecast from Open-Meteo (FREE - no API key)
 * @param lat Latitude (-90 to 90)
 * @param lon Longitude (-180 to 180)
 * @param days Number of forecast days (1-16)
 */
export async function getMarineWeather(
  lat: number,
  lon: number,
  days: number = 3
): Promise<MarineWeatherData> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    hourly: "wave_height,wave_direction,wave_period,wind_speed_10m,wind_direction_10m,sea_surface_temperature",
    forecast_days: String(days),
    length_unit: "metric",
    speed_unit: "kmh",
    temperature_unit: "celsius"
  });

  const response = await fetch(`${OPEN_METEO_BASE}/marine?${params}`);

  if (!response.ok) {
    throw new Error(`Marine weather API error: ${response.status}`);
  }

  const data = await response.json();

  return {
    time: data.hourly?.time ?? [],
    waveHeight: data.hourly?.wave_height ?? [],
    waveDirection: data.hourly?.wave_direction ?? [],
    wavePeriod: data.hourly?.wave_period ?? [],
    windSpeed: data.hourly?.wind_speed_10m ?? [],
    windDirection: data.hourly?.wind_direction_10m ?? [],
    seaSurfaceTemperature: data.hourly?.sea_surface_temperature ?? []
  };
}

/**
 * Get current weather conditions (latest hour from forecast)
 */
export async function getCurrentMarineConditions(
  lat: number,
  lon: number
): Promise<{
  waveHeight: number;
  waveDirection: number;
  wavePeriod: number;
  windSpeed: number;
  windDirection: number;
  seaSurfaceTemperature: number;
  timestamp: string;
} | null> {
  try {
    const data = await getMarineWeather(lat, lon, 1);

    if (data.time.length === 0) return null;

    // Get the most recent hour
    const now = new Date();
    let closestIndex = 0;
    let minDiff = Infinity;

    for (let i = 0; i < data.time.length; i++) {
      const timeStr = data.time[i];
      if (!timeStr) continue;
      const t = new Date(timeStr);
      const diff = Math.abs(now.getTime() - t.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
    }

    return {
      waveHeight: data.waveHeight[closestIndex] ?? 0,
      waveDirection: data.waveDirection[closestIndex] ?? 0,
      wavePeriod: data.wavePeriod[closestIndex] ?? 0,
      windSpeed: data.windSpeed[closestIndex] ?? 0,
      windDirection: data.windDirection[closestIndex] ?? 0,
      seaSurfaceTemperature: data.seaSurfaceTemperature[closestIndex] ?? 0,
      timestamp: data.time[closestIndex] ?? new Date().toISOString()
    };
  } catch {
    return null;
  }
}

/**
 * AISStream WebSocket Connection for Real-Time Vessel Tracking
 *
 * Usage:
 * const connection = connectAISStream({
 *   onVesselUpdate: (vessel) => console.log(vessel),
 *   boundingBox: [[-180, -90], [180, 90]] // [minLon, minLat], [maxLon, maxLat]
 * });
 *
 * connection.close(); // Disconnect when done
 */
export interface AISStreamOptions {
  apiKey?: string;
  boundingBox?: [[number, number], [number, number]];
  onVesselUpdate: (vessel: AISVesselData) => void;
  onConnect?: () => void;
  onError?: (error: Error) => void;
}

export function connectAISStream(options: AISStreamOptions): { close: () => void } {
  const apiKey = options.apiKey;

  if (!apiKey) {
    console.warn("AISStream browser credentials are disabled. Use the Northline API AIS proxy instead.");
    options.onError?.(new Error("AISStream API proxy required"));
    return { close: () => {} };
  }

  const ws = new WebSocket(AISSTREAM_WS);

  ws.onopen = () => {
    console.log("AISStream connected");
    options.onConnect?.();

    // Subscribe to vessels in bounding box
    const subscriptionMessage = {
      APIKey: apiKey,
      BoundingBoxes: options.boundingBox ? [options.boundingBox] : [[[-180, -90], [180, 90]]],
      FilterMessageTypes: ["PositionReport"]
    };

    ws.send(JSON.stringify(subscriptionMessage));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Handle vessel position reports
      if (message.MessageType === "PositionReport") {
        const report = message.Message?.PositionReport;
        const metadata = message.MetaData;

        if (report && metadata) {
          const vessel: AISVesselData = {
            mmsi: metadata.MMSI || "Unknown",
            name: metadata.ShipName?.trim() || `Vessel ${metadata.MMSI}`,
            latitude: report.Latitude ?? 0,
            longitude: report.Longitude ?? 0,
            speedOverGround: report.Sog ?? 0, // knots
            courseOverGround: report.Cog ?? 0, // degrees
            heading: report.TrueHeading ?? report.Cog ?? 0,
            timestamp: new Date().toISOString(),
            vesselType: metadata.type || "Unknown",
            status: report.NavigationalStatus || "Unknown",
            destination: metadata.Destination
          };

          options.onVesselUpdate(vessel);
        }
      }
    } catch (err) {
      console.error("Failed to parse AIS message:", err);
    }
  };

  ws.onerror = (error) => {
    console.error("AISStream WebSocket error:", error);
    options.onError?.(new Error("AISStream connection failed"));
  };

  ws.onclose = () => {
    console.log("AISStream disconnected");
  };

  return {
    close: () => {
      ws.close();
    }
  };
}

/**
 * Hook-compatible: Get vessels in a specific region (one-time fetch)
 * Note: AISStream is WebSocket-based for real-time. For static data,
 * you may need to use a REST API like MarineTraffic (paid) or cache WebSocket data.
 */
export function useAISVessels(
  boundingBox: [[number, number], [number, number]],
  onUpdate: (vessels: AISVesselData[]) => void
): { close: () => void } {
  const vessels = new Map<string, AISVesselData>();

  return connectAISStream({
    boundingBox,
    onVesselUpdate: (vessel) => {
      vessels.set(vessel.mmsi, vessel);
      // Throttle updates to avoid excessive re-renders
      onUpdate(Array.from(vessels.values()));
    }
  });
}

/**
 * Convert real AIS vessel to Northline VesselPosition format
 */
export function convertAISVesselToNorthline(vessel: AISVesselData): {
  id: string;
  name: string;
  x: number;
  y: number;
  status: "ACTIVE" | "TRANSIT" | "FISHING" | "DOCKED";
  heading: number;
  speed: number;
  lastCheckin: string;
} {
  // Convert lat/lon to 0-100 scale for our tactical map
  const x = ((vessel.longitude + 180) / 360) * 100;
  const y = ((vessel.latitude + 90) / 180) * 100;

  // Determine status based on speed
  let status: "ACTIVE" | "TRANSIT" | "FISHING" | "DOCKED" = "TRANSIT";
  if (vessel.speedOverGround < 0.5) {
    status = "DOCKED";
  } else if (vessel.speedOverGround > 5 && vessel.speedOverGround < 8) {
    status = "FISHING"; // Typical fishing speed
  } else if (vessel.speedOverGround >= 8) {
    status = "TRANSIT";
  }

  return {
    id: vessel.mmsi,
    name: vessel.name,
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    status,
    heading: vessel.heading,
    speed: vessel.speedOverGround,
    lastCheckin: vessel.timestamp
  };
}

/**
 * Weather risk assessment based on marine conditions
 */
export function assessWeatherRisk(conditions: {
  waveHeight: number;
  windSpeed: number;
}): { level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL"; message: string } {
  const { waveHeight, windSpeed } = conditions;

  if (waveHeight > 6 || windSpeed > 50) {
    return {
      level: "CRITICAL",
      message: `Dangerous conditions: ${waveHeight.toFixed(1)}m waves, ${windSpeed.toFixed(0)}km/h winds`
    };
  }

  if (waveHeight > 4 || windSpeed > 35) {
    return {
      level: "HIGH",
      message: `Rough seas: ${waveHeight.toFixed(1)}m waves, ${windSpeed.toFixed(0)}km/h winds`
    };
  }

  if (waveHeight > 2 || windSpeed > 20) {
    return {
      level: "MODERATE",
      message: `Moderate conditions: ${waveHeight.toFixed(1)}m waves, ${windSpeed.toFixed(0)}km/h winds`
    };
  }

  return {
    level: "LOW",
    message: `Calm seas: ${waveHeight.toFixed(1)}m waves, ${windSpeed.toFixed(0)}km/h winds`
  };
}
