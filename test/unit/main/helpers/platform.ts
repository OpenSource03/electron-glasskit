/** Makes `process.platform` report `platform`. Returns the function that puts the real value back. */
export function stubPlatform(platform: NodeJS.Platform): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  if (!original) throw new Error("process.platform is not an own property");
  Object.defineProperty(process, "platform", { ...original, value: platform });
  return () => {
    Object.defineProperty(process, "platform", original);
  };
}
