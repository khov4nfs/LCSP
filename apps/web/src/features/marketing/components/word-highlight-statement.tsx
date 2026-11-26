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

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wordsRef.current.forEach((w) => w?.classList.add("text-[#1A3C2B]"));
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
          wordEl.style.color = isHighlight ? "#1A3C2B" : "#1A3C2B";
          wordEl.style.fontWeight = isHighlight ? "800" : "600";
          wordEl.style.opacity = "1";
        } else {
          wordEl.style.color = "#3A3A38";
          wordEl.style.opacity = "0.35";
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
      className="relative w-full overflow-hidden border-b border-[#3A3A38]/20 bg-[#FAF9F6] py-24 text-[#3A3A38]"
    >
      <div 
        ref={containerRef}
        className="relative z-10 mx-auto max-w-[1440px] px-8 md:px-[96px]"
      >
        {lead && (
          <div className="inline-flex items-center gap-2 rounded-[2px] border border-[#1A3C2B]/30 bg-white px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-[#1A3C2B] font-bold">
            <span className="h-1.5 w-1.5 bg-[#1A3C2B]" />
            <span>{lead}</span>
          </div>
        )}

        <blockquote className="mt-6 max-w-[1080px] text-wrap-pretty font-sans text-2xl font-semibold leading-[1.3] tracking-tight sm:text-3xl md:text-4xl lg:text-5xl text-[#1A3C2B]">
          {words.map((word, i) => {
            const cleanWord = word.toLowerCase().replace(/[^a-z0-9à-ỹ]/g, "");
            const isHighlight = highlightWords.some((hw) => 
              cleanWord.includes(hw.toLowerCase()) || hw.toLowerCase().includes(cleanWord)
            );
            return (
              <span
                key={i}
                ref={(el) => {
                  if (el) wordsRef.current[i] = el;
                }}
                data-highlight={isHighlight ? "true" : "false"}
                className="inline-block transition-colors duration-150 mr-2.5"
                style={{ opacity: 0.35, color: "#3A3A38" }}
              >
                {word}
              </span>
            );
          })}
        </blockquote>

        {sourceNote && (
          <p className="mt-8 font-mono text-[11px] uppercase tracking-wider text-[#3A3A38]/70 border-t border-[#3A3A38]/15 pt-4">
            {sourceNote}
          </p>
        )}
      </div>
    </section>
  );
}
