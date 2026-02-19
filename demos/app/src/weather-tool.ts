/**
 * Structured result for `get_weather` tool responses.
 */
export type WeatherToolResult =
  | {
      feelsLikeF: number | null;
      humidityPercent: number | null;
      location: string;
      status: "ok";
      suggestedQueries: string[];
      summary: string;
      temperatureF: number;
      windSpeedMph: number | null;
    }
  | {
      message: string;
      status: "error" | "not_found";
      suggestedQueries: string[];
    };

const usStateMap: Record<string, string> = {
  AK: "Alaska",
  AL: "Alabama",
  AR: "Arkansas",
  AZ: "Arizona",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  IA: "Iowa",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  MA: "Massachusetts",
  MD: "Maryland",
  ME: "Maine",
  MI: "Michigan",
  MN: "Minnesota",
  MO: "Missouri",
  MS: "Mississippi",
  MT: "Montana",
  NC: "North Carolina",
  ND: "North Dakota",
  NE: "Nebraska",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NV: "Nevada",
  NY: "New York",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VA: "Virginia",
  VT: "Vermont",
  WA: "Washington",
  WI: "Wisconsin",
  WV: "West Virginia",
  WY: "Wyoming",
};

interface NormalizedLocation {
  cityOnly: string | undefined;
  countryBias: string | undefined;
  normalizedLocation: string;
  stateFull: string | undefined;
  suggestedQueries: string[];
}

interface GeocodingResultItem {
  admin1?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
}

interface GeocodingResponse {
  results?: GeocodingResultItem[];
}

