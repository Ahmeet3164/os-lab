/**
 * Native Windows application monitor: visible desktop apps in the current user session,
 * with stable process identities and live resource readings. It is deliberately read-only
 * and separate from the Windows VM lifecycle; no process control is offered in this panel.
 */
import { useMemo, useState } from "react";
import { ArrowClockwiseIcon, TerminalWindowIcon } from "@phosphor-icons/react";
import { Badge, Empty, Section, Skeleton, Status } from "../components/ui";
import { ago, api, formatBytes, usePoll, type WindowsApp, type WindowsAppsInfo } from "../lib/api";

const POLL_MS = 5000;
const NUMBER = new Intl.NumberFormat();

function cpu(seconds: number | null): string {
  return seconds == null ? "—" : `${NUMBER.format(Math.round(seconds * 10) / 10)} s`;
}

function startedAt(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(milliseconds));
}

function ApplicationList({
  apps,
  selected,
  onSelect
}: {
  apps: WindowsApp[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul aria-label="Applications on this PC" className="max-h-96 divide-y divide-(--iux-border) overflow-y-auto">
      {apps.map((app) => (
        <li key={app.id}>
          <button
            type="button"
            className="flex w-full min-w-0 flex-col gap-2 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-(--iux-muted) aria-selected:bg-(--iux-muted)"
            aria-pressed={selected === app.id}
            onClick={() => onSelect(app.id)}
          >
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{app.name}</span>
              <span className="font-mono text-xs text-(--iux-muted-foreground)">#{app.pid}</span>
              <Badge tone={app.responding ? "success" : "warning"}>{app.responding ? "Running" : "Not responding"}</Badge>
            </span>
            <span className="truncate text-xs text-(--iux-muted-foreground)">{app.title || "—"}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-(--iux-muted-foreground)">
              <span>Memory {formatBytes(app.memoryBytes)}</span>
              <span>CPU time {cpu(app.cpuSeconds)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProcessMetrics({ app }: { app: WindowsApp }) {
  const metrics = [
    { label: "Process", value: app.name },
    { label: "PID", value: `#${app.pid}` },
    { label: "Window title", value: app.title || "—" },
    { label: "Status", value: app.responding ? "Running" : "Not responding" },
    { label: "Memory", value: formatBytes(app.memoryBytes) },
    { label: "CPU time", value: cpu(app.cpuSeconds) },
    { label: "Started", value: startedAt(app.startedAt) }
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0">
          <dt className="text-xs font-medium text-(--iux-muted-foreground)">{metric.label}</dt>
          <dd className={`mt-0.5 truncate text-sm ${metric.label === "Process" ? "font-mono" : ""}`}>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function WindowsAppsPanel() {
  const { data, error, reload } = usePoll<WindowsAppsInfo>(() => api.windowsApps(), POLL_MS);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedApp = useMemo(
    () => (selected ? data?.apps.find((app) => app.id === selected) ?? null : null),
    [data, selected]
  );

  return (
    <Section
      icon={<TerminalWindowIcon size={16} />}
      title="Applications on this PC"
      description="Native, read-only monitoring of visible desktop applications in your Windows session. This is separate from the Windows VM."
      action={
        <button type="button" className="iux-btn" data-variant="outline" onClick={reload}>
          <ArrowClockwiseIcon size={14} /> Refresh
        </button>
      }
    >
      {error ? (
        <Status value={{ ok: false, text: error }} />
      ) : !data ? (
        <Skeleton rows={3} />
      ) : !data.available ? (
        <Empty>{data.reason ?? "Windows application monitoring is unavailable."}</Empty>
      ) : (
        <>
          {data.apps.length === 0 ? (
            <Empty>No visible desktop applications were found.</Empty>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="min-w-0">
                <ApplicationList apps={data.apps} selected={selected} onSelect={setSelected} />
                {data.partial ? (
                  <p className="mt-2 text-xs text-(--iux-muted-foreground)">
                    Some running processes could not be read; the list is partial.
                  </p>
                ) : null}
              </div>
              {selectedApp ? (
                <div className="min-w-0">
                  <p className="mb-3 text-xs font-medium text-(--iux-muted-foreground)">
                    Updated {ago(data.checkedAt)}
                  </p>
                  <ProcessMetrics app={selectedApp} />
                </div>
              ) : (
                <Empty>Select an application to see its details.</Empty>
              )}
            </div>
          )}
          {data.apps.length > 0 && selected && !selectedApp ? (
            <div className="mt-4">
              <Empty>The selected application is no longer running.</Empty>
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}
