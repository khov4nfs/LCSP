"use client";

import { useEffect } from "react";

/**
 * ScrollRevealObserver listens for elements with the `.scroll-reveal` class
 * and toggles `.is-visible` when they enter the viewport.
 */
export function ScrollRevealObserver() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Respect reduced motion settings
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll(".scroll-reveal").forEach((el) => {
        el.classList.add("is-visible");
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            // Unobserve after reveal for snappy, clean performance
            observer.unobserve(entry.target);
          }
        });
      },
      {
        rootMargin: "0px 0px -40px 0px",
        threshold: 0.12,
      }
    );

    const elements = document.querySelectorAll(".scroll-reveal");
    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
