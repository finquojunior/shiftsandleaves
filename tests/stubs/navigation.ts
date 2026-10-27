export class Redirect extends Error { constructor(public url: string) { super("redirect " + url); } }
export function redirect(url: string): never { throw new Redirect(url); }
