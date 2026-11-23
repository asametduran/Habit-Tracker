/** Native apps can't be framed by another site; the web version is use-framed.web.ts. */
export function useFramed(): boolean {
  return false;
}
