import { test, expect } from "@playwright/test";

test("visitor is redirected to a clear invite-only login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome to Nova." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText("There is no public registration", { exact: false })).toBeVisible();
});

test("unauthenticated chat API is blocked without an upstream request", async ({ request }) => {
  const response = await request.post("/api/chat", { data: { message: "Do not send this", sessionId: "e4527328-b830-4d56-bdaf-e1aedeb039b1" } });
  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({ code: "unauthorized" });
});

test("public email/password registration is disabled", async ({ request }) => {
  const response = await request.post("/api/auth/sign-up/email", { data: { name: "Public", email: "public@example.com", password: "not-used" } });
  expect(response.status()).toBe(403);
});

test("admin API requires an owner session", async ({ request }) => {
  const response = await request.get("/api/admin/allowed-users");
  expect(response.status()).toBe(403);
});

test("bad credentials show an error and an invite link is required", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("unknown@example.test");
  await page.getByLabel("Password").fill("incorrect-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("incorrect");
  await page.goto("/accept-invite");
  await expect(page.locator(".auth-card").getByRole("alert")).toContainText("missing or invalid");
});

test("a complete invitation link shows the password form in development", async ({ page }) => {
  await page.goto(`/accept-invite#token=${"a".repeat(43)}`);
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Password (at least 12 characters)")).toBeVisible();
  await expect(page).toHaveURL(/\/accept-invite$/);
});

test("login layout has no horizontal overflow on desktop and mobile", async ({ page }) => {
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 720]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome to Nova." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
