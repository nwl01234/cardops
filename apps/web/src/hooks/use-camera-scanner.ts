import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface UseCameraScannerOptions {
  onDetect: (code: string) => void;
}

export type CameraAvailability =
  | 'checking'
  | 'available'
  | 'no-device'
  | 'insecure'
  | 'unsupported';

function cameraErrorMessage(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Доступ к камере запрещён. Разрешите камеру в настройках браузера или используйте ручной ввод.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Камера не найдена. Подключите её, загрузите фото или введите код вручную.';
    case 'NotReadableError':
      return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
    case 'AbortError':
      return 'Камера не успела запуститься. Попробуйте ещё раз.';
    default:
      return 'Не удалось включить камеру. Ручной ввод и API остаются доступны.';
  }
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new DOMException('Camera metadata timed out', 'TimeoutError'));
    }, 8_000);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new DOMException('Camera stream failed', 'NotReadableError'));
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

export function useCameraScanner({ onDetect }: UseCameraScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number>(0);
  const onDetectRef = useRef(onDetect);

  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barcodeSupported, setBarcodeSupported] = useState(false);
  const [qrFallback, setQrFallback] = useState(false);
  const [availability, setAvailability] = useState<CameraAvailability>('checking');
  const [deviceCount, setDeviceCount] = useState<number | null>(null);
  const [secureContext, setSecureContext] = useState(false);

  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  const refreshDevices = useCallback(async () => {
    setSecureContext(window.isSecureContext);

    if (!window.isSecureContext) {
      setAvailability('insecure');
      return;
    }
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAvailability('unsupported');
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      setDeviceCount(cameras.length);
      setAvailability(cameras.length > 0 ? 'available' : 'no-device');
    } catch {
      setAvailability('unsupported');
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return; //если API отсутствует, diagnostics уже показал это
    const onChange = () => void refreshDevices();
    mediaDevices.addEventListener('devicechange', onChange);
    return () => mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  const stop = useCallback(() => {
    window.cancelAnimationFrame(frameRef.current);
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);

    if (!window.isSecureContext) {
      setAvailability('insecure');
      setError('Камера доступна только на localhost или HTTPS. Откройте демо на 127.0.0.1.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setAvailability('unsupported');
      setError('Этот браузер не поддерживает getUserMedia. Используйте ручной ввод.');
      return;
    }

    setStarting(true);
    setBarcodeSupported(false);
    setQrFallback(false);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (cause) {
        // Some desktop drivers reject facingMode/width constraints even when
        // a camera exists. Retry with the most permissive video constraint.
        if (
          cause instanceof DOMException &&
          (cause.name === 'OverconstrainedError' || cause.name === 'NotFoundError')
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else {
          throw cause;
        }
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Video element is not mounted');

      video.srcObject = stream;
      await waitForVideoMetadata(video);
      await video.play();
      setActive(true);
      await refreshDevices();

      let nativeDetectorStarted = false;
      if (window.BarcodeDetector) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = supported.filter((format) =>
            ['qr_code', 'code_128', 'code_39', 'ean_13'].includes(format),
          );
          if (formats.length > 0) {
            const detector = new window.BarcodeDetector({ formats });
            nativeDetectorStarted = true;
            setBarcodeSupported(true);

            const tick = async () => {
              if (!streamRef.current || !videoRef.current) return;
              try {
                const results = await detector.detect(videoRef.current);
                const value = results[0]?.rawValue?.trim();
                if (value) {
                  onDetectRef.current(value);
                  stop();
                  return;
                }
              } catch {
                // A single failed frame should not kill the scanner.
              }
              frameRef.current = window.requestAnimationFrame(() => void tick());
            };

            frameRef.current = window.requestAnimationFrame(() => void tick());
          } else {
            setBarcodeSupported(false);
          }
        } catch {
          setBarcodeSupported(false);
        }
      } else {
        setBarcodeSupported(false);
      }

      // Brave and some desktop Chromium builds do not expose BarcodeDetector.
      // jsQR is a small pure-JS fallback that keeps real camera QR scanning
      // useful without a native barcode API.
      if (!nativeDetectorStarted) {
        setQrFallback(true);
        let lastFrameAt = 0;

        const tick = (now: number) => {
          const currentVideo = videoRef.current;
          const canvas = canvasRef.current;
          if (!streamRef.current || !currentVideo || !canvas) return;

          if (now - lastFrameAt < 140 || currentVideo.videoWidth === 0) {
            frameRef.current = window.requestAnimationFrame(tick);
            return;
          }
          lastFrameAt = now;

          const scale = Math.min(1, 800 / currentVideo.videoWidth);
          const width = Math.max(1, Math.round(currentVideo.videoWidth * scale));
          const height = Math.max(1, Math.round(currentVideo.videoHeight * scale));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return;

          context.drawImage(currentVideo, 0, 0, width, height);
          try {
            const image = context.getImageData(0, 0, width, height);
            const result = jsQR(image.data, width, height);
            if (result?.data) {
              onDetectRef.current(result.data);
              stop();
              return;
            }
          } catch {
            // Keep the preview alive; a single failed frame is not fatal.
          }
          frameRef.current = window.requestAnimationFrame(tick);
        };

        frameRef.current = window.requestAnimationFrame(tick);
      }
    } catch (cause) {
      setError(cameraErrorMessage(cause));
      setActive(false);
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      await refreshDevices();
    } finally {
      setStarting(false);
    }
  }, [refreshDevices, stop]);

  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    canvasRef,
    active,
    starting,
    error,
    barcodeSupported,
    qrFallback,
    availability,
    deviceCount,
    secureContext,
    start,
    stop,
    capture,
    refreshDevices,
  };
}
