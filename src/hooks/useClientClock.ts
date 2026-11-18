"use client";

import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * False on the server and for the hydrating render, true on every render
 * after that, including the first render of a client-side navigation.
 *
 * Every route here is prerendered at build time, so a clock read during
 * render hydrates against a value that is as old as the last deploy. Text
 * that differs (a date, a day count, a rounded percentage) makes React
 * discard the server HTML and rebuild the whole tree on the client. Anything
 * derived from the clock waits for this and renders a placeholder until then.
 */
export function useClientClock(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
