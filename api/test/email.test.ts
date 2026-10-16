import { describe, expect, it, vi } from "vitest";
import { sendWithResend } from "../src/email.js";

const options = {
  apiKey: "re_test_key",
  from: "TMU Swap <login@swap.zaidhaque.ca>",
  to: "student@torontomu.ca",
  code: "123456",
};

describe("sendWithResend", () => {
  it("sends the code to Resend with the API key", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));

    await sendWithResend(options, fetchFn);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key" });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ from: options.from, to: options.to });
    expect(body.subject).toContain("123456");
    expect(body.text).toContain("123456");
    expect(body.text).toContain("We never ask for your TMU password");
  });

  it("throws when Resend rejects the email", async () => {
    const fetchFn = vi.fn(async () => new Response("domain not verified", { status: 403 }));

    await expect(sendWithResend(options, fetchFn)).rejects.toThrow(
      "Resend returned 403: domain not verified",
    );
  });
});
