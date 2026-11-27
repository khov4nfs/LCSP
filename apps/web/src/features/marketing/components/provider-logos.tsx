import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ProviderLogoProps extends HTMLAttributes<SVGSVGElement> {
  className?: string;
  size?: number;
}

export function GitHubLogo({ className, size = 24, ...props }: ProviderLogoProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-label="GitHub"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function GitLabLogo({ className, size = 24, ...props }: ProviderLogoProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-label="GitLab"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="m23.6 9.593-2.03-6.248a.972.972 0 0 0-1.85 0L17.69 9.593H6.31L4.28 3.345a.972.972 0 0 0-1.85 0L.4 9.593a1.458 1.458 0 0 0 .529 1.629L12 19.35l11.07-8.128a1.458 1.458 0 0 0 .53-1.629" />
    </svg>
  );
}

export function BitbucketLogo({ className, size = 24, ...props }: ProviderLogoProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-label="Bitbucket"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M.778 1.213a.768.768 0 0 0-.768.892l3.263 19.81c.084.5.517.868 1.022.868H19.95a.772.772 0 0 0 .766-.645l3.265-20.032a.77.77 0 0 0-.766-.893H.778zM14.49 14.24H9.55l-1.12-6.195h7.24l-1.18 6.195z" />
    </svg>
  );
}

export function AzureDevOpsLogo({ className, size = 24, ...props }: ProviderLogoProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-label="Azure DevOps"
      className={cn("shrink-0", className)}
      {...props}
    >
      <path d="M0 8.877L2.247 5.75l7.397-2.738L16.27 0l7.73 6.123v11.877l-4.707 6-8.917-2.615-5.996 2.615L0 19.346V8.877zm20.89 6.223V7.915l-4.62-3.661v8.838l4.62 2.008zM4.38 7.915v8.185l5.26 2.292V6.638L4.38 7.915z" />
    </svg>
  );
}