interface ForecastResponse {
  current?: {
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
}

/**
 * Normalizes user location input into geocoder-friendly candidates.
 *
 * @param rawLocation User-provided location string.
 * @returns Normalized location metadata.
 */
function normalizeLocation(rawLocation: string): NormalizedLocation {
  const suggestedQueries: string[] = [];
  const trimmed = rawLocation.trim();
  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let countryBias: string | undefined;
  let normalizedLocation = trimmed;
  let cityOnly: string | undefined;
  let stateFull: string | undefined;

  if (parts.length === 2) {
    const stateCode = (parts[1] ?? "").toUpperCase();
    const mappedState = usStateMap[stateCode];
    if (mappedState && parts[0]) {
      cityOnly = parts[0];
      stateFull = mappedState;
      normalizedLocation = `${parts[0]}, ${mappedState}`;
      suggestedQueries.push(`${parts[0]}, ${mappedState}, USA`);
      countryBias = "US";
    }
  }

  if (parts.length >= 3) {
    const tail = (parts[parts.length - 1] ?? "").toLowerCase();
    if (["usa", "us", "united states", "united states of america"].includes(tail)) {
      countryBias = "US";
      normalizedLocation = parts.slice(0, -1).join(", ");
      suggestedQueries.push(`${normalizedLocation}, USA`);

      if (parts.length >= 2) {
        stateFull = parts[parts.length - 2];
        cityOnly = parts.slice(0, -2).join(", ").trim() || undefined;
      }
    }
  }

  if (!suggestedQueries.includes(trimmed)) {
    suggestedQueries.push(trimmed);
  }
  if (!suggestedQueries.includes(normalizedLocation)) {
    suggestedQueries.push(normalizedLocation);
  }

  return {
    cityOnly,
    countryBias,
    normalizedLocation,
    stateFull,
    suggestedQueries,
  };
}

/**
 * Fetches JSON with abort support from a URL.
 *
 * @param url Request URL.
 * @param abortSignal Abort signal from tool runtime.
 * @returns Parsed JSON payload.
 */
async function fetchJson<T>(url: string, abortSignal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status.toString()}`);
  }

  return (await response.json()) as T;
}

/**
 * Builds candidate geocoding query sequence matching cpk-hb behavior.
 *
 * @param rawLocation User-provided location.
 * @param normalized Normalized metadata.
 * @returns Candidate query list.
 */
function buildGeocodingCandidates(
  rawLocation: string,
  normalized: NormalizedLocation,
): Array<{ countryCode: string | undefined; location: string }> {
  const candidates: Array<{ countryCode: string | undefined; location: string }> = [
    {
      countryCode: normalized.countryBias,
      location: normalized.normalizedLocation,
    },
    {
      countryCode: normalized.countryBias,
      location: rawLocation,
    },
    {
      countryCode: undefined,
      location: normalized.normalizedLocation,
    },
    {
      countryCode: undefined,
      location: rawLocation,
    },
  ];

  if (normalized.cityOnly) {
    candidates.unshift({
      countryCode: normalized.countryBias,
      location: normalized.cityOnly,
    });
    candidates.push({
      countryCode: undefined,
      location: normalized.cityOnly,
    });
  }

  return candidates;
}

/**
 * Removes trailing US token when country bias is already provided.
 *
 * @param value Candidate location string.
 * @param countryCode Optional country code.
 * @returns Cleaned location text.
 */
function normalizeCandidateLocation(value: string, countryCode: string | undefined): string {
  if (!countryCode || !value.includes(",")) {
    return value;
  }

  const parts = value.split(",").map((part) => part.trim());
  const tail = (parts[parts.length - 1] ?? "").toLowerCase();

  if (["usa", "us", "united states", "united states of america"].includes(tail)) {
    return parts.slice(0, -1).join(", ");
  }

  return value;
}

/**
 * Fetches and filters geocoding matches by state when available.
 *
 * @param query Query location.
 * @param countryCode Optional country code bias.
 * @param stateFull Optional full state value for strict filtering.
 * @param abortSignal Abort signal.
 * @returns Matched geocoding results.
 */
async function geocodeLocation(
  query: string,
  countryCode: string | undefined,
  stateFull: string | undefined,
  abortSignal: AbortSignal,
): Promise<GeocodingResultItem[]> {
  const params = new URLSearchParams({
    count: "5",
    format: "json",
    language: "en",
    name: normalizeCandidateLocation(query, countryCode),
  });
  if (countryCode) {
    params.set("countryCode", countryCode);
  }

  const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
  const geocodeData = await fetchJson<GeocodingResponse>(geocodeUrl, abortSignal);
  const results = geocodeData.results ?? [];

  if (!stateFull) {
    return results;
  }

  const filtered = results.filter((result) => {
    return (result.admin1 ?? "").toLowerCase() === stateFull.toLowerCase();
  });

  return filtered.length > 0 ? filtered : results;
}

/**
 * Adds formatted location suggestions from geocoding candidates.
 *
 * @param suggestedQueries Existing suggestions.
 * @param results Geocoder results.
 */
function appendSuggestions(suggestedQueries: string[], results: GeocodingResultItem[]): void {
  for (const result of results) {
    const formatted = [result.name, result.admin1, result.country].filter(Boolean).join(", ");
    if (formatted && !suggestedQueries.includes(formatted)) {
      suggestedQueries.push(formatted);
    }
  }
}

/**
 * Gets the current weather for a location using Open-Meteo geocode + forecast APIs.
 *
 * @param location User location input.
 * @param abortSignal Abort signal.
 * @returns Structured weather result.
 */
export async function getWeather(
  location: string,
  abortSignal: AbortSignal,
): Promise<WeatherToolResult> {
  if (!location || location.trim().length === 0) {
    return {
      message: 'Please provide a location in the format "City, State, Country".',
      status: "error",
      suggestedQueries: [],
    };
  }

  const rawLocation = location.trim();
  const normalized = normalizeLocation(rawLocation);
  const candidates = buildGeocodingCandidates(rawLocation, normalized);

  let match: GeocodingResultItem | undefined;
  let hasGeocodeError = false;

  for (const candidate of candidates) {
    try {
      const results = await geocodeLocation(
        candidate.location,
        candidate.countryCode,
        normalized.stateFull,
        abortSignal,
      );

      if (results.length > 0) {
        appendSuggestions(normalized.suggestedQueries, results);
        match = results[0];
        break;
      }
    } catch {
      hasGeocodeError = true;
    }
  }

  if (!match) {
    if (hasGeocodeError) {
      return {
        message: `Sorry, I couldn't look up the location "${rawLocation}" right now.`,
        status: "error",
        suggestedQueries: normalized.suggestedQueries,
      };
    }

    return {
      message: `Sorry, I couldn't find a location match for "${rawLocation}".`,
      status: "not_found",
      suggestedQueries: normalized.suggestedQueries,
    };
  }

  const latitude = match.latitude;
  const longitude = match.longitude;
  const place = [match.name ?? rawLocation, match.admin1, match.country].filter(Boolean).join(", ");

  if (latitude === undefined || longitude === undefined) {
    return {
      message: `Sorry, I couldn't look up coordinates for "${place}".`,
      status: "error",
      suggestedQueries: normalized.suggestedQueries,
    };
  }

  const forecastParams = new URLSearchParams({
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    temperature_unit: "fahrenheit",
    windspeed_unit: "mph",
  });

  try {
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`;
    const forecast = await fetchJson<ForecastResponse>(forecastUrl, abortSignal);
    const current = forecast.current ?? {};
    const temperature = current.temperature_2m;
    const feelsLike = current.apparent_temperature ?? null;
    const humidity = current.relative_humidity_2m ?? null;
    const windSpeed = current.wind_speed_10m ?? null;
    const weatherCode = current.weather_code ?? null;

    if (temperature === undefined) {
      return {
        message: `Sorry, I couldn't read the current weather for ${place}.`,
        status: "error",
        suggestedQueries: normalized.suggestedQueries,
      };
    }

    const details: string[] = [];
    if (feelsLike !== null) {
      details.push(`feels like ${feelsLike.toString()}°F`);
    }
    if (humidity !== null) {
      details.push(`humidity ${humidity.toString()}%`);
    }
    if (windSpeed !== null) {
      details.push(`wind ${windSpeed.toString()} mph`);
    }
    if (weatherCode !== null) {
      details.push(`code ${weatherCode.toString()}`);
    }
    const extra = details.length > 0 ? ` (${details.join(", ")})` : "";

    return {
      feelsLikeF: feelsLike,
      humidityPercent: humidity,
      location: place,
      status: "ok",
      suggestedQueries: normalized.suggestedQueries,
      summary: `The weather for ${place} is ${temperature.toString()}°F${extra}.`,
      temperatureF: temperature,
      windSpeedMph: windSpeed,
    };
  } catch {
    return {
      message: `Sorry, I couldn't fetch the weather for ${place} right now.`,
      status: "error",
      suggestedQueries: normalized.suggestedQueries,
    };
  }
}
