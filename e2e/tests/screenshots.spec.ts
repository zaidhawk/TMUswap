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
  const daquan = await phoneStudent(browser, "Daquan");
  const jerome = await phoneStudent(browser, "Jerome");

  async function post(page: typeof maya, have: string, wants: string) {
    await page.getByRole("link", { name: "New request" }).click();
    await page.getByPlaceholder("CPS 510 or Database").fill("510");
    await page.getByRole("button", { name: /Database Systems I/ }).click();
    await page.getByLabel(/Your lecture section/).fill(have);
    await page.getByLabel(/Sections you'd take instead/).fill(wants);
    await page.getByLabel(/None of these sections has a wait list/).check();
  }

  await post(maya, "011", "012, 015");
  await maya.screenshot({ path: `${OUT}/2-new-request.png` });
  await maya.getByRole("button", { name: "Post request" }).click();

  // No two of them want each other's sections, so only a 3-way swap works:
  // Maya's 011 → Jerome, Jerome's 013 → Daquan, Daquan's 012 → Maya.
  await post(daquan, "012", "013");
  await daquan.getByRole("button", { name: "Post request" }).click();
  await post(jerome, "013", "011");
  await jerome.getByRole("button", { name: "Post request" }).click();

  await expect(maya.getByText("You have a new swap match!")).toBeVisible();
  await maya.screenshot({ path: `${OUT}/3-matched.png` });

  const everyone = [maya, daquan, jerome];
  for (const page of everyone) {
    await page.getByRole("link", { name: "You have a match! View it →" }).click();
    await page.getByRole("button", { name: "Accept swap" }).click();
  }
  await expect(maya.getByText("The swap, step by step")).toBeVisible();
  await daquan.getByLabel("Message").fill("Hey! Free at 3 today?");
  await daquan.getByRole("button", { name: "Send" }).click();
  await expect(jerome.getByText("Hey! Free at 3 today?")).toBeVisible();
  await jerome.getByLabel("Message").fill("3 works for me");
  await jerome.getByRole("button", { name: "Send" }).click();
  await expect(maya.getByText("3 works for me")).toBeVisible();
  await maya.getByLabel("Message").fill("Perfect, let's do it 👍");
  await maya.getByRole("button", { name: "Send" }).click();
  await expect(daquan.getByText("Perfect, let's do it 👍")).toBeVisible();
  for (const page of everyone) await page.getByRole("button", { name: "Start countdown" }).click();
  await expect(maya.locator(".countdown-number")).toBeVisible();
  await maya.screenshot({ path: `${OUT}/4-countdown.png`, fullPage: true });
});
