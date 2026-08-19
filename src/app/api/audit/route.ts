import { runAudit, CaptureError, UrlValidationError } from "@/lib/audit";
import type { ProgressEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") throw new Error("bad body");
    url = body.url;
  } catch {
    return Response.json({ error: "Send a JSON body of the form { url: string }." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: ProgressEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      // Keeps proxies from buffering the response into one chunk.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode("\n"));
          } catch {
            closed = true;
          }
        }
      }, 15_000);

      try {
        const report = await runAudit({ url, onProgress: send });
        send({ type: "report", report });
      } catch (err) {
        const message =
          err instanceof UrlValidationError || err instanceof CaptureError
            ? err.message
            : err instanceof Error
              ? `Audit failed: ${err.message}`
              : "Audit failed for an unknown reason.";
        send({ type: "error", message });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
