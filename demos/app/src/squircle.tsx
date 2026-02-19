import { getSvgPath } from "figma-squircle";
import {
  type CSSProperties,
  type HTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface CornerRadius {
  bottomLeft: number;
  bottomRight: number;
  topLeft: number;
  topRight: number;
}

/**
 * Squircle render properties for a clipped border container.
 */
export type SquircleProps = HTMLAttributes<HTMLDivElement> & {
  borderColor?: string;
  borderWidth?: number;
  measurementScale?: number;
  preserveSmoothing?: boolean;
  smoothing?: number;
  squircle: string;
};

/**
 * Parses CSS-like corner radius shorthand into explicit per-corner values.
 *
 * @param input Corner radius shorthand string.
 * @returns Expanded corner radius map.
 */
function parseCornerRadius(input: string): CornerRadius {
  const parts = input.trim().split(/\s+/).filter(Boolean).map(Number);

  if (parts.length === 1) {
    return {
      bottomLeft: parts[0] ?? 0,
      bottomRight: parts[0] ?? 0,
      topLeft: parts[0] ?? 0,
      topRight: parts[0] ?? 0,
    };
  }

  if (parts.length === 2) {
    return {
      bottomLeft: parts[1] ?? 0,
      bottomRight: parts[1] ?? 0,
      topLeft: parts[0] ?? 0,
      topRight: parts[0] ?? 0,
    };
  }

  if (parts.length === 4) {
    return {
      bottomLeft: parts[2] ?? 0,
      bottomRight: parts[3] ?? 0,
      topLeft: parts[0] ?? 0,
      topRight: parts[1] ?? 0,
    };
  }

  return {
    bottomLeft: 0,
    bottomRight: 0,
    topLeft: 0,
    topRight: 0,
  };
}

/**
 * Encodes SVG text into base64 for CSS data URL embedding.
 *
 * @param input SVG XML text.
 * @returns Base64 encoded text.
 */
function toBase64(input: string): string {
  return btoa(input);
}

/**
 * Renders a squircle-clipped container with optional border overlay.
 *
 * @param props Squircle rendering props.
 * @returns Clipped container.
 */
export function Squircle({
  squircle,
  smoothing = 1,
  preserveSmoothing = true,
  borderWidth = 0,
  borderColor,
  measurementScale = 1,
  className,
  style,
  children,
  ...rest
}: SquircleProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ height: 0, width: 0 });
  const [resolvedBorderColor, setResolvedBorderColor] = useState(borderColor ?? "transparent");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const readBox = (): void => {
      const rect = host.getBoundingClientRect();
      const scale = measurementScale > 0 ? measurementScale : 1;
      const cssBorderColor = getComputedStyle(host)
        .getPropertyValue("--app-squircle-border-color")
        .trim();

      setBox({
        height: rect.height / scale,
        width: rect.width / scale,
      });
      setResolvedBorderColor((borderColor ?? cssBorderColor) || "transparent");
    };

    readBox();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(readBox);
    resizeObserver.observe(host);

    return (): void => {
      resizeObserver.disconnect();
    };
  }, [borderColor, measurementScale]);

  const cornerRadius = useMemo(() => parseCornerRadius(squircle), [squircle]);
  const path = useMemo(() => {
    if (!box.width || !box.height) {
      return "";
    }

    return getSvgPath({
      bottomLeftCornerRadius: cornerRadius.bottomLeft,
      bottomRightCornerRadius: cornerRadius.bottomRight,
      cornerSmoothing: smoothing,
      height: box.height,
      preserveSmoothing,
      topLeftCornerRadius: cornerRadius.topLeft,
      topRightCornerRadius: cornerRadius.topRight,
      width: box.width,
    });
  }, [box.height, box.width, cornerRadius, preserveSmoothing, smoothing]);

  const clipPathValue = path ? `path('${path}')` : undefined;
  const borderImage = useMemo(() => {
    if (!path || borderWidth <= 0) {
      return undefined;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${box.width.toString()} ${box.height.toString()}"><path d="${path}" fill="none" style="stroke:${resolvedBorderColor};stroke-width:${borderWidth.toString()};" /></svg>`;
    return `url("data:image/svg+xml;base64,${toBase64(svg)}")`;
  }, [borderWidth, box.height, box.width, path, resolvedBorderColor]);

  const mergedStyle = {
    ...style,
    "--app-squircle-border-color": borderColor ?? resolvedBorderColor,
    "--app-squircle-border-width": `${borderWidth.toString()}px`,
    "--app-squircle-height": `${box.height.toString()}px`,
    "--app-squircle-width": `${box.width.toString()}px`,
    WebkitClipPath: clipPathValue,
    clipPath: clipPathValue,
  } as CSSProperties;

  return (
    <div
      className={["squircle", className].filter(Boolean).join(" ")}
      ref={hostRef}
      style={mergedStyle}
      {...rest}
    >
      {children}
      {borderImage ? (
        <div
          aria-hidden
          className="squircle-border-overlay"
          style={{ backgroundImage: borderImage }}
        />
      ) : null}
    </div>
  );
}
