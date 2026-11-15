import { expect, test, type Page } from "@playwright/test";
import type { WebEvent, WebOverview, WebStatus } from "../src/lib/api";

const status: WebStatus = {
  state: "ready", port: 5077, binary: true,
  engine: { ok: true, engine: "weblab", version: "0.1.0", port: 5077, windows: 1, eventCount: 2 }
};
const overview: WebOverview = {
  ok: true, version: "0.1.0", port: 5077, startedAt: Date.now() / 1000,
  windows: [{ id: 1, url: "https://example.com/", profile: "default", user_agent: null, viewport: "mobile", created_at: 1 }],
  injections: [{ id: "inj-1", name: "canary", code: "window.__canary = true;", enabled: true }],
  profiles: [{ id: "default", name: "Default", ephemeral: false }, { id: "ephemeral", name: "Ephemeral (private)", ephemeral: true }],
  eventCount: 2, lastEventSeq: 2
};
const events = {
  events: [
    { seq: 1, ts: 1, window_id: 1, kind: "injected", payload: { href: "https://example.com/" } },
    { seq: 2, ts: 2, window_id: 1, kind: "eval-result", payload: { evalId: "ev-1", ok: true, value: "42" } }
  ] as WebEvent[],
  lastSeq: 2, count: 2
};

async function mockWeb(page: Page, state: WebStatus["state"] = "ready") {
  await page.route("**/api/web/status", (route) => route.fulfill({ json: { ...status, state } }));
  await page.route("**/api/web/overview", (route) => route.fulfill({ json: overview }));
  await page.route(/\/api\/web\/events/, (route) => route.fulfill({ json: events }));
  await page.route("**/api/web/windows", (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { ok: true, windowId: 2 } });
    return route.fulfill({ json: { windows: overview.windows } });
  });
}

test("the workbench drives a running engine: windows, injections and the event log", async ({ page }) => {
  await mockWeb(page);
  const opened: { url: string; viewport: string }[] = [];
  await page.route("**/api/web/windows", async (route) => {
    if (route.request().method() === "POST") {
      opened.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, windowId: 2 } });
    }
    return route.fulfill({ json: { windows: overview.windows } });
  });
  await page.goto("/web-lab/");
  await expect(page.getByRole("main").getByRole("heading", { name: "Web Lab" })).toBeVisible();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
  await expect(page.getByText("https://example.com/", { exact: true })).toBeVisible();
  await expect(page.getByText("canary", { exact: true })).toBeVisible();
  await expect(page.locator("ol li").filter({ hasText: "eval-result" })).toContainText("42");
  await page.getByLabel("Address", { exact: true }).fill("https://os-lab.dev");
  await page.getByLabel("Viewport").selectOption("mobile");
  await page.getByRole("button", { name: "Open window" }).click();
  expect(opened).toEqual([{ url: "https://os-lab.dev", profile: "default", viewport: "mobile", user_agent: null }]);
});

test("a stopped engine offers Start engine and the console answers", async ({ page }) => {
  await mockWeb(page, "stopped");
  const started: string[] = [];
  await page.route("**/api/web/engine/start", (route) => {
    started.push(route.request().method());
    return route.fulfill({ json: { state: "ready", pid: 123 } });
  });
  await page.goto("/web-lab/");
  await expect(page.getByText("The engine is built but not running on this computer.")).toBeVisible();
  await page.getByRole("button", { name: "Start engine" }).click();
  expect(started).toEqual(["POST"]);
});

test("Run JavaScript posts the code to the selected window", async ({ page }) => {
  await mockWeb(page);
  const evals: { code: string }[] = [];
  await page.route("**/api/web/windows/1/eval", (route) => {
    evals.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, applied: true } });
  });
  await page.goto("/web-lab/");
  await page.getByLabel("Window", { exact: true }).selectOption("1");
  await page.getByLabel("JavaScript code", { exact: true }).fill("return 6 * 7;");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  expect(evals).toEqual([{ code: "return 6 * 7;" }]);
});

test("injections register with a name and code", async ({ page }) => {
  await mockWeb(page);
  const registered: { name: string; code: string }[] = [];
  await page.route("**/api/web/injections", async (route) => {
    if (route.request().method() === "POST") {
      registered.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, injection: { id: "inj-2", name: "probe", code: "1;", enabled: true } } });
    }
    return route.fulfill({ json: { injections: overview.injections } });
  });
  await page.goto("/web-lab/");
  await page.getByLabel("Name", { exact: true }).fill("probe");
  await page.getByLabel("Code", { exact: true }).fill("window.__probe = true;");
  await page.getByRole("button", { name: "Register injection" }).click();
  expect(registered).toEqual([{ name: "probe", code: "window.__probe = true;" }]);
});
