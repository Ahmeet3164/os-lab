import { useEffect, useRef, useState } from "react";
import { GlobeIcon } from "@phosphor-icons/react";
import { AppShell, labHref } from "../../shell/app-shell";
import { TopBar } from "../../shell/top-bar";
import { Badge, Empty, PageHead, Section, Status } from "../../components/ui";
import { api, usePoll, type WebEvent, type WebOverview, type WebStatus } from "../../lib/api";

const VIEWPORTS = ["responsive", "mobile", "tablet", "desktop"] as const;
type Viewport = (typeof VIEWPORTS)[number];
const MAX_LOG_ENTRIES = 200;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The workbench drives the local engine: windows, injections, eval and the event log. */
export default function WebLabPage() {
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("https://example.com");
  const [profile, setProfile] = useState("default");
  const [viewport, setViewport] = useState<Viewport>("responsive");
  const [userAgent, setUserAgent] = useState("");
  const [injectionName, setInjectionName] = useState("");
  const [injectionCode, setInjectionCode] = useState("");
  const [evalTarget, setEvalTarget] = useState("");
  const [evalCode, setEvalCode] = useState("return document.title;");
  const [events, setEvents] = useState<WebEvent[]>([]);
  const cursor = useRef(0);

  const { data, error: loadError, reload } = usePoll<
    { status: WebStatus; overview: WebOverview | null } | null
  >(async () => {
    const status = await api.webStatus();
    const overview = status.state === "ready" ? await api.webOverview() : null;
    return { status, overview };
  }, 3000);

  const ready = data?.status.state === "ready";
  const overview = data?.overview ?? null;

  // Follow the engine's event log while it runs; the engine keeps the last 5000.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const tick = async () => {
      try {
        const page = await api.webEvents(cursor.current);
        if (!live) return;
        if (page.events.length) {
          cursor.current = page.events[page.events.length - 1].seq;
          setEvents((old) => [...old, ...page.events].slice(-MAX_LOG_ENTRIES));
        }
      } catch {
        // The readiness line and the next poll surface engine problems.
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      if (!document.hidden) void tick();
    }, 1500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [ready]);

  async function run(action: () => Promise<unknown>) {
    setActionError("");
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setBusy(false);
      reload();
    }
  }

  const windows = overview?.windows ?? [];
  const injections = overview?.injections ?? [];
  const profiles = overview?.profiles ?? [];

  return <AppShell activeId="web-lab">
    <TopBar title="Web Lab" icon={<GlobeIcon size={20} />} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <PageHead icon={<GlobeIcon size={22} />} title="Web Lab" description="Drive a real embedded browser window, inject JavaScript before page scripts and on demand, and read what pages expose." />
      {loadError && <Status value={{ ok: false, text: loadError }} />}
      {!data ? <p role="status">Loading Web Lab readiness…</p> : data.status.state !== "ready" ? <ReadinessGate state={data.status.state} busy={busy} onStart={() => void run(() => api.webEngineStart())} /> : <>
        <Section title="Engine" description="The engine runs on this computer and listens on 127.0.0.1 only.">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="success">Running</Badge>
            <span dir="ltr">{`v${overview?.version ?? "?"} · 127.0.0.1:${overview?.port ?? "?"}`}</span>
          </p>
          <button type="button" className="iux-btn mt-3" disabled={busy} onClick={() => void run(() => api.webEngineStop())}>Stop engine</button>
        </Section>
        {actionError && <Status value={{ ok: false, text: actionError }} />}
        <Section title="Open a window" description="The window opens on this computer and loads the address in the lab's embedded browser.">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Address</span>
              <input type="text" dir="ltr" className="iux-input mt-1 w-full" value={url} spellCheck={false}
                onChange={(event) => setUrl(event.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Profile</span>
              <select className="iux-input mt-1 w-full" value={profile} onChange={(event) => setProfile(event.target.value)}>
                {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Viewport</span>
              <select className="iux-input mt-1 w-full" value={viewport} onChange={(event) => setViewport(event.target.value as Viewport)}>
                {VIEWPORTS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <details className="text-sm sm:col-span-2">
              <summary className="cursor-pointer font-medium">Advanced</summary>
              <label className="mt-2 block">
                <span className="font-medium">User agent</span>
                <input type="text" dir="ltr" className="iux-input mt-1 w-full" value={userAgent} spellCheck={false}
                  aria-label="User agent override, empty for the browser default" onChange={(event) => setUserAgent(event.target.value)} />
              </label>
            </details>
          </div>
          <button type="button" className="iux-btn mt-4" data-variant="primary" disabled={busy || !url.trim()}
            onClick={() => void run(() => api.webOpenWindow({ url, profile, viewport, user_agent: userAgent || null }))}>Open window</button>
        </Section>
        <Section title="Windows" description="Every window shares the engine; closing it ends that session.">
          {windows.length ? <ul className="flex flex-col gap-2">
            {windows.map((item) => <WindowRow key={item.id} id={item.id} url={item.url} profile={item.profile} viewport={item.viewport} busy={busy}
              onClose={() => void run(() => api.webCloseWindow(item.id))}
              onReload={() => void run(() => api.webReload(item.id))}
              onNavigate={(target) => void run(() => api.webNavigate(item.id, target))}
              onCookies={() => void run(() => api.webCookies(item.id))}
              onStorage={() => void run(() => api.webStorage(item.id))} />)}
          </ul> : <Empty>No windows are open.</Empty>}
        </Section>
        <Section title="Injections" description="Registered scripts run before page scripts on every navigation in windows opened afterwards.">
          {injections.length ? <ul className="flex flex-col gap-2">
            {injections.map((item) => <li key={item.id} className="rounded-md border border-(--iux-border) p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium" translate="no">{item.name}</span>
                <Badge>{item.enabled ? "enabled" : "disabled"}</Badge>
                <button type="button" className="iux-btn ms-auto" data-variant="ghost" disabled={busy}
                  onClick={() => void run(() => api.webDeleteInjection(item.id))}>Delete</button>
              </div>
              <pre className="iux-scroll mt-2 max-h-32 overflow-auto rounded bg-(--iux-muted) p-2 text-xs" translate="no">{item.code}</pre>
            </li>)}
          </ul> : <Empty>No injections are registered.</Empty>}
          <div className="mt-4 grid gap-3">
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <input type="text" className="iux-input mt-1 w-full" value={injectionName} onChange={(event) => setInjectionName(event.target.value)} />
            </label>
            <div className="block text-sm">
              <span className="font-medium">Code</span>
              <textarea className="iux-input mt-1 w-full font-mono text-xs" rows={4} spellCheck={false} dir="ltr"
                aria-label="Code" value={injectionCode} onChange={(event) => setInjectionCode(event.target.value)} />
            </div>
            <button type="button" className="iux-btn" disabled={busy || !injectionName.trim() || !injectionCode.trim()}
              onClick={() => void run(async () => {
                await api.webAddInjection(injectionName.trim(), injectionCode);
                setInjectionName("");
                setInjectionCode("");
              })}>Register injection</button>
          </div>
        </Section>
        <Section title="Run JavaScript" description="The code runs in the selected window; its result arrives in the event log.">
          {windows.length ? <div className="grid gap-3">
            <div className="block text-sm">
              <span className="font-medium">Window</span>
              <select className="iux-input mt-1 w-full" aria-label="Window" value={evalTarget} onChange={(event) => setEvalTarget(event.target.value)}>
                <option value="">Choose a window</option>
                {windows.map((item) => <option key={item.id} value={String(item.id)}>#{item.id} — {item.url}</option>)}
              </select>
            </div>
            <div className="block text-sm">
              <span className="font-medium">JavaScript code</span>
              <textarea className="iux-input mt-1 w-full font-mono text-xs" rows={4} spellCheck={false} dir="ltr"
                aria-label="JavaScript code" value={evalCode} onChange={(event) => setEvalCode(event.target.value)} />
            </div>
            <button type="button" className="iux-btn" data-variant="primary" disabled={busy || !evalTarget || !evalCode.trim()}
              onClick={() => void run(() => api.webEval(Number(evalTarget), evalCode))}>Run</button>
          </div> : <Empty>Open a window to run JavaScript in it.</Empty>}
        </Section>
        <Section title="Event log" description="Captured page activity: console, errors, network, navigation and eval results. Events stay in engine memory.">
          {events.length ? <ol aria-live="polite" className="iux-scroll flex max-h-96 flex-col gap-1 overflow-auto rounded-md border border-(--iux-border) p-2 text-xs">
            {events.map((event) => <li key={event.seq} className="flex gap-2">
              <span dir="ltr" className="w-14 shrink-0 tabular-nums text-(--iux-muted-foreground)">{event.seq}</span>
              <Badge>{event.kind}</Badge>
              <span className="min-w-0 flex-1 break-all" translate="no">{eventText(event)}</span>
            </li>)}
          </ol> : <Empty>No events captured yet.</Empty>}
        </Section>
      </>}
    </main>
  </AppShell>;
}

/** Readiness gate: the backend decides what is possible; setup links to the lab page. */
function ReadinessGate({ state, busy, onStart }: { state: WebStatus["state"]; busy: boolean; onStart: () => void }) {
  if (state === "stopped") {
    return <Section title="Engine" description="The engine is built but not running on this computer.">
      <button type="button" className="iux-btn" data-variant="primary" disabled={busy} onClick={onStart}>Start engine</button>
    </Section>;
  }
  return <Section title="Readiness" description={state === "unavailable" ? "Web Lab is unavailable on this system." : "Setup is needed before use."}>
    <a className="iux-btn" href={labHref("web")}>Readiness & setup</a>
  </Section>;
}

/** One open window: identity, an inline address field and its per-window actions. */
function WindowRow({ id, url, profile, viewport, busy, onClose, onReload, onNavigate, onCookies, onStorage }: {
  id: number; url: string; profile: string; viewport: string; busy: boolean;
  onClose: () => void; onReload: () => void; onNavigate: (url: string) => void;
  onCookies: () => void; onStorage: () => void;
}) {
  const [target, setTarget] = useState(url);
  return <li className="rounded-md border border-(--iux-border) p-3 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium tabular-nums" dir="ltr">#{id}</span>
      <Badge>{profile}</Badge>
      <Badge>{viewport}</Badge>
      <span className="min-w-0 flex-1 break-all text-xs" dir="ltr" translate="no">{url}</span>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <form className="flex flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); if (target.trim()) onNavigate(target); }}>
        <input type="text" dir="ltr" className="iux-input min-w-0 flex-1" value={target} spellCheck={false}
          aria-label={`Address for window ${id}`} onChange={(event) => setTarget(event.target.value)} />
        <button type="submit" className="iux-btn" disabled={busy}>Go</button>
      </form>
      <button type="button" className="iux-btn" disabled={busy} onClick={onReload}>Reload</button>
      <button type="button" className="iux-btn" disabled={busy} onClick={onCookies}>Cookies</button>
      <button type="button" className="iux-btn" disabled={busy} onClick={onStorage}>Storage</button>
      <button type="button" className="iux-btn" data-variant="ghost" disabled={busy} onClick={onClose}>Close</button>
    </div>
  </li>;
}

/** One line per event; payloads are JSON, kept short by the engine's capture cap. */
function eventText(event: WebEvent): string {
  const payload = event.payload;
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
