"use client";

import { createContext, useContext } from "react";

interface FeatureFlags {
  hideReviews: boolean;
  hidePrices: boolean;
  hideTeachersPage: boolean;
  hideCourses: boolean;
}

const FeatureFlagsContext = createContext<FeatureFlags>({
  hideReviews: false,
  hidePrices: false,
  hideTeachersPage: false,
  hideCourses: false,
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
