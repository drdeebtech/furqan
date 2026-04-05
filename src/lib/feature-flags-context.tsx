"use client";

import { createContext, useContext } from "react";

interface FeatureFlags {
  hideReviews: boolean;
  hidePrices: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlags>({
  hideReviews: false,
  hidePrices: false,
});

export function FeatureFlagsProvider({
  flags,
  children,
}: {
  flags: FeatureFlags;
  children: React.ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={flags}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}
