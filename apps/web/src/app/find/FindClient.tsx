"use client";

import { useFindFlow } from "./useFindFlow";
import { FindScreen } from "./FindScreen";

export function FindClient() {
  const flow = useFindFlow();
  return <FindScreen {...flow} />;
}
