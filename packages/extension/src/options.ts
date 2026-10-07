const DEFAULT_URL = "ws://127.0.0.1:12580/ws";

const statusEl = document.getElementById("status")!;
const urlEl = document.getElementById("url") as HTMLInputElement;
const idEl = document.getElementById("browser-id") as HTMLInputElement;
const remarkEl = document.getElementById("remark") as HTMLInputElement;

function renderStatus(connected: boolean, url: string, browserId: string, remark: string): void {
  const name = remark ? `${browserId} (${remark})` : browserId;
  statusEl.textContent = connected ? `Connected as ${name} to ${url}` : `Disconnected — ${name} @ ${url}`;
  statusEl.className = `status ${connected ? "ok" : "bad"}`;
  urlEl.value = url;
  idEl.value = browserId;
  remarkEl.value = remark;
}

async function refresh(): Promise<void> {
  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  renderStatus(
    Boolean(status?.connected),
    String(status?.url ?? DEFAULT_URL),
    String(status?.browserId ?? ""),
    String(status?.remark ?? ""),
  );
}

async function save(url: string): Promise<void> {
  const result = await chrome.runtime.sendMessage({
    type: "SET_OPTIONS",
    url,
    browserId: idEl.value,
    remark: remarkEl.value,
  });
  renderStatus(
    Boolean(result?.connected),
    String(result?.url ?? url),
    String(result?.browserId ?? idEl.value),
    String(result?.remark ?? remarkEl.value),
  );
}

document.getElementById("save")!.addEventListener("click", () => {
  void save(urlEl.value.trim() || DEFAULT_URL);
});

document.getElementById("reset")!.addEventListener("click", () => {
  void save(DEFAULT_URL);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "LATCH_STATUS") {
    renderStatus(
      message.state === "connected",
      String(message.url ?? ""),
      idEl.value,
      remarkEl.value,
    );
  }
});

void refresh();
