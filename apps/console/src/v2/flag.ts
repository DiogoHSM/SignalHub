const KEY = "sh_v2_shell";
export function resolveV2ShellFlag(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  const q = params.get("v2");
  if (q === "1" || q === "0") {
    localStorage.setItem(KEY, q);
    return q === "1";
  }
  return localStorage.getItem(KEY) === "1";
}
