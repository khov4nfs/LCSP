"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { ReadinessStatusPageProps } from "../../types/component-props.types";

export function ReadinessStatusPage({
  assessmentId,
}: ReadinessStatusPageProps) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/assessments/${encodeURIComponent(assessmentId)}`);
  }, [assessmentId, router]);

  return null;
}
