"use client";

import { createContext, useContext } from "react";

// Display-ready, published testimonial. Fetched server-side (published-only)
// and provided to the public component tree, mirroring FeatureFlagsProvider —
// one fetch in the (public) layout covers every page that renders <Testimonials/>.
export interface PublicTestimonial {
  id: string;
  authorName: string;
  authorLocation: string | null;
  quoteAr: string;
  quoteEn: string | null;
}

const TestimonialsContext = createContext<PublicTestimonial[]>([]);

export function TestimonialsProvider({
  items,
  children,
}: {
  items: PublicTestimonial[];
  children: React.ReactNode;
}) {
  return (
    <TestimonialsContext.Provider value={items}>
      {children}
    </TestimonialsContext.Provider>
  );
}

export function useTestimonials() {
  return useContext(TestimonialsContext);
}
