"use client";

import * as React from "react";
import { FindBox } from "./find/FindBox";
import { useFindFlow } from "./find/useFindFlow";

/** The same live find pipeline as /find, embedded on the product landing —
 * same state hook, same POST /api/find call, same crisis/clarify/results
 * rendering. Only the surrounding page chrome differs. */
export function LandingFindBox() {
  const flow = useFindFlow();
  return <FindBox {...flow} />;
}
