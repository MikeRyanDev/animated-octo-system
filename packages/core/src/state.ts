import { type Observable, scan } from "rxjs";
import { z } from "zod";

const connectedEventSchema = z.object({
  type: z.literal("connected"),
});

const disconnectedEventSchema = z.object({
  reason: z.string().optional(),
  type: z.literal("disconnected"),
});

const errorEventSchema = z.object({
  message: z.string().min(1),
  type: z.literal("error"),
});

/**
 * Runtime schema for normalized connection lifecycle events.
 */
export const connectionEventSchema = z.discriminatedUnion("type", [
  connectedEventSchema,
  disconnectedEventSchema,
  errorEventSchema,
]);

/**
 * Connection event emitted by the core connection pipeline.
 */
export type ConnectionEvent = z.infer<typeof connectionEventSchema>;

/**
 * Snapshot of connection status for consumers.
 */
export interface ConnectionState {
  isConnected: boolean;
  lastErrorMessage: string | undefined;
  lastReason: string | undefined;
}

/**
 * Parses unknown input into a validated connection event.
 *
 * @param input Unknown external value.
 * @returns Validated connection event.
 */
export function parseConnectionEvent(input: unknown): ConnectionEvent {
  return connectionEventSchema.parse(input);
}

/**
 * Reduces the previous connection state with a new lifecycle event.
 *
 * @param state Previous immutable connection state.
 * @param event New connection event.
 * @returns Next immutable connection state.
 */
export function reduceConnectionState(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  switch (event.type) {
    case "connected": {
      return {
        isConnected: true,
        lastErrorMessage: state.lastErrorMessage,
        lastReason: state.lastReason,
      };
    }
    case "disconnected": {
      return {
        isConnected: false,
        lastErrorMessage: state.lastErrorMessage,
        lastReason: event.reason ?? state.lastReason,
      };
    }
    case "error": {
      return {
        isConnected: false,
        lastErrorMessage: event.message,
        lastReason: state.lastReason,
      };
    }
    /* c8 ignore next 4 */
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * Builds a reactive state stream from connection events.
 *
 * @param events$ Stream of normalized connection events.
 * @param initialState Initial state snapshot.
 * @returns Stream of reduced immutable connection states.
 */
export function createConnectionState$(
  events$: Observable<ConnectionEvent>,
  initialState: ConnectionState,
): Observable<ConnectionState> {
  return events$.pipe(scan((state, event) => reduceConnectionState(state, event), initialState));
}
