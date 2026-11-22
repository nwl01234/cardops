import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowRight,
  Camera,
  CameraOff,
  CheckCircle2,
  Image as ImageIcon,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { useCameraScanner } from '@/hooks/use-camera-scanner';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/ui/badge';
import { errorMessage } from '@/lib/errors';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const DEMO_CODES = ['CRD-DEMO-01', 'CRD-DEMO-02', 'CRD-DEMO-04'];

export function ScanPage() {
  useDocumentTitle('Сканер');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [framePreview, setFramePreview] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, []);

  const scanMutation = useMutation({
    mutationFn: (value: string) => api.cards.scan({ code: value }),
    onSuccess: () => {
      setFramePreview(null);
      setFilePreview(null);
      if (fileUrlRef.current) {
        URL.revokeObjectURL(fileUrlRef.current);
        fileUrlRef.current = null;
      }
      setLocalError(null);
    },
  });

  const ocrMutation = useMutation({
    mutationFn: (file: File) => api.scan.ocr(file),
  });

  const submitCode = (value: string) => {
    const normalized = value.trim().toUpperCase();
    if (normalized.length < 4) {
      setLocalError('Код должен содержать минимум 4 символа.');
      return;
    }
    setLocalError(null);
    setCode(normalized);
    scanMutation.mutate(normalized);
  };

  useEffect(() => {
    if (!ocrMutation.data?.code) return;
    submitCode(ocrMutation.data.code);
    // The OCR result is intentionally forwarded to the same server-side
    // resolve endpoint; OCR never grants access by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrMutation.data]);

  const scanner = useCameraScanner({
    onDetect: (value) => {
      setCode(value.toUpperCase());
      submitCode(value);
    },
  });

  const onCapture = () => {
    const preview = scanner.capture();
    if (!preview) {
      setLocalError('Кадр пока недоступен: дождитесь запуска камеры.');
      return;
    }
    setFilePreview(null);
    setFramePreview(preview);
    scanMutation.reset();
  };

  const onFileSelected = (file: File | undefined) => {
    if (!file) return;
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    setFramePreview(null);
    setFilePreview(url);
    setLocalError(null);
    // The photo is OCR input, not a business decision. OCR only extracts a
    // candidate SKU; the normal scan endpoint still checks access.
    scanMutation.reset();
    ocrMutation.mutate(file);
  };

  const cameraStatus = scanner.active
    ? {
        label: 'сканирование',
        className: 'bg-emerald-50 text-emerald-800',
        dot: 'bg-emerald-500 live-dot',
      }
    : scanner.availability === 'available'
      ? {
          label: 'камера найдена',
          className: 'bg-brand-50 text-brand-800',
          dot: 'bg-brand-500',
        }
      : scanner.availability === 'checking'
        ? {
            label: 'проверка',
            className: 'bg-black/[0.04] text-muted',
            dot: 'bg-slate-400',
          }
        : {
            label: 'камера недоступна',
            className: 'bg-amber-50 text-amber-900',
            dot: 'bg-amber-500',
          };

  const cameraTitle = scanner.active
    ? 'Камера включена'
    : scanner.availability === 'checking'
      ? 'Проверяем камеру'
      : scanner.availability === 'no-device'
        ? 'Камера не найдена'
        : scanner.availability === 'insecure'
          ? 'Нужен localhost или HTTPS'
          : scanner.availability === 'unsupported'
            ? 'Камера не поддерживается'
            : 'Камера выключена';

  const cameraDescription =
    scanner.availability === 'no-device'
      ? 'Браузер не видит ни одного videoinput. Подключите камеру и проверьте Windows Settings → Privacy & security → Camera. Либо загрузите фото или введите код вручную. Это ограничение устройства, а не API.'
      : scanner.availability === 'insecure'
        ? 'getUserMedia работает только в secure context. Откройте http://127.0.0.1:5173 или HTTPS.'
        : scanner.availability === 'unsupported'
          ? 'Этот браузер не поддерживает getUserMedia. Ручной ввод и API продолжают работать.'
          : 'Разрешение запрашивается только по нажатию. Если браузер спросит доступ — разрешите камеру.';

  const preview = filePreview ?? framePreview;
  const previewLabel = filePreview ? 'Фото с устройства' : 'Кадр с камеры';
  const result = scanMutation.data;
  const error = scanMutation.error;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Mobile scenario"
        title="Сканер"
        description="Камера распознаёт только код. Клиент отправляет identifier в API, а решение о доступе и статусе принимает backend."
      />

      <div className="grid items-start gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Камера"
            description="QR / Code 128 через BarcodeDetector, если браузер поддерживает."
            action={
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
                  cameraStatus.className,
                )}
              >
                <span className={cn('size-1.5 rounded-full', cameraStatus.dot)} />
                {cameraStatus.label}
              </span>
            }
          />
          <div className="p-4">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-brand-950">
              <video
                ref={scanner.videoRef}
                className={cn('size-full object-cover', !scanner.active && 'opacity-0')}
                playsInline
                muted
              />
              <canvas ref={scanner.canvasRef} className="hidden" />

              {!scanner.active ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-accent-400 ring-1 ring-white/10">
                    {scanner.availability === 'no-device' ||
                    scanner.availability === 'insecure' ||
                    scanner.availability === 'unsupported' ? (
                      <CameraOff className="size-5" />
                    ) : (
                      <ScanLine className="size-5" />
                    )}
                  </span>
                  <p className="text-sm font-semibold text-white">{cameraTitle}</p>
                  <p className="mt-1 max-w-sm text-[11px] leading-relaxed text-white/45">
                    {cameraDescription}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      variant="secondary"
                      className="border-white/20 bg-white text-brand-950 hover:bg-brand-50"
                      onClick={() => void scanner.start()}
                      loading={scanner.starting}
                      disabled={
                        scanner.availability === 'insecure' ||
                        scanner.availability === 'unsupported'
                      }
                      icon={<Camera className="size-4" />}
                    >
                      Включить камеру
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-white/60 hover:bg-white/10 hover:text-white"
                      onClick={() => void scanner.refreshDevices()}
                      icon={<RefreshCw className="size-3.5" />}
                    >
                      Проверить снова
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-dashed border-white/35" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/65 to-transparent px-4 pb-4 pt-10">
                    <p className="text-[10px] font-medium text-white/80">
                      {scanner.barcodeSupported
                        ? 'Наведите камеру на QR или штрихкод'
                        : scanner.qrFallback
                          ? 'QR через jsQR · штрихкоды введите вручную'
                          : 'Автоопределение недоступно — используйте ручной ввод'}
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={onCapture}
                        className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur hover:bg-white/25"
                      >
                        Снять кадр
                      </button>
                      <button
                        type="button"
                        onClick={scanner.stop}
                        className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur hover:bg-white/25"
                      >
                        Стоп
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {scanner.error ? (
              <p
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900"
                role="alert"
              >
                {scanner.error}
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-line bg-canvas/50 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wide text-muted">secure context</p>
                <p className="mt-0.5 text-[10px] font-semibold text-ink">
                  {scanner.secureContext ? 'да' : 'нет'}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-canvas/50 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wide text-muted">videoinput</p>
                <p className="mt-0.5 text-[10px] font-semibold text-ink">
                  {scanner.deviceCount === null ? '…' : scanner.deviceCount}
                </p>
              </div>
              <div className="rounded-lg border border-line bg-canvas/50 px-2 py-1.5">
                <p className="text-[9px] uppercase tracking-wide text-muted">QR decoder</p>
                <p className="mt-0.5 text-[10px] font-semibold text-ink">
                  {scanner.barcodeSupported ? 'native' : scanner.qrFallback ? 'jsQR' : '—'}
                </p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                onFileSelected(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => fileInputRef.current?.click()}
              icon={<Upload className="size-3.5" />}
              loading={ocrMutation.isPending}
            >
              Распознать фото (OCR)
            </Button>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              Tesseract.js читает текст с фото и извлекает SKU. Если код не найден, введите его
              вручную — доступ всё равно проверит API.
            </p>
            {ocrMutation.data ? (
              <p className="mt-1.5 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[10px] text-brand-900">
                OCR: {ocrMutation.data.code ?? 'SKU не найден'} · уверенность{' '}
                {ocrMutation.data.confidence}% · {ocrMutation.data.durationMs} мс
              </p>
            ) : null}
            {ocrMutation.error ? (
              <p className="mt-1.5 text-[10px] text-rose-700" role="alert">
                {errorMessage(ocrMutation.error, 'OCR не смог прочитать изображение')}
              </p>
            ) : null}

            {preview ? (
              <div className="mt-3 rounded-xl border border-line bg-canvas/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-ink">
                    <ImageIcon className="size-3.5 text-brand-600" />
                    {previewLabel} · готово
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (filePreview && fileUrlRef.current) {
                        URL.revokeObjectURL(fileUrlRef.current);
                        fileUrlRef.current = null;
                      }
                      setFilePreview(null);
                      setFramePreview(null);
                    }}
                    className="rounded-md p-1 text-muted hover:bg-black/[0.04] hover:text-ink"
                    aria-label="Удалить превью"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <img
                  src={preview}
                  alt={previewLabel}
                  className="mt-2 max-h-32 w-full rounded-lg object-cover"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-muted">
                  Tesseract.js обрабатывает фото. Если SKU найден, API проверит доступ; если нет —
                  введите код вручную.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[10px] leading-relaxed text-muted">
                <Sparkles className="mr-1 inline size-3 text-brand-600" />
                «Снять кадр» рисует текущий frame в canvas. Если камеры нет, загрузите фото с
                телефона или введите код вручную.
              </p>
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHeader
              title="Ручной ввод"
              description="Самый надёжный fallback, если камера недоступна."
            />
            <PanelBody className="space-y-3">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCode(code);
                }}
              >
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                    placeholder="CRD-DEMO-01"
                    className="pl-9 font-mono uppercase"
                    aria-label="SKU карты"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" loading={scanMutation.isPending}>
                  Найти
                  <ArrowRight className="size-4" />
                </Button>
              </form>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-muted">Демо-коды:</span>
                {DEMO_CODES.map((demoCode) => (
                  <button
                    key={demoCode}
                    type="button"
                    onClick={() => submitCode(demoCode)}
                    className="rounded-full border border-line bg-white px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-brand-200 hover:text-brand-800"
                  >
                    {demoCode}
                  </button>
                ))}
                <a
                  href="/demo-qr.svg"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Открыть demo QR
                </a>
              </div>

              {localError ? (
                <p className="text-xs font-medium text-rose-700" role="alert">
                  {localError}
                </p>
              ) : null}

              {error ? (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3"
                  role="alert"
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                    <ShieldAlert className="size-4" />
                    {error instanceof ApiError && error.status === 404
                      ? 'Код не найден или недоступен'
                      : 'Не удалось выполнить поиск'}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80">
                    {error instanceof ApiError && error.status === 404
                      ? 'API не раскрывает существование чужих карт: для вашей роли код выглядит как отсутствующий.'
                      : errorMessage(error)}
                  </p>
                </div>
              ) : null}
            </PanelBody>
          </Panel>

          {result ? (
            <Panel className="animate-enter overflow-hidden">
              <div className="border-b border-line bg-brand-50/60 px-5 py-3">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-800">
                  <CheckCircle2 className="size-4" />
                  API нашёл карту в вашем контуре
                </p>
              </div>
              <PanelBody className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{result.title}</p>
                    <p className="mt-1 font-mono text-[11px] text-muted">{result.sku}</p>
                  </div>
                  <StatusBadge status={result.status} />
                </div>

                <dl className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <dt className="text-muted">Склад</dt>
                    <dd className="mt-0.5 font-medium text-ink">{result.warehouse.name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Держатель</dt>
                    <dd className="mt-0.5 font-medium text-ink">{result.holder?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Владелец</dt>
                    <dd className="mt-0.5 font-medium text-ink">{result.owner?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Обновлена</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {formatRelative(result.updatedAt)}
                    </dd>
                  </div>
                </dl>

                <Link
                  to={`/cards/${result.id}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-900"
                >
                  Открыть карточку
                  <ArrowRight className="size-4" />
                </Link>
                <p className="text-[10px] leading-relaxed text-muted">
                  Скан не меняет статус. Доступные действия появятся на странице карты и будут
                  проверены сервером.
                </p>
              </PanelBody>
            </Panel>
          ) : (
            <Panel className="border-dashed">
              <PanelBody className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <QrCode className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-ink">Что произойдёт после скана</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    Frontend отправит только код. API проверит JWT, роль, склад и владельца и вернёт
                    карту или 404. Никаких решений на клиенте.
                  </p>
                </div>
              </PanelBody>
            </Panel>
          )}

          {scanMutation.isPending ? (
            <p className="text-center text-[11px] text-muted">Проверяем код на сервере…</p>
          ) : null}

          {code ? (
            <button
              type="button"
              onClick={() => {
                setCode('');
                setFramePreview(null);
                setFilePreview(null);
                if (fileUrlRef.current) {
                  URL.revokeObjectURL(fileUrlRef.current);
                  fileUrlRef.current = null;
                }
                scanMutation.reset();
              }}
              className="mx-auto flex items-center gap-1 text-[10px] text-muted hover:text-ink"
            >
              <X className="size-3" />
              Сбросить результат
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
