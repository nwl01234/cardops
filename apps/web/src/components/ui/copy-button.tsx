import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CopyButton({
  value,
  className,
  label = 'Скопировать',
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard is unavailable on insecure origins; the SKU stays selectable.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-black/[0.04] hover:text-ink',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-brand-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}
