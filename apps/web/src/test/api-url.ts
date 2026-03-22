export function apiUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}
