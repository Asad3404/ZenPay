'use client';

import jsQR from 'jsqr';
import { useEffect, useRef, useState } from 'react';

/** Camera QR scanner using getUserMedia + jsQR. Calls onResult once with the decoded text. */
export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;

    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      if (!v || !c || done) return;
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            done = true;
            onResult(code.data);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => undefined);
          raf = requestAnimationFrame(tick);
        }
      })
      .catch(() => setError('Camera not available. Allow camera access or paste the QR text instead.'));
    if (!navigator.mediaDevices) setError('This browser cannot use the camera. Paste the QR text instead.');

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="space-y-2">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video ref={video} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-10 rounded-2xl border-2 border-white/70" />
      </div>
      <canvas ref={canvas} className="hidden" />
      {error && <p className="text-sm text-warn">{error}</p>}
    </div>
  );
}
