/**
 * Browser download helper.
 *
 * The object URL is revoked on the next task rather than immediately: Safari
 * cancels an in-flight download if the blob URL disappears in the same tick.
 */

export function download(filename: string, content: BlobPart, type = 'text/plain'): void {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
