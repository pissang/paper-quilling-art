import { useRef, useState } from 'react';
import { Button, Group, Modal, NumberInput, Progress, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconCamera, IconDownload, IconSparkles } from '@tabler/icons-react';
import { useRenderer } from '../RendererContext';
import { useRenderInfo, type RenderPhase } from '../store';

const PHASE_LABEL: Record<RenderPhase, string> = {
  preparing: 'Preparing',
  compiling: 'Compiling shaders',
  previewing: 'Preview',
  converging: 'Tracing',
  denoising: 'Denoising',
  finished: 'Done',
  error: 'Error'
};

const PHASE_COLOR: Record<RenderPhase, string> = {
  preparing: 'var(--mantine-color-dark-2)',
  compiling: 'var(--mantine-color-dark-2)',
  previewing: 'var(--mantine-color-blue-4)',
  converging: 'var(--mantine-color-clay-4)',
  denoising: 'var(--mantine-color-grape-4)',
  finished: 'var(--mantine-color-green-5)',
  error: 'var(--mantine-color-red-5)'
};

const BUSY_PHASES: RenderPhase[] = ['preparing', 'compiling', 'previewing', 'converging', 'denoising'];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function ExportModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const renderer = useRenderer();
  const offline = useRenderInfo(s => s.offline);
  const [scale, setScale] = useState('2');
  const [samples, setSamples] = useState<number | string>(1024);
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState('');

  const viewport = renderer?.viewportSize ?? { width: 1920, height: 1080 };
  const dpr = Math.min(window.devicePixelRatio, 2);
  const width = Math.round(viewport.width / dpr * +scale);
  const height = Math.round(viewport.height / dpr * +scale);

  const start = async () => {
    if (!renderer) {
      return;
    }
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const blob = await renderer.renderImage({ width, height, samples: +samples || 256, signal: controller.signal });
      download(blob, `paper-quilling-${timestamp()}.png`);
      onClose();
    }
    catch (e) {
      if (!controller.signal.aborted) {
        setError(String((e as Error)?.message ?? e));
      }
    }
    finally {
      abortRef.current = null;
    }
  };

  const busy = !!offline;
  const progress = offline ? offline.samples / Math.max(offline.target, 1) * 100 : 0;

  return (
    <Modal opened={opened} onClose={() => !busy && onClose()} title="High quality render" centered radius="lg"
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
      closeOnClickOutside={!busy} withCloseButton={!busy}>
      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb={6}>Resolution</Text>
          <SegmentedControl fullWidth disabled={busy} value={scale} onChange={setScale} color="clay"
            data={['1', '2', '3', '4'].map(s => ({ value: s, label: `${s}×` }))} />
          <Text size="xs" c="dimmed" mt={6}>{width} × {height} px, same framing as the viewport</Text>
        </div>
        <NumberInput label="Samples per pixel" min={16} max={16384} step={128} disabled={busy}
          value={samples} onChange={setSamples} />
        {busy && (
          <Stack gap={4}>
            <Progress value={offline.stage === 'denoising' ? 100 : progress} animated
              color={offline.stage === 'denoising' ? 'grape' : 'clay'} />
            <Text size="xs" c="dimmed">
              {offline.stage === 'denoising' ? 'Denoising…' : `${offline.samples} / ${offline.target} samples`}
            </Text>
          </Stack>
        )}
        {error && <Text size="sm" c="red">{error}</Text>}
        <Group justify="flex-end">
          {busy
            ? <Button variant="default" onClick={() => abortRef.current?.abort()}>Cancel</Button>
            : <Button leftSection={<IconSparkles size={16} />} onClick={start} disabled={!renderer}>Render and download</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}

export function RenderFooter() {
  const renderer = useRenderer();
  const { phase, samples, maxSamples, backend, generating, error } = useRenderInfo();
  const [exportOpened, setExportOpened] = useState(false);

  const progress = phase === 'finished' ? 100 : Math.min(samples / maxSamples * 100, 100);
  const ready = !!renderer && !generating && phase !== 'preparing' && phase !== 'compiling' && phase !== 'error';
  const label = generating ? 'Building strips' : PHASE_LABEL[phase];

  const color = generating ? 'var(--mantine-color-yellow-4)' : PHASE_COLOR[phase];
  const busy = generating || BUSY_PHASES.includes(phase);

  return (
    <footer className="sidebar-footer">
      <div className="status">
        <span className="status-dot" data-busy={busy || undefined} style={{ background: color, color }} />
        <span className="status-label">{label}</span>
        {backend && <span className="status-chip">{backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}</span>}
        <span className="status-samples">
          <b>{samples}</b> / {maxSamples} spp
        </span>
      </div>
      <div className="status-progress">
        <div style={{ width: `${progress}%`, background: color }} />
      </div>
      {phase === 'error' && error && <Text size="xs" c="red" lineClamp={3} mt={8}>{error}</Text>}
      <Group grow gap={8} mt={12}>
        <Button variant="default" leftSection={<IconCamera size={16} />} disabled={!ready}
          onClick={async () => renderer && download(await renderer.snapshot(), `paper-quilling-${timestamp()}.png`)}>
          Snapshot
        </Button>
        <Button leftSection={<IconDownload size={16} />} disabled={!ready}
          onClick={() => setExportOpened(true)}>
          Render HQ
        </Button>
      </Group>
      <ExportModal opened={exportOpened} onClose={() => setExportOpened(false)} />
    </footer>
  );
}
