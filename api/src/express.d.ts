import type { User } from "./db/schema.js";

// Lets res.locals.user be typed after requireAuth has run.
declare global {
  namespace Express {
    interface Locals {
      user?: User;
    }
  }
}

export {};
