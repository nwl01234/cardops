import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { z } from 'zod';
import type { DocumentsConfig } from './env';

export const actCardSchema = z.object({
  id: z.uuid(),
  sku: z.string().min(1),
  title: z.string().min(1),
  maskedNumber: z.string().nullish(),
  status: z.string().min(1),
  version: z.number().int(),
  warehouse: z.object({ code: z.string(), name: z.string() }),
  owner: z.object({ name: z.string() }).nullish(),
  holder: z.object({ name: z.string() }).nullish(),
  createdAt: z.string(),
  operations: z
    .array(
      z.object({
        action: z.string(),
        createdAt: z.string(),
        actor: z.object({ name: z.string() }).nullish(),
      }),
    )
    .max(50)
    .optional(),
});

export type ActCard = z.infer<typeof actCardSchema>;

const STATUS_LABEL: Record<string, string> = {
  in_stock: 'На складе',
  issued: 'Выдана',
  returned: 'Возвращена',
  written_off: 'Списана',
};

const ACTION_LABEL: Record<string, string> = {
  create: 'Создана',
  issue: 'Выдана',
  return: 'Возвращена',
  restock: 'Принята на склад',
  write_off: 'Списана',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export async function renderActPdf(card: ActCard, config: DocumentsConfig): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = readFileSync(resolve(config.PDF_FONT_PATH));
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const ink = rgb(0.08, 0.1, 0.16);
  const muted = rgb(0.36, 0.4, 0.5);
  const brand = rgb(0.05, 0.42, 0.3);
  const line = rgb(0.85, 0.87, 0.9);
  const margin = 48;

  page.drawText('CardOps', { x: margin, y: height - 64, size: 22, font, color: brand });
  page.drawText('Акт по карте', {
    x: margin,
    y: height - 92,
    size: 16,
    font,
    color: ink,
  });
  page.drawText(`Документ сформирован ${formatDate(new Date().toISOString())}`, {
    x: margin,
    y: height - 112,
    size: 9,
    font,
    color: muted,
  });
  page.drawLine({
    start: { x: margin, y: height - 126 },
    end: { x: width - margin, y: height - 126 },
    thickness: 1,
    color: line,
  });

  const rows: Array<[string, string]> = [
    ['SKU', card.sku],
    ['Название', truncate(card.title, 64)],
    ['Номер', card.maskedNumber ?? '—'],
    ['Статус', STATUS_LABEL[card.status] ?? card.status],
    ['Склад', `${card.warehouse.code} · ${card.warehouse.name}`],
    ['Владелец', card.owner?.name ?? '—'],
    ['Держатель', card.holder?.name ?? '—'],
    ['Версия', String(card.version)],
    ['Создана', formatDate(card.createdAt)],
  ];

  let y = height - 158;
  for (const [label, value] of rows) {
    page.drawText(label, { x: margin, y, size: 10, font, color: muted });
    page.drawText(value, { x: margin + 116, y, size: 11, font, color: ink });
    y -= 24;
  }

  y -= 8;
  page.drawText('История операций', { x: margin, y, size: 13, font, color: ink });
  y -= 20;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 0.6,
    color: line,
  });
  y -= 16;

  for (const operation of (card.operations ?? []).slice(0, 12)) {
    const label = ACTION_LABEL[operation.action] ?? operation.action;
    const actor = operation.actor?.name ?? 'Система';
    page.drawText(label, { x: margin, y, size: 10, font, color: ink });
    page.drawText(`${actor} · ${formatDate(operation.createdAt)}`, {
      x: margin + 120,
      y,
      size: 9,
      font,
      color: muted,
    });
    y -= 18;
    if (y < 96) break;
  }

  if ((card.operations ?? []).length === 0) {
    page.drawText('Операций пока нет', { x: margin, y, size: 10, font, color: muted });
  }

  page.drawLine({
    start: { x: margin, y: 72 },
    end: { x: width - margin, y: 72 },
    thickness: 0.6,
    color: line,
  });
  page.drawText('CardOps · внутренний учёт карт · документ не является платёжным инструментом', {
    x: margin,
    y: 54,
    size: 8,
    font,
    color: muted,
  });
  page.drawText(`ID: ${card.id}`, { x: margin, y: 40, size: 7, font, color: muted });

  return pdf.save();
}
