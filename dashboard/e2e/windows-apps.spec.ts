import { expect, test, type Page } from "@playwright/test";
import type { LabStatus } from "../src/lib/api";

const windowsApps = {
  available: true,
  reason: null,
  provider: "native-windows",
  sessionId: 1,
  checkedAt: Date.now() / 1000,
  partial: false,
  skipped: 0,
  apps: [
    {
      id: "100:1700000000000",
      pid: 100,
      name: "Notepad",
      title: "Fixture - Notepad",
      startedAt: 1700000000000,
      memoryBytes: 16 * 1024 ** 2,
      cpuSeconds: 2.5,
      responding: true
    }
  ]
};

const labs: LabStatus[] = [
  { id: "windows", label: "Windows Lab", summary: "Windows VM", state: "ready", provider: "wsl2", reasons: [],
    requirements: [], notes: [], actions: [{ id: "status", label: "Status", description: "Snapshot state", privileged: false }], installed: true },
  { id: "source", label: "Source Lab", summary: "Local source analysis", state: "ready", provider: "native-python", reasons: [], requirements: [], notes: [], actions: [], installed: true },
  { id: "macos", label: "macOS Lab", summary: "Native Xcode Simulator", state: "unavailable", provider: null, reasons: [], requirements: [], notes: [], actions: [], installed: true },
  { id: "ios", label: "iOS Lab", summary: "iOS Simulator", state: "unavailable", provider: null, reasons: [], requirements: [], notes: [], actions: [], installed: true },
  { id: "android", label: "Android Lab", summary: "Android analysis", state: "needs-setup", provider: "wsl2", reasons: [], requirements: [], notes: [], actions: [], installed: true },
  { id: "linux", label: "Linux Lab", summary: "Linux VM", state: "unavailable", provider: null, reasons: [], requirements: [], notes: [], actions: [], installed: true }
];

async function mockApi(page: Page, os: "windows" | "linux" = "windows", labPatch: Partial<LabStatus> = {}) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/host") body = {
      host: {
        os, osPretty: os === "windows" ? "Windows" : "Linux", arch: "x86_64", hostname: "test-host",
        cpus: 8, memory: 16 * 1024 ** 3, disk: { free: 100 * 1024 ** 3, total: 500 * 1024 ** 3 },
        kvm: { present: os === "linux", usable: os === "linux" },
        wsl: { guest: false, distributions: os === "windows" ? ["Ubuntu"] : [] },
        runtime: null, xcode: null, python: "3.12", root: "/tmp/os-lab", tools: [], providers: []
      },
      labs: labs.map((lab) => lab.id === "windows" ? { ...lab, ...labPatch } : lab)
    };
    else if (path === "/api/health") body = { status: "ok", version: "test", console: true };
    else if (path === "/api/jobs") body = { jobs: [] };
    else if (path === "/api/labs/windows/config") body = { lab: "windows", path: ".env", exists: true, fields: [], profiles: [], backups: [], endpoints: [] };
    else if (path === "/api/labs/windows/monitor") body = { lab: "windows", state: "stopped", containers: [] };
    await route.fulfill({ json: body });
  });
}

test("native Windows apps stay monitorable while the VM needs setup", async ({ page }) => {
  await mockApi(page, "windows", { state: "needs-setup" });
  await page.route("**/api/labs/windows/apps", (route) => route.fulfill({ json: windowsApps }));

  await page.goto("/labs/windows/");
  await expect(page.getByRole("heading", { name: "Applications on this PC" })).toBeVisible();
  await expect(page.getByText("Notepad", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Notepad/ }).click();
  const metrics = page.locator("dl");
  await expect(metrics).toContainText("Notepad");
  await expect(metrics).toContainText("#100");
  await expect(metrics).toContainText("Fixture - Notepad");
  await expect(metrics).toContainText("Running");
  await expect(metrics).toContainText("16 MB");
  await expect(metrics).toContainText("2.5 s");
  // Keep the browser-state evidence outside the committed dashboard: attach it to the PR from test-results/.
  await page.screenshot({ path: "test-results/windows-apps-monitor.png", fullPage: true });
});

test("an empty native inventory and a failed request keep their own states", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/labs/windows/apps", (route) => route.fulfill({
    json: { ...windowsApps, apps: [], checkedAt: Date.now() / 1000 }
  }));
  await page.goto("/labs/windows/");
  await expect(page.getByText("No visible desktop applications were found.")).toBeVisible();

  await page.route("**/api/labs/windows/apps", (route) => route.fulfill({
    status: 500, json: { error: "Windows inventory service failed" }
  }));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Windows inventory service failed");
});

test("non-Windows hosts never query the native Windows inventory", async ({ page }) => {
  const requests: string[] = [];
  await mockApi(page, "linux");
  await page.route("**/api/labs/windows/apps", (route) => {
    requests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { available: false, reason: "Windows only", apps: [] } });
  });

  await page.goto("/labs/windows/");
  await expect(page.getByRole("heading", { name: "Applications on this PC" })).toHaveCount(0);
  expect(requests).toEqual([]);
});
