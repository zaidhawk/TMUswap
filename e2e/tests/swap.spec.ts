import { expect, test } from "@playwright/test";
import { postRequest, signUp } from "./helpers";

// The whole journey from the design doc, with two real browsers side by side.
test("two students sign up, get matched, chat, count down together and complete the swap", async ({ browser }) => {
  const ann = await signUp(browser, "Ann");
  const bob = await signUp(browser, "Bob");
  ann.on("dialog", (dialog) => dialog.accept());

  // Opposite requests: Ann has 011 and wants 012; Bob the other way round.
  await postRequest(ann, { have: "011", wants: "012" });
  await expect(ann.getByText("Lecture: you have 011, you'd take 012")).toBeVisible();
  await postRequest(bob, { have: "12", wants: "11" });

  // Both hear about the match. Ann's page updates live, without reloading.
  await expect(ann.getByText("You have a new swap match!")).toBeVisible();
  await expect(bob.getByRole("link", { name: "You have a match! View it →" })).toBeVisible();

  // Both accept. The steps appear once everyone has.
  await ann.getByRole("link", { name: "You have a match! View it →" }).click();
  await bob.getByRole("link", { name: "You have a match! View it →" }).click();
  await expect(ann.getByText("You give 011 and get 012 from Bob.")).toBeVisible();
  await ann.getByRole("button", { name: "Accept swap" }).click();
  await expect(ann.getByText("You accepted. Waiting for the others.")).toBeVisible();
  await bob.getByRole("button", { name: "Accept swap" }).click();
  await expect(ann.getByText("The swap, step by step")).toBeVisible();
  await expect(ann.getByText("Ann drops section 011.").or(ann.getByText("You drop section 011."))).toBeVisible();

  // Chat in real time.
  await ann.getByLabel("Message").fill("Ready at 3?");
  await ann.getByRole("button", { name: "Send" }).click();
  await expect(bob.getByText("Ready at 3?")).toBeVisible();

  // One press doesn't start the countdown...
  await ann.getByRole("button", { name: "Start countdown" }).click();
  await expect(ann.getByRole("button", { name: "Cancel my Start" })).toBeVisible();
  await expect(bob.getByText("Ann ✓")).toBeVisible();
  await expect(ann.locator(".countdown")).toHaveCount(0);

  // ...but everyone pressing does, for both students at once.
  await bob.getByRole("button", { name: "Start countdown" }).click();
  await expect(ann.locator(".countdown-number")).toBeVisible();
  await expect(bob.locator(".countdown-number")).toBeVisible();
  await expect(ann.getByText("Go! Do your step now.")).toBeVisible({ timeout: 15_000 });
  await expect(bob.getByText("Go! Do your step now.")).toBeVisible({ timeout: 15_000 });

  // Ann reports that it worked; Bob sees it too.
  await ann.getByRole("button", { name: "It worked" }).click();
  await expect(ann.getByText("Swap completed. Nice work!")).toBeVisible();
  await expect(bob.getByText("Swap completed. Nice work!")).toBeVisible();
});

test("a student can report someone they were matched with", async ({ browser }) => {
  const cat = await signUp(browser, "Cat");
  const dan = await signUp(browser, "Dan");
  await postRequest(cat, { have: "021", wants: "022", kind: "Lab" });
  await postRequest(dan, { have: "022", wants: "021", kind: "Lab" });

  await dan.getByRole("link", { name: "You have a match! View it →" }).click();
  await dan.getByRole("button", { name: "Report a problem with someone in this match" }).click();
  await dan.getByLabel(/What happened with Cat/).fill("Asked me to pay for the swap.");
  await dan.getByRole("button", { name: "Send report" }).click();

  await expect(dan.getByText("Thanks. We've received your report")).toBeVisible();
});

test("the rules are readable without logging in, and the login rejects non-TMU emails", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "No wait-listed sections" })).toBeVisible();

  await page.goto("/");
  await page.getByPlaceholder("you@torontomu.ca").fill("someone@gmail.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("Use your @torontomu.ca email")).toBeVisible();
});

test("fits a phone screen without sideways scrolling", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await page.goto("/rules");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
