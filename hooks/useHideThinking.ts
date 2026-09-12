"use client";

import { useSyncExternalStore } from "react";
import { getHideThinking, subscribeHideThinking } from "@/lib/thinking-preference";

export function useHideThinking(): boolean {
  return useSyncExternalStore(subscribeHideThinking, getHideThinking, () => false);
}
