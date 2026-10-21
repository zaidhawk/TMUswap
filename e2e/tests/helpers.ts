import { expect, type Browser, type Page } from "@playwright/test";

export const API_URL = "http://localhost:3100";

// Signs up a brand-new student in their own browser (separate cookies), through the real UI.
// The login code comes from the test-only API route, so no real inbox is needed.
export async function signUp(browser: Browser, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const email = `${name.toLowerCase()}-${Date.now()}@torontomu.ca`;

  await page.goto("/");
  await page.getByPlaceholder("you@torontomu.ca").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const res = await page.request.get(`${API_URL}/test/last-code`, { params: { email } });
  const { code } = (await res.json()) as { code: string };
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "Log in" }).click();

  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  return page;
}

type Request = { have: string; wants: string; kind?: "Lecture" | "Lab" | "Tutorial" };

// Posts a CPS 510 swap request through the New request form.
export async function postRequest(page: Page, { have, wants, kind = "Lecture" }: Request) {
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByPlaceholder("CPS 510 or Database").fill("510");
  await page.getByRole("button", { name: /Database Systems I/ }).click();
  await page.getByLabel(kind, { exact: true }).check();
  await page.getByLabel(new RegExp(`Your ${kind.toLowerCase()} section`)).fill(have);
  await page.getByLabel(/Sections you'd take instead/).fill(wants);
  await page.getByLabel(/None of these sections has a wait list/).check();
  await page.getByRole("button", { name: "Post request" }).click();
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
}
