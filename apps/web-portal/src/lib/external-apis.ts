/**
 * EXTERNAL MARINE DATA API CLIENT
 *
 * Integrates with the free Open-Meteo Marine Weather API (no key required).
 * Vessel AIS data flows through the Northline API proxy (see hooks/useAISBackend.ts).
 */

const OPEN_METEO_BASE = "https://marine-api.open-meteo.com/v1";
const MARINE_WEATHER_TIMEOUT_MS = 10000;

function requestTimeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(MARINE_WEATHER_TIMEOUT_MS);
  }
  return undefined;
}

export interface MarineWeatherData {
  time: string[];
  waveHeight: number[]; // meters
  waveDirection: number[]; // degrees
  wavePeriod: number[]; // seconds
  windSpeed: number[]; // km/h
  windDirection: number[]; // degrees
  seaSurfaceTemperature: number[]; // celsius
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

  const response = await fetch(`${OPEN_METEO_BASE}/marine?${params}`, {
    signal: requestTimeoutSignal()
  });

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
