/**
 * iOS Lab simulator panel: pick an installed device, attach (boot) it and watch its screen here.
 * Attach and detach stay previewed lab actions (start with a device option, stop), so nothing
 * runs without confirmation; the screen is the booted device's screenshot via the console.
 * The card lives in a right-side panel that the lab header's Simulator icon toggles, so the
 * page stays focused on readiness and actions until the mirror is wanted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CameraIcon,
  CircleNotchIcon,
  DeviceMobileIcon,
  FrameCornersIcon,
  PowerIcon,
  XIcon
} from "@phosphor-icons/react";
import { Badge, Empty, Field, IconButton, Skeleton, Status } from "../components/ui";
import { api, message, usePoll, type CleanupVolumes, type IosDevicesInfo } from "../lib/api";
import { localeFromPath, localePath } from "../i18n/paths";
import type { LabRequest } from "../lib/api";

/** Screens refresh a little slower than jobs; each frame is one simctl screenshot on this Mac. */
const SCREEN_INTERVAL = 5000;
/** Real devices change rarely; devicectl costs a subprocess, so this polls gently. */
const DEVICES_INTERVAL = 30000;
/** Below this much free space on the home volume, the drawer points at the relocation tab. */
const DISK_TIGHT_BYTES = 20 * 1024 ** 3;

const locale = () => (typeof window === "undefined" ? "en" : localeFromPath(window.location.pathname));

export function SimulatorDrawer({ open, onClose, onPreview }: { open: boolean; onClose: () => void; onPreview: (action: string, extra?: Partial<LabRequest>) => void }) {
  if (!open) return null;
  return (
    <aside role="dialog" aria-label="Simulator" className="iux-sidepanel fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-(--iux-border) bg-(--iux-background) shadow-2xl">
      <header className="flex items-center gap-2 border-b border-(--iux-border) px-5 py-3">
        <span className="shrink-0 text-[#f36c21]">
          <DeviceMobileIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Simulator</h2>
          <p className="text-xs text-(--iux-muted-foreground)">Pick a device, attach it and watch its screen here.</p>
        </div>
        <IconButton label="Close" onClick={onClose} className="ml-auto">
          <XIcon size={14} weight="bold" />
        </IconButton>
      </header>
      <div className="flex-1 overflow-y-auto p-5">
        <SimulatorBody onPreview={onPreview} />
      </div>
    </aside>
  );
}

