import {
  DaemonSocket,
  getIdentity,
  getServerUrl,
  setIdentity,
  setServerUrl,
} from "./ws-client.ts";

const daemon = new DaemonSocket();

void daemon.start();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (daemon.isAlarm(alarm.name)) void daemon.reconnect();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type as string | undefined;
  if (type === "GET_STATUS") {
    void (async () => {
      const url = await getServerUrl();
      const identity = await getIdentity();
      sendResponse({
        connected: daemon.isConnected(),
        url,
        state: daemon.state,
        browserId: identity.browserId,
        remark: identity.remark ?? "",
      });
    })();
    return true;
  }
  if (type === "SET_OPTIONS") {
    void (async () => {
      await setServerUrl(String(message.url ?? ""));
      const identity = await setIdentity(String(message.browserId ?? ""), String(message.remark ?? ""));
      await daemon.reconnect(true);
      sendResponse({
        ok: true,
        connected: daemon.isConnected(),
        url: daemon.getServerUrl(),
        browserId: identity.browserId,
        remark: identity.remark ?? "",
      });
    })();
    return true;
  }
  if (type === "RECONNECT") {
    void daemon.reconnect(true).then(() => sendResponse({ connected: daemon.isConnected() }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
