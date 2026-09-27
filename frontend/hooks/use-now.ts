"use client";

import { useEffect, useState } from "react";

// setTimeout overflows (and fires immediately) past ~24.8 days.
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * The current time in epoch ms, kept fresh so time-based UI (countdowns,
 * "Expired" badges) updates without a page refresh.
 *
 * Re-renders every `intervalMs`, when the tab becomes visible again (background
 * tabs throttle timers), and exactly when the next of `deadlines` passes - so a
 * badge flips at the moment a link expires rather than up to an interval late.
 */
export function useNow(intervalMs: number, deadlines: number[] = []): number {
  const [now, setNow] = useState(() => Date.now());

  const nextDeadline = deadlines.reduce(
    (soonest, deadline) => (deadline > now && deadline < soonest ? deadline : soonest),
    Infinity
  );

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };

    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);

  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) return;

    const delay = Math.min(Math.max(nextDeadline - Date.now(), 0), MAX_TIMEOUT);
    const id = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(id);
    // `now` is a dependency so that a timer which fires a hair early (leaving
    // the same `nextDeadline`) still gets rescheduled.
  }, [nextDeadline, now]);

  return now;
}
