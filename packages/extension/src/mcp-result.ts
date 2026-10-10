export function toolSuccess(name: string, data: unknown) {
  if (name === "screenshot" && data && typeof data === "object" && "base64" in data && "mimeType" in data) {
    return { content: [{ type: "image", data: data.base64, mimeType: data.mimeType }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(data) }], ...(data && typeof data === "object" && "ok" in data && data.ok === false ? { isError: true } : {}) };
}
export function toolFailure(error: unknown) {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
}
