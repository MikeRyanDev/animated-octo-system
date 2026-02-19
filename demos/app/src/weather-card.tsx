import { memo, useEffect } from "react";

import { Squircle } from "./squircle.js";

/**
 * Public props for the demo weather card component.
 */
export interface WeatherCardProps {
  feelsLike: number;
  humidity: number;
  location: string;
  temperature: number;
  themeColor: string;
  windSpeed: number;
}

/**
 * Decorative sun icon used in the weather card.
 *
 * @returns SVG weather icon.
 */
function SunIcon() {
  return (
    <svg
      className="weather-card-sun-icon"
      fill="currentColor"
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Sun icon</title>
      <circle cx="12" cy="12" r="5" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/**
 * Renders the cpk-hb weather card UI used by Hashbrown component kits.
 *
 * @param props Weather content props.
 * @returns Weather card element.
 */
export const WeatherCard = memo(function WeatherCard({
  location,
  themeColor,
  temperature,
  humidity,
  windSpeed,
  feelsLike,
}: WeatherCardProps) {
  useEffect(() => {
    return (): void => undefined;
  }, []);

  return (
    <Squircle
      borderColor="rgba(255, 255, 255, 0.55)"
      borderWidth={2}
      className="weather-card-enter weather-card-root"
      squircle="30"
      style={{ backgroundColor: themeColor, overflow: "hidden" }}
    >
      <div className="weather-card-surface">
        <div className="weather-card-header">
          <div>
            <h3 className="weather-card-location">{location}</h3>
            <p className="weather-card-subtitle">Current Weather</p>
          </div>
          <SunIcon />
        </div>

        <div className="weather-card-main">
          <div className="weather-card-temperature">{temperature}°</div>
          <div className="weather-card-conditions">Clear skies</div>
        </div>

        <div className="weather-card-stats-shell">
          <div className="weather-card-stats-grid">
            <div>
              <p className="weather-card-stat-label">Humidity</p>
              <p className="weather-card-stat-value">{humidity}%</p>
            </div>
            <div>
              <p className="weather-card-stat-label">Wind</p>
              <p className="weather-card-stat-value">{windSpeed} mph</p>
            </div>
            <div>
              <p className="weather-card-stat-label">Feels Like</p>
              <p className="weather-card-stat-value">{feelsLike}°</p>
            </div>
          </div>
        </div>
      </div>
    </Squircle>
  );
});

/**
 * Loading fallback rendered while weather props stream in.
 *
 * @returns Skeleton weather card.
 */
export function WeatherCardFallback() {
  return (
    <Squircle
      borderColor="rgba(255, 255, 255, 0.55)"
      borderWidth={2}
      className="weather-card-root weather-card-fallback-shell"
      squircle="30"
    >
      <div className="weather-card-fallback">
        <div className="weather-card-header">
          <div className="weather-card-fallback-blocks">
            <div className="weather-card-fallback-block weather-card-fallback-title" />
            <div className="weather-card-fallback-block weather-card-fallback-subtitle" />
          </div>
          <div className="weather-card-fallback-block weather-card-fallback-icon" />
        </div>

        <div className="weather-card-main">
          <div className="weather-card-fallback-block weather-card-fallback-temp" />
          <div className="weather-card-fallback-block weather-card-fallback-detail" />
        </div>

        <div className="weather-card-stats-shell">
          <div className="weather-card-stats-grid">
            <div className="weather-card-fallback-blocks">
              <div className="weather-card-fallback-block weather-card-fallback-stat-label" />
              <div className="weather-card-fallback-block weather-card-fallback-stat-value" />
            </div>
            <div className="weather-card-fallback-blocks">
              <div className="weather-card-fallback-block weather-card-fallback-stat-label" />
              <div className="weather-card-fallback-block weather-card-fallback-stat-value" />
            </div>
            <div className="weather-card-fallback-blocks">
              <div className="weather-card-fallback-block weather-card-fallback-stat-label" />
              <div className="weather-card-fallback-block weather-card-fallback-stat-value" />
            </div>
          </div>
        </div>
      </div>
    </Squircle>
  );
}
