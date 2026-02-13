export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

export async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    let errorMsg = `Error ${res.status}: ${res.statusText}`;
    try {
      const json = await res.json();
      if (json.detail) errorMsg = `Error ${res.status}: ${json.detail}`;
    } catch (e) {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }
  return res.json();
}
