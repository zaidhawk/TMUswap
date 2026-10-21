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
  // The web app's address: the only site allowed to call the API, and the base for email links.
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  // The term students are swapping for. Courses are seeded from data/courses-<term>.csv.
  currentTerm: process.env.CURRENT_TERM ?? "2027W",
  // Last day to enrol for the term (YYYY-MM-DD, Toronto time). After it, swaps are blocked.
  // Unset until TMU publishes the date.
  lastDayToEnrol: process.env.LAST_DAY_TO_ENROL ?? null,
  // Receives reports and money-mention alerts.
  adminEmail: process.env.ADMIN_EMAIL ?? "zaidhaque63@gmail.com",
  // Must be on a domain verified in Resend.
  emailFrom: process.env.EMAIL_FROM ?? "TMU Swap <login@swap.zaidhaque.ca>",
};
