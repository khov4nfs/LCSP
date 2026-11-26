"use client";

import { useEffect, useRef } from "react";

interface WordHighlightStatementProps {
  lead?: string;
  statement: string;
  highlightWords?: string[];
  sourceNote?: string;
}

export function WordHighlightStatement({
  lead,
  statement,
  highlightWords = ["cryptographic", "verifiable", "audit-ready", "deterministic", "bằng chứng", "toán học", "xác thực"],
  sourceNote,
}: WordHighlightStatementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Check prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wordsRef.current.forEach((w) => w?.classList.add("text-white"));
      return;
    }

    const handleScroll = () => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const start = vh * 0.85;
      const end = vh * 0.35;
      const progress = Math.max(0, Math.min(1, (start - rect.top) / (start - end)));
      const count = Math.round(progress * wordsRef.current.length);

      wordsRef.current.forEach((wordEl, idx) => {
        if (!wordEl) return;
        const isHighlight = wordEl.dataset.highlight === "true";
        if (idx < count) {
          wordEl.style.color = isHighlight ? "#31BDA7" : "#F7FBFC";
          wordEl.style.opacity = "1";
        } else {
          wordEl.style.color = "#94A3B8";
          wordEl.style.opacity = "0.45";
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const words = statement.split(/\s+/);

  return (
    <section 
      data-section="taste-word-highlight"
      className="relative w-full overflow-hidden bg-[#071622] py-24 text-white"
    >
      <div 
        aria-hidden="true" 
        className="pointer-events-none absolute inset-0 bg-radial-hero-glow opacity-40" 
      />

      <div 
        ref={containerRef}
        className="relative z-10 mx-auto max-w-[1440px] px-8 md:px-[96px]"
      >
        {lead && (
          <p className="text-xs font-semibold uppercase tracking-widest text-[#86E8D4]">
            {lead}
          </p>
        )}

        <blockquote className="mt-6 max-w-[1080px] text-wrap-pretty font-heading text-2xl font-medium leading-[1.3] tracking-tight sm:text-3xl md:text-4xl lg:text-5xl">
          {words.map((word, index) => {
            const cleanWord = word.toLowerCase().replace(/[^a-z0-9à-ỹ]/gi, "");
            const isHighlight = highlightWords.some((hw) => cleanWord.includes(hw.toLowerCase()));
            return (
              <span
                key={`${word}-${index}`}
                ref={(el) => {
                  if (el) wordsRef.current[index] = el;
                }}
                data-highlight={isHighlight ? "true" : "false"}
                className="inline-block transition-colors duration-150 ease-out mr-[0.28em]"
                style={{ color: "#94A3B8", opacity: 0.45 }}
              >
                {word}
              </span>
            );
          })}
        </blockquote>

        {sourceNote && (
          <div className="mt-8 flex items-center gap-3">
            <span className="size-2 rounded-full bg-[#31BDA7] animate-pulse" />
            <p className="font-mono text-xs text-slate-400">
              {sourceNote}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
