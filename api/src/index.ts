import { createApp } from "./app.js";
import { runSweep } from "./matching/engine.js";

const port = Number(process.env.PORT ?? 3000);
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

// Safety net for matching: expire stale matches and retry open requests every 10 minutes.
async function sweep() {
  try {
    await runSweep();
  } catch (err) {
    console.error("Matching sweep failed:", err);
  }
}
void sweep();
setInterval(sweep, SWEEP_INTERVAL_MS);
