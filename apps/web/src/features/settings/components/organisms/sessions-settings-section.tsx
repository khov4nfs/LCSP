"use client";

import { resolveMessage } from "@lcsp/i18n";
import { CircleAlertIcon, MonitorIcon, ShieldCheckIcon } from "lucide-react";

import { SectionHeading } from "@/components/molecules/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { appLocale } from "@/lib/locale";
import type { SessionsSettingsSectionProps } from "../../types/settings-page.types";
import { formatDateTime } from "../../utils/settings-page.utils";

export function SessionsSettingsSection({
  sessions,
  activeSessionsCount,
  revokePending,
  onRevokeSession,
}: SessionsSettingsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.title",
        )}
        description={resolveMessage(
          appLocale,
          "pages.workspace.settingsHub.sessions.description",
        )}
        icon={<ShieldCheckIcon className="size-4" />}
      />
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.labels.trustedDevices",
              )}
            </CardTitle>
            <CardDescription>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.sessions.logoutAllUnsupported",
              )}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" disabled>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.actions.logOutAllDevices",
            )}
          </Button>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.sessions.activeTitle",
            )}
          </CardTitle>
          <CardDescription>
            {resolveMessage(
              appLocale,
              "pages.workspace.settingsHub.sessions.activeDescription",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleAlertIcon className="size-4" />
            <span>
              {resolveMessage(
                appLocale,
                "pages.workspace.settingsHub.sessions.summary",
              )}
              : {activeSessionsCount}
            </span>
          </div>
          {sessions.length === 0 ? (
            <Empty className="rounded-xl border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldCheckIcon className="size-4" />
                </EmptyMedia>
                <EmptyTitle>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.sessions.activeTitle",
                  )}
                </EmptyTitle>
                <EmptyDescription>
                  {resolveMessage(
                    appLocale,
                    "pages.workspace.settingsHub.states.noSessions",
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.device",
                    )}
                  </TableHead>
                  <TableHead>
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.location",
                    )}
                  </TableHead>
                  <TableHead>
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.createdAt",
                    )}
                  </TableHead>
                  <TableHead>
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.updatedAt",
                    )}
                  </TableHead>
                  <TableHead className="text-right">
                    {resolveMessage(
                      appLocale,
                      "pages.workspace.settingsHub.labels.actions",
                    )}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <div className="flex min-w-48 items-center gap-2">
                        <MonitorIcon className="size-4 text-muted-foreground" />
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">
                            {session.is_current
                              ? resolveMessage(
                                  appLocale,
                                  "pages.workspace.settingsHub.states.currentSession",
                                )
                              : session.id}
                          </span>
                          <Badge variant="outline" className="w-fit">
                            {resolveMessage(
                              appLocale,
                              session.revoked_at
                                ? "pages.workspace.settingsHub.badges.revoked"
                                : "pages.workspace.settingsHub.badges.active",
                            )}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {resolveMessage(
                        appLocale,
                        "pages.workspace.settingsHub.sessions.unknownLocation",
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(session.created_at)}</TableCell>
                    <TableCell>{formatDateTime(session.updated_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          session.is_current ||
                          session.revoked_at !== null ||
                          revokePending
                        }
                        onClick={() => void onRevokeSession(session.id)}
                      >
                        {resolveMessage(
                          appLocale,
                          "pages.workspace.settingsHub.actions.revoke",
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
