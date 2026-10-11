import { EventEmitter } from "node:events";
import type { TaskEvent } from "./types";

const globalForBus = globalThis as unknown as { __aegismind_bus?: EventEmitter };

function bus(): EventEmitter {
  if (!globalForBus.__aegismind_bus) {
    globalForBus.__aegismind_bus = new EventEmitter();
    globalForBus.__aegismind_bus.setMaxListeners(0);
  }
  return globalForBus.__aegismind_bus;
}

export function emitEvent(event: Omit<TaskEvent, "at"> & { at?: string }): void {
  bus().emit("event", { at: event.at ?? new Date().toISOString(), ...event });
}

export function onEvent(listener: (event: TaskEvent) => void): () => void {
  bus().on("event", listener);
  return () => bus().off("event", listener);
}

export function encodeSse(event: TaskEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
