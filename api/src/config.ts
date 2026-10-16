const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  isProduction,
  // Signs login code hashes. Production must set a long random value; locally any value works.
  authSecret: isProduction ? required("AUTH_SECRET") : (process.env.AUTH_SECRET ?? "dev-only-secret"),
  // Must be on a domain verified in Resend.
  emailFrom: process.env.EMAIL_FROM ?? "TMU Swap <login@swap.zaidhaque.ca>",
};
