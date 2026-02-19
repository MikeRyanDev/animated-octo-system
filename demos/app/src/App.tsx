import type { RealtimeTool } from "@frenchfry/core";
import { useAudioAgent } from "@frenchfry/react";
import { s } from "@hashbrownai/core";
import * as HashbrownReact from "@hashbrownai/react";
import type { ComponentType, ReactElement } from "react";

import { WeatherCard, WeatherCardFallback } from "./weather-card.js";
import { getWeather } from "./weather-tool.js";

interface HashbrownUiKit {
  render: (value: { ui: Array<Record<string, unknown>> }) => ReactElement[];
  schema: unknown;
  serializedSchema: string;
}

type ExposeComponentFunction = <Props extends object>(
  component: ComponentType<Props>,
  config: {
    description: string;
    fallback?: () => ReactElement;
    name: string;
    props?: Record<string, unknown>;
  },
) => unknown;

type UseUiKitFunction = (options: {
  components: readonly unknown[];
}) => HashbrownUiKit;
type UseToolFunction = (input: {
  deps: readonly unknown[];
  description: string;
  handler: (
    input: { location: string },
    abortSignal: AbortSignal,
  ) => Promise<unknown>;
  name: string;
  schema: unknown;
}) => RealtimeTool;
type UseJsonParserFunction = (
  json: string,
  schema: unknown,
) => {
  parserState: {
    error:
      | {
          message: string;
        }
      | undefined;
  };
  value: { ui: Array<Record<string, unknown>> } | undefined;
};

const { exposeComponent, useJsonParser, useTool, useUiKit } =
  HashbrownReact as unknown as {
    exposeComponent: ExposeComponentFunction;
    useJsonParser: UseJsonParserFunction;
    useTool: UseToolFunction;
    useUiKit: UseUiKitFunction;
  };

/**
 * Demo React entry component for live audio-agent usage.
 *
 * @returns Demo UI tree.
 */
export function App() {
  const getWeatherTool = useTool({
    deps: [],
    description:
      "Get the current weather for a location. Preferred format: City, State, Country. US shorthand City, ST is accepted.",
    handler: async (input, abortSignal) => {
      return await getWeather(input.location, abortSignal);
    },
    name: "get_weather",
    schema: s.object("Weather lookup input", {
      location: s.string("City, State, Country or City, ST"),
    }),
  });

  const kit = useUiKit({
    components: [
      exposeComponent(WeatherCard, {
        description: "Shows the weather for a given location.",
        fallback: () => <WeatherCardFallback />,
        name: "weather",
        props: {
          feelsLike: s.number("The feels like temperature in Fahrenheit"),
          humidity: s.number("The humidity in percentage"),
          location: s.streaming.string("The location to get the weather for"),
          temperature: s.number("The temperature in Fahrenheit"),
          themeColor: s.string("The theme to use for the weather card"),
          windSpeed: s.number("The wind speed in miles per hour"),
        },
      }),
    ],
  });

  const {
    activeToolCallCount,
    connect,
    isConnected,
    isToolRunning,
    lastErrorMessage,
    microphoneLevel,
    rawUiJson,
    render,
  } = useAudioAgent({
    realtime: {
      autoConnect: true,
      instructions: `
      
        You are a weather reporter. Use get_weather for requested locations, 
        then call render_ui with the weather component schema to show the 
        weather to the user.

        Summarize what they are saying as if you were a meteorologist. Be aware
        that they will see everything you render.

        Please note that calling "render_ui" _replaces_ what was previously on the
        screen. Call it once with everything you want the user to see, and be
        careful not to prematurely replace it.

        # render_ui streaming semantics
        As you emit the JSON to render_ui, I'm eagerly parsing it and showing it to
        the user. This means you should gather all of the weather, then call render_ui
        and speak over it, knowing that the weather is appearing dynamically for
        the user.

      `,
      sessionEndpoint:
        import.meta.env.VITE_SESSION_ENDPOINT ??
        "http://localhost:3001/session",
    },
    tools: [getWeatherTool],
    uiKit: [kit],
  });
  const { parserState, value: parsedUiValue } = useJsonParser(
    rawUiJson,
    kit.schema,
  );

  const waveformScale = Math.min(1, Math.max(0, microphoneLevel));
  const bars = [0.24, 0.46, 0.74, 1, 0.74, 0.46, 0.24];

  return (
    <main className="demo-root">
      {isToolRunning ? (
        <div className="tool-loading-indicator">
          Working... (^-^)
          {activeToolCallCount > 1 ? ` x${activeToolCallCount.toString()}` : ""}
        </div>
      ) : null}

      <section className="rendered-ui-grid rendered-ui-grid-full">
        {parsedUiValue ? kit.render(parsedUiValue) : render()}
      </section>

      <section className="floating-action-pane" aria-live="polite">
        {!isConnected ? (
          <button
            className="connect-button"
            onClick={() => void connect()}
            type="button"
          >
            Connect
          </button>
        ) : (
          <output className="mic-waveform" aria-label="Microphone input level">
            {bars.map((multiplier, index) => {
              const height = 10 + Math.round(32 * waveformScale * multiplier);
              return (
                <span
                  className="mic-waveform-bar"
                  key={`wave-${index.toString()}`}
                  style={{ height: `${height.toString()}px` }}
                />
              );
            })}
          </output>
        )}
      </section>

      {lastErrorMessage ? (
        <p className="floating-error">Error: {lastErrorMessage}</p>
      ) : null}
      {rawUiJson.trim() && parserState.error ? (
        <p className="floating-error">
          Parser error: {parserState.error.message}
        </p>
      ) : null}
    </main>
  );
}
