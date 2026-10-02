import { Eye, Search, SearchCheck, type LucideIcon } from "lucide-react";

/**
 * Icon per repository tool activity in the live agent stream. Activities not
 * listed here keep the generic tool icon.
 */
export const AGENT_STREAM_ACTIVITY_ICONS: Readonly<Record<string, LucideIcon>> = {
  // "Inspected / checked" activities.
  repositoryFilesInspected: SearchCheck,
  repositoryEvidenceInspected: SearchCheck,
  codeQualityValidated: SearchCheck,
  typeSafetyValidated: SearchCheck,
  // "Searched / located" activities.
  repositorySourceSearched: Search,
  relevantFilesLocated: Search,
  // "Read" activities.
  sourceFilesReviewed: Eye,
};
