"use client";

// /validators/corevaloper1... renders the same HomePage shell; HomePage
// detects this pathname and swaps the validators tab body for the detail
// view. Keeping the route file is what makes each validator a real,
// shareable, indexable URL rather than client-side state.

import HomePage from "../../page";

export default function ValidatorRoutePage() {
  return <HomePage />;
}
