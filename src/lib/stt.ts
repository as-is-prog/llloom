export async function transcribe(
  endpointUrl: string,
  audio: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append('file', audio, 'audio.webm');

  const res = await fetch(`${endpointUrl}/transcribe`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`STT error: ${res.status} ${body}`);
  }
  const data = await res.json();
  return (data.text as string).trim();
}
