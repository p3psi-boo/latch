import { installRunWorker } from "./run-worker.ts";
let worker: Worker | undefined;
window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const message = event.data;
  if (message.type === "start") {
    worker?.terminate();
    const url = URL.createObjectURL(new Blob([`(${installRunWorker.toString()})();`], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (result) => parent.postMessage(result.data, "*");
    worker.onerror = (error) => parent.postMessage({ type: "done", outcome: { ok: false, logs: [], error: error.message } }, "*");
    worker.postMessage(message);
  } else if (message.type === "reply") worker?.postMessage(message);
  else if (message.type === "stop") { worker?.terminate(); worker = undefined; }
});
parent.postMessage({ type: "ready" }, "*");
