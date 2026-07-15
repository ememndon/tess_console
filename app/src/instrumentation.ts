// Runs once at server boot — seeds the sites registry, known jobs, and
// welcome notification (all idempotent).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSeed } = await import("./lib/db/seed");
    await ensureSeed();
  }
}
