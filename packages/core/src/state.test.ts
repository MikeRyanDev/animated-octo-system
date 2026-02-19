import { firstValueFrom, of, toArray } from "rxjs";
import { expect, test } from "vitest";

import { createConnectionState$, parseConnectionEvent, reduceConnectionState } from "./state.js";

test("parseConnectionEvent validates known events", () => {
  // Arrange
  const input = { type: "connected" };

  // Act
  const event = parseConnectionEvent(input);

  // Assert
  expect(event.type).toBe("connected");
});

test("parseConnectionEvent rejects invalid events", () => {
  // Arrange
  const input = { type: "missing" };

  // Act
  const run = (): unknown => parseConnectionEvent(input);

  // Assert
  expect(run).toThrowError();
});

test("reduceConnectionState handles connected and disconnected events", () => {
  // Arrange
  const disconnectedState = {
    isConnected: false,
    lastErrorMessage: undefined,
    lastReason: undefined,
  };

  // Act
  const connectedState = reduceConnectionState(disconnectedState, { type: "connected" });
  const finalState = reduceConnectionState(connectedState, {
    reason: "peer closed",
    type: "disconnected",
  });

  // Assert
  expect(connectedState.isConnected).toBe(true);
  expect(finalState.isConnected).toBe(false);
  expect(finalState.lastReason).toBe("peer closed");
});

test("reduceConnectionState preserves prior reason when disconnect reason is omitted", () => {
  // Arrange
  const state = {
    isConnected: true,
    lastErrorMessage: undefined,
    lastReason: "network jitter",
  };

  // Act
  const nextState = reduceConnectionState(state, { type: "disconnected" });

  // Assert
  expect(nextState.lastReason).toBe("network jitter");
});

test("createConnectionState$ emits reduced snapshots", async () => {
  // Arrange
  const events$ = of(
    { type: "connected" } as const,
    { message: "transport failed", type: "error" } as const,
  );

  // Act
  const snapshots = await firstValueFrom(
    createConnectionState$(events$, {
      isConnected: false,
      lastErrorMessage: undefined,
      lastReason: undefined,
    }).pipe(toArray()),
  );

  // Assert
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]?.isConnected).toBe(true);
  expect(snapshots[1]?.isConnected).toBe(false);
  expect(snapshots[1]?.lastErrorMessage).toBe("transport failed");
});
