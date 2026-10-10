chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "latch-run-offscreen") return;
  const frame = document.createElement("iframe");
  frame.src = "run-sandbox.html";
  const logs: unknown[] = [];
  let step: string | undefined;
  let ended = false;
  const finish = (outcome: unknown) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    frame.contentWindow?.postMessage({ type: "stop" }, "*");
    window.removeEventListener("message", listener);
    frame.remove();
    sendResponse(outcome);
  };
  const listener = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || ended) return;
    const data = event.data;
    if (data.type === "ready") frame.contentWindow?.postMessage({ type: "start", source: message.source }, "*");
    if (data.type === "log") logs.push(data.value);
    if (data.type === "done") finish(data.outcome);
    if (data.type === "call") {
      step = data.name;
      void chrome.runtime.sendMessage({ target: "latch-run-background", runId: message.runId, name: data.name, args: data.args }).then((reply) => {
        if (!ended) frame.contentWindow?.postMessage({ type: "reply", id: data.id, ...reply }, "*");
      }, (error) => { if (!ended) finish({ ok: false, logs, error: String(error), step }); });
    }
  };
  const timer = setTimeout(() => finish({ ok: false, logs, error: `run timed out after ${message.timeoutMs}ms`, ...(step ? { step } : {}) }), message.timeoutMs);
  window.addEventListener("message", listener);
  document.body.append(frame);
  return true;
});
