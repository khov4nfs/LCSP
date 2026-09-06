import { resolveMessage } from "@lcsp/i18n";

import {
  ToolActivityList,
  ToolActivityRow,
} from "@/features/workspace/components/molecules/tool-activity-row";
import { TOOL_ACTIVITY_STATUSES } from "@/features/workspace/types/assessment-chat.types";
import { appLocale } from "@/lib/locale";

import type { ScannerActivityItem } from "../../types/assessment-flow.types";

type ScannerActivitySequenceProps = {
  activities: ScannerActivityItem[];
};

export function ScannerActivitySequence({
  activities,
}: ScannerActivitySequenceProps) {
  return (
    <ToolActivityList>
      {activities.map((activity) => (
        <ToolActivityRow
          key={activity.id}
          label={t(
            activity.status === TOOL_ACTIVITY_STATUSES.running
              ? (activity.runningLabelKey ?? activity.labelKey)
              : activity.labelKey,
          )}
          status={activity.status}
        />
      ))}
    </ToolActivityList>
  );
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