function SimulatorBody({ onPreview }: { onPreview: (action: string, extra?: Partial<LabRequest>) => void }) {
  const { data, error } = usePoll(() => api.iosSimulator(), SCREEN_INTERVAL);
  const { data: hostReport } = usePoll(() => api.host(), 0);
  const { data: realDevices, error: devicesError } = usePoll<IosDevicesInfo>(() => api.iosDevices(), DEVICES_INTERVAL);
  const { data: volumeReport } = usePoll<CleanupVolumes>(() => api.cleanupVolumes(), 0);
  const home = volumeReport?.volumes?.find((v) => v.isHome) ?? null;
  const diskTight = !!home && (home.pressure === "warning" || (home.freeBytes != null && home.freeBytes < DISK_TIGHT_BYTES));
  const xcodePath = hostReport?.host.xcode?.xcodeApp || hostReport?.host.xcode?.developerDir || null;
  const [udid, setUdid] = useState("");
  const [framed, setFramed] = useState(true);
  // An older console (or the e2e mock) may answer {}; every field is optional in practice.
  const devices = data?.devices ?? [];
  const booted = data?.booted?.[0] ?? null;

  // The picker starts on the booted device, else the configured one, else the first iPhone.
  const defaultUdid = useMemo(
    () =>
      booted?.udid ??
      (data?.configuredDevice ? devices.find((d) => d.name === data.configuredDevice)?.udid : undefined) ??
      devices.find((d) => d.name.startsWith("iPhone"))?.udid ??
      devices[0]?.udid ??
      "",
    [booted?.udid, data?.configuredDevice, devices]
  );
  useEffect(() => {
    if (defaultUdid && !devices.some((d) => d.udid === udid)) setUdid(defaultUdid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultUdid]);

  const selected = devices.some((d) => d.udid === udid) ? udid : defaultUdid;
  const attach = () => onPreview("start", selected ? { device: selected } : {});
  const detach = () => onPreview("stop");

  const [shot, setShot] = useState<string | null>(null);
  const [shotError, setShotError] = useState<string | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const shotRef = useRef<string | null>(null);
  const grab = useCallback(async () => {
    setShotBusy(true);
    try {
      const res = await fetch(api.iosScreenshotUrl, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `${res.status} ${res.statusText}`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (shotRef.current) URL.revokeObjectURL(shotRef.current);
      shotRef.current = url;
      setShot(url);
      setShotError(null);
    } catch (e) {
      setShotError(message(e));
    } finally {
      setShotBusy(false);
    }
  }, []);
  useEffect(() => () => {
    if (shotRef.current) URL.revokeObjectURL(shotRef.current);
  }, []);
  useEffect(() => {
    if (!booted) {
      setShot(null);
      setShotError(null);
      return;
    }
    void grab();
    const timer = setInterval(() => {
      if (!document.hidden) void grab();
    }, SCREEN_INTERVAL);
    return () => clearInterval(timer);
  }, [booted?.udid, grab]);

  return (
    <>
      {error ? (
        <Status value={{ ok: false, text: error }} />
      ) : !data ? (
        <Skeleton rows={2} />
      ) : !data.available ? (
        <Empty>{data.reason ?? "The simulator tooling is not usable on this Mac."}</Empty>
      ) : (
        <>
          {diskTight && home && (
            <div className="mb-5 w-full max-w-sm rounded-md border border-(--iux-warning) p-3 text-sm">
              <p>System disk is running low. Simulator device data can move to another volume from the Cleanup Lab.</p>
              <p className="mt-1 text-xs text-(--iux-muted-foreground)" dir="ltr">{home.mountPoint} · {home.freeBytes == null ? "?" : Math.round(home.freeBytes / 1024 ** 3)} GiB free</p>
              <a className="iux-btn mt-2" data-variant="outline" href={localePath("/cleanup/relocation/", locale())}>Open Relocation</a>
            </div>
          )}
          {xcodePath && (
            <p className="mb-4 w-full max-w-sm break-all text-xs text-(--iux-muted-foreground)">
              <span className="font-medium">Xcode</span> · <span translate="no">{xcodePath}</span>
            </p>
          )}
          <div className="flex flex-col items-center gap-5">
          <div className="flex w-full max-w-sm flex-wrap items-center justify-between gap-3">
            <div className="min-w-56 flex-1">
              <Field label="Device" hint={data.runtimes[0]}>
                <select className="iux-input" value={selected} onChange={(e) => setUdid(e.target.value)} aria-label="Device">
                  {devices.map((d) => (
                    <option key={d.udid} value={d.udid}>
                      {d.name} · {d.runtime}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {booted ? (
              <Badge tone="success">
                Booted{` · ${booted.name}`}
              </Badge>
            ) : null}
          </div>

          <div className={`relative ${framed ? "rounded-[3rem] border border-zinc-700 bg-zinc-950 p-2 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.55)]" : ""}`}>
            {framed ? (
              <>
                <span aria-hidden="true" className="absolute top-24 -left-[3px] h-9 w-[3px] rounded-l-sm bg-zinc-600" />
                <span aria-hidden="true" className="absolute top-36 -left-[3px] h-12 w-[3px] rounded-l-sm bg-zinc-600" />
                <span aria-hidden="true" className="absolute top-28 -right-[3px] h-16 w-[3px] rounded-r-sm bg-zinc-600" />
              </>
            ) : null}
            <div
              className={`relative w-72 max-w-full overflow-hidden bg-black ${framed ? "rounded-[2.6rem]" : "rounded-xl border border-(--iux-border)"}`}
              style={{ aspectRatio: "393 / 852" }}
            >
              {booted ? (
                shot ? (
                  <img src={shot} alt="Simulator screen" className="h-full w-full object-cover" />
                ) : shotError ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-xs text-zinc-400">{shotError}</p>
                    <button type="button" className="iux-btn" data-variant="outline" onClick={() => void grab()}>
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center" aria-busy="true">
                    <CircleNotchIcon size={24} className="animate-spin text-zinc-500" aria-hidden />
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                  <DeviceMobileIcon size={30} className="text-zinc-500" aria-hidden />
                  <p className="text-base font-semibold text-zinc-100">Attach a simulator to see its screen here</p>
                  <p className="text-xs text-zinc-400">Shut-down devices boot when you attach.</p>
                  <button
                    type="button"
                    className="mt-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:opacity-60"
                    disabled={!devices.length}
                    onClick={attach}
                  >
                    Attach simulator
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="iux-btn" data-variant="outline" aria-pressed={framed} onClick={() => setFramed((f) => !f)}>
              <FrameCornersIcon size={14} /> Frame
            </button>
            <button type="button" className="iux-btn" data-variant="outline" disabled={!booted || shotBusy} onClick={() => void grab()}>
              <ArrowClockwiseIcon size={14} /> Refresh
            </button>
            {shot ? (
              <a className="iux-btn" data-variant="outline" href={shot} download="ios-lab-screenshot.png">
                <CameraIcon size={14} /> Screenshot
              </a>
            ) : null}
            {booted ? (
              <button type="button" className="iux-btn" data-variant="outline" onClick={detach}>
                <PowerIcon size={14} /> Detach simulator
              </button>
            ) : null}
          </div>
        </div>
        </>
      )}
      <section className="mt-6 w-full max-w-sm border-t border-(--iux-border) pt-4">
        <h3 className="text-sm font-semibold">Real devices</h3>
        <p className="text-xs text-(--iux-muted-foreground)">Paired and connected iPhones and iPads, read-only.</p>
        {devicesError ? (
          <Status value={{ ok: false, text: devicesError }} />
        ) : !realDevices ? (
          <Skeleton rows={1} />
        ) : !realDevices.available ? (
          <p className="mt-2 text-sm text-(--iux-muted-foreground)">{realDevices.reason}</p>
        ) : realDevices.devices.length === 0 ? (
          <Empty>No real devices are paired with this Mac.</Empty>
        ) : (
          <ul className="mt-2 divide-y divide-(--iux-border)">
            {realDevices.devices.map((d) => (
              <li key={d.udid} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                  {d.state ? (
                    <Badge tone={d.state === "connected" ? "success" : undefined}>{d.state}</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-(--iux-muted-foreground)" dir="ltr">
                  {d.osVersion ? `${d.osVersion} · ` : ""}
                  <span translate="no">{d.udid}</span>
                </p>
                {d.paired && (
                  <p className="text-xs text-(--iux-muted-foreground)">
                    Paired{d.transport === "localNetwork" ? " · Wi-Fi" : d.transport ? " · USB" : ""}
                    {d.lastSeen ? ` · last seen ${new Date(d.lastSeen).toLocaleString(locale())}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-(--iux-muted-foreground)">
          Controlling a real device needs Developer Mode and a signed WebDriverAgent — see the iOS lab README.
        </p>
      </section>
    </>
  );
}
