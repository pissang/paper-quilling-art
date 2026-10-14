import { useRef } from 'react';
import { Group, Stack } from '@mantine/core';
import { PAPER_TEXTURES } from '../../config';
import { setConfig, useConfigValue } from '../../store';
import { ChoiceField, ColorField, Section, SliderField, SwitchField } from '../fields';

const PAD_RANGE = 1;

function DirectionPad() {
  const [x, y] = useConfigValue('lightDirection');
  const ref = useRef<HTMLDivElement>(null);

  const update = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    let dx = ((e.clientX - rect.left) / rect.width * 2 - 1) * PAD_RANGE;
    let dy = -((e.clientY - rect.top) / rect.height * 2 - 1) * PAD_RANGE;
    const len = Math.hypot(dx, dy);
    if (len > PAD_RANGE) {
      dx *= PAD_RANGE / len;
      dy *= PAD_RANGE / len;
    }
    setConfig({ lightDirection: [+dx.toFixed(3), +dy.toFixed(3)] });
  };

  return (
    <div
      ref={ref}
      className="direction-pad"
      title="Drag to move the light"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={e => e.buttons && update(e)}
    >
      <div
        className="direction-pad-handle"
        style={{ left: `${(x / PAD_RANGE + 1) * 50}%`, top: `${(1 - y / PAD_RANGE) * 50}%` }}
      />
    </div>
  );
}

export function ScenePanel() {
  const environment = useConfigValue('environment');
  const showPlane = useConfigValue('showPlane');
  return (
    <Stack gap={22}>
      <Section title="Paper">
        <ChoiceField
          name="paperTexture"
          label="Texture"
          variant="select"
          data={[
            { value: '', label: 'None' },
            { value: PAPER_TEXTURES['paper-detail'], label: 'Fibre' },
            { value: PAPER_TEXTURES['cream-paper'], label: 'Cream' },
            { value: PAPER_TEXTURES.watercolor, label: 'Watercolor' }
          ]}
        />
        <SliderField name="paperRoughness" label="Roughness" min={0.2} max={1} step={0.01} />
        <SliderField name="bumpScale" label="Bump" min={0} max={2} step={0.05} />
        <SliderField name="translucency" label="Translucency" min={0} max={1} step={0.01}
          hint="Subsurface scattering. Light glows through thin strips; higher values need more samples." />
        <SliderField name="bevel" label="Edge bevel" min={0} max={0.02} step={0.001}
          hint="Rounds strip edges in shading only." />
      </Section>

      <Section title="Light">
        <Group gap="md" wrap="nowrap" align="center">
          <DirectionPad />
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <SliderField name="lightIntensity" label="Sun" min={0} max={8} step={0.1} />
            <SliderField name="lightSoftness" label="Softness" min={0.5} max={40} step={0.5}
              format={v => `${v}°`} hint="Angular size of the light. Larger lights cast softer shadows." />
          </Stack>
        </Group>
        <ChoiceField
          name="environment"
          label="Environment"
          variant="select"
          data={[
            { value: 'canyon', label: 'Canyon' },
            { value: 'hall', label: 'Hall' },
            { value: 'pisa', label: 'Pisa' },
            { value: 'none', label: 'Uniform' }
          ]}
        />
        <SliderField name="environmentIntensity" label={environment === 'none' ? 'Ambient' : 'Env strength'}
          min={0} max={3} step={0.05} />
      </Section>

      <Section title="Ground">
        <SwitchField name="showPlane" label="Paper board"
          hint="Turn off to render only the shadows over the background color." />
        {showPlane
          ? <ColorField name="planeColor" label="Board color" />
          : (
            <>
              <ColorField name="shadowColor" label="Shadow color" />
              <SliderField name="shadowIntensity" label="Shadow" min={0} max={1} step={0.01} />
            </>
          )}
        <ColorField name="backgroundColor" label="Background" />
      </Section>
    </Stack>
  );
}
