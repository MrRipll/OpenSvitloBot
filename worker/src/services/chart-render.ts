import { CHART_WIDTH, CHART_HEIGHT, buildChartHTML } from './chart-image';

/** 800px design → 1280px PNG. Telegram downsizes photos anyway. */
const SCALE = 1.6;

export interface BrowserBinding {
  quickAction(action: 'screenshot', options: Record<string, unknown>): Promise<unknown>;
}

/**
 * Renders the chart SVG to PNG with Browser Run quick actions. The browser does the work,
 * so this costs the Worker almost no CPU (unlike resvg-wasm, which blew the Free plan's 10 ms).
 */
export async function renderChartPng(browser: BrowserBinding, svg: string): Promise<Uint8Array> {
  const result = await browser.quickAction('screenshot', {
    html: buildChartHTML(svg),
    viewport: { width: CHART_WIDTH, height: CHART_HEIGHT, deviceScaleFactor: SCALE },
    gotoOptions: { waitUntil: 'networkidle0', timeout: 20000 },
    screenshotOptions: { type: 'png' },
  });
  const bytes = await toBytes(result);
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) {
    throw new Error(`screenshot is not a PNG: ${new TextDecoder().decode(bytes.slice(0, 300))}`);
  }
  return bytes;
}

async function toBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Response) {
    if (!result.ok) throw new Error(`screenshot failed: HTTP ${result.status} ${await result.text()}`);
    return new Uint8Array(await result.arrayBuffer());
  }
  if (result instanceof ReadableStream || result instanceof Blob) {
    return new Uint8Array(await new Response(result).arrayBuffer());
  }
  throw new Error(`unexpected screenshot result: ${Object.prototype.toString.call(result)}`);
}
