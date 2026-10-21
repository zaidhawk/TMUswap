import { expect, test, type Browser } from "@playwright/test";
import { API_URL } from "./helpers";

// Regenerates the README screenshots. Not part of the normal test run:
//   SCREENSHOTS=1 npm run e2e -- screenshots
test.skip(!process.env.SCREENSHOTS, "Only runs when SCREENSHOTS=1");

const OUT = "../docs/screenshots";

// A phone-sized student, logged in through the real UI.
async function phoneStudent(browser: Browser, name: string) {
  const page = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" })
  ).newPage();
  const email = `${name.toLowerCase()}-shots-${Date.now()}@torontomu.ca`;
  await page.goto("/");
  await page.getByPlaceholder("you@torontomu.ca").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const { code } = (await (await page.request.get(`${API_URL}/test/last-code`, { params: { email } })).json()) as {
    code: string;
  };
  await page.getByPlaceholder("123456").fill(code);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  return page;
}

test("README screenshots", async ({ browser }) => {
  const login = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark" })
  ).newPage();
  await login.goto("/");
  await login.screenshot({ path: `${OUT}/1-login.png` });

  const maya = await phoneStudent(browser, "Maya");
  const omar = await phoneStudent(browser, "Omar");

  await maya.getByRole("link", { name: "New request" }).click();
  await maya.getByPlaceholder("CPS 510 or Database").fill("510");
  await maya.getByRole("button", { name: /Database Systems I/ }).click();
  await maya.getByLabel(/Your lecture section/).fill("011");
  await maya.getByLabel(/Sections you'd take instead/).fill("012, 015");
  await maya.getByLabel(/None of these sections has a wait list/).check();
  await maya.screenshot({ path: `${OUT}/2-new-request.png` });
  await maya.getByRole("button", { name: "Post request" }).click();

  await omar.getByRole("link", { name: "New request" }).click();
  await omar.getByPlaceholder("CPS 510 or Database").fill("510");
  await omar.getByRole("button", { name: /Database Systems I/ }).click();
  await omar.getByLabel(/Your lecture section/).fill("012");
  await omar.getByLabel(/Sections you'd take instead/).fill("011");
  await omar.getByLabel(/None of these sections has a wait list/).check();
  await omar.getByRole("button", { name: "Post request" }).click();

  await expect(maya.getByText("You have a new swap match!")).toBeVisible();
  await maya.screenshot({ path: `${OUT}/3-matched.png` });

  for (const page of [maya, omar]) {
    await page.getByRole("link", { name: "You have a match! View it →" }).click();
    await page.getByRole("button", { name: "Accept swap" }).click();
  }
  await expect(maya.getByText("The swap, step by step")).toBeVisible();
  await omar.getByLabel("Message").fill("Hey! Free at 3 today?");
  await omar.getByRole("button", { name: "Send" }).click();
  await maya.getByLabel("Message").fill("Perfect, let's do it 👍");
  await maya.getByRole("button", { name: "Send" }).click();
  await expect(omar.getByText("Perfect, let's do it 👍")).toBeVisible();
  await maya.getByRole("button", { name: "Start countdown" }).click();
  await omar.getByRole("button", { name: "Start countdown" }).click();
  await expect(maya.locator(".countdown-number")).toBeVisible();
  await maya.screenshot({ path: `${OUT}/4-countdown.png`, fullPage: true });
});
