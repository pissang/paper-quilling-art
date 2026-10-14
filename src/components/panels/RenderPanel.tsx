import { Button, Group, Stack } from '@mantine/core';
import { IconFocusCentered, IconRotate2 } from '@tabler/icons-react';
import { useRenderer } from '../../RendererContext';
import { setConfig, useConfigValue } from '../../store';
import { ChoiceField, Note, Section, SliderField, SwitchField } from '../fields';

export function RenderPanel() {
  const renderer = useRenderer();
  const denoise = useConfigValue('denoise');
  return (
    <Stack gap={22}>
      <Section title="Camera">
        <SliderField name="spinAngle" label="Spin" min={-Math.PI} max={Math.PI} step={0.01}
          format={v => `${Math.round(v * 180 / Math.PI)}°`} hint="Rotate the artwork. You can also right-drag in the viewport." />
        <SliderField name="fov" label="Field of view" min={10} max={80} step={1} format={v => `${v}°`} />
        <Group grow gap="xs">
          <Button size="xs" variant="default" leftSection={<IconFocusCentered size={14} />}
            onClick={() => renderer?.resetCamera()}>
            Top view
          </Button>
          <Button size="xs" variant="default" leftSection={<IconRotate2 size={14} />}
            onClick={() => setConfig({ spinAngle: 0 })}>
            Reset spin
          </Button>
        </Group>
      </Section>

      <Section title="Look">
        <ChoiceField
          name="toneMapping"
          label="Tone map"
          variant="select"
          data={[
            { value: 'agx', label: 'AgX' },
            { value: 'aces', label: 'ACES' },
            { value: 'cineon', label: 'Cineon' },
            { value: 'reinhard', label: 'Reinhard' },
            { value: 'linear', label: 'Linear' }
          ]}
        />
        <SliderField name="exposure" label="Exposure" min={0.1} max={4} step={0.05} />
        <SliderField name="contrast" label="Contrast" min={0.5} max={1.5} step={0.01} />
        <SliderField name="saturation" label="Saturation" min={0} max={2} step={0.01} />
        <SliderField name="vignette" label="Vignette" min={0} max={1} step={0.01} />
        <SliderField name="bloom" label="Bloom" min={0} max={1} step={0.01} />
      </Section>

      <Section title="Path tracing">
        <SliderField name="maxSamples" label="Samples" min={16} max={4096} step={16}
          hint="Samples per pixel accumulated in the viewport before it stops." />
        <SliderField name="bounces" label="Bounces" min={1} max={12} step={1} />
        <SwitchField name="denoise" label="Denoise"
          hint="Intel Open Image Denoise on WebGPU. WebGL 2 falls back to joint non-local means." />
        {denoise && (
          <SwitchField name="liveDenoise" label="Live denoise"
            hint="Denoise progressively while the image converges, and every preview frame while you interact (small OIDN network)." />
        )}
        <Note>Add <code>?webgl</code> to the URL to force the WebGL 2 backend.</Note>
      </Section>
    </Stack>
  );
}
