const continuousIngestion = async () => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const secret = process.env.INGESTION_CRON_SECRET;
  if (!appUrl || !secret) throw new Error("Continuous ingestion is not configured.");
  const response = await fetch(`${appUrl}/api/internal/ingestion/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) throw new Error(`Continuous ingestion failed (${response.status}).`);
};

export default continuousIngestion;

export const config = { schedule: "*/10 * * * *" };
