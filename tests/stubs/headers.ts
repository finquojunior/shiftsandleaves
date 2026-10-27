const jar = new Map<string, string>();
export async function cookies() {
  return {
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  };
}
export async function headers() {
  return new Headers({ host: "localhost:3000" });
}
