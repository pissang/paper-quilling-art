import { useRef } from 'react';
import { Group, Stack } from '@mantine/core';
import { IconBulb, IconLayoutBoard, IconTexture } from '@tabler/icons-react';
import { PAPER_TEXTURES, rgbToHex } from '../../config';
import { setConfig, useConfigValue } from '../../store';
import { ColorButton, ColorField, Note, Section, SelectField, SliderField, SwitchField } from '../fields';

const PAD_RANGE = 1;

function DirectionPad() {
  const [x, y] = useConfigValue('lightDirection');
  const color = useConfigValue('lightColor');
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

  const left = (x / PAD_RANGE + 1) * 50;
  const top = (1 - y / PAD_RANGE) * 50;
  return (
    <div
        ref={ref}
        className="direction-pad"
        title="Drag to move the key light"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
        onPointerMove={e => e.buttons && update(e)}
        onDoubleClick={() => setConfig({ lightDirection: [0, 0] })}
      >
        {/* Shadow cast by the light, pointing away from it. */}
        <div className="direction-pad-shadow" style={{ left: `${100 - left}%`, top: `${100 - top}%` }} />
        <div className="direction-pad-center" />
        <div
          className="direction-pad-handle"
          style={{ left: `${left}%`, top: `${top}%`, background: rgbToHex(color), boxShadow: `0 0 14px ${rgbToHex(color)}` }}
        />
    </div>
  );
}

function KeyLightInfo() {
  const [x, y] = useConfigValue('lightDirection');
  const color = useConfigValue('lightColor');
  const elevation = Math.round(90 - Math.atan(Math.hypot(x, y)) * 180 / Math.PI);
  const azimuth = Math.round((Math.atan2(x, y) * 180 / Math.PI + 360) % 360);
  return (
    <Stack gap={8} style={{ flex: 1, minWidth: 0 }}>
      <span className="subsection">Key light</span>
      <div className="readout">
        <span>Elevation</span><b>{elevation}°</b>
        <span>Azimuth</span><b>{Math.hypot(x, y) < 0.01 ? '–' : `${azimuth}°`}</b>
      </div>
      <ColorButton value={color} label="Key light color" onChange={rgb => setConfig({ lightColor: rgb })} />
      <span className="pad-caption">Drag the sun · double-click to center</span>
    </Stack>
  );
}

export function ScenePanel() {
  const showPlane = useConfigValue('showPlane');
  return (
    <Stack gap={12}>
      <Section title="Light" icon={<IconBulb size={15} />}>
        <Group gap={14} wrap="nowrap" align="flex-start" mb={4}>
          <DirectionPad />
          <KeyLightInfo />
        </Group>
        <SliderField name="lightIntensity" label="Key" min={0} max={8} step={0.1} />
        <SliderField name="lightSoftness" label="Key size" min={0.5} max={40} step={0.5}
          format={v => `${v}°`} hint="Angular size of the key light. Larger lights cast softer shadows." />
        <SliderField name="fillIntensity" label="Fill" min={0} max={3} step={0.05}
          hint="Large cool light from the opposite side that lifts the shadows." />
        <SliderField name="skyIntensity" label="Sky" min={0} max={3} step={0.05}
          hint="Broad overhead panel for soft top light." />
        <Note>All lights are analytic area lights; there is no environment map.</Note>
      </Section>

      <Section title="Paper" icon={<IconTexture size={15} />}>
        <SelectField
          name="paperTexture"
          label="Texture"
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

      <Section title="Ground" icon={<IconLayoutBoard size={15} />}>
        <SwitchField name="showPlane" label="Paper board"
          hint="Turn off to render only the shadows over the background color." />
        {showPlane
          ? (
            <>
              <ColorField name="planeColor" label="Board" />
              <SliderField name="planeGloss" label="Gloss" min={0} max={1} step={0.01}
                hint="Clear coat on the board, which reflects the light and the paper strips." />
              <SliderField name="planeRoughness" label="Gloss blur" min={0} max={0.6} step={0.01}
                hint="Lower values give a sharper, mirror-like reflection." />
            </>
          )
          : (
            <>
              <ColorField name="shadowColor" label="Shadow" />
              <SliderField name="shadowIntensity" label="Opacity" min={0} max={1} step={0.01} />
            </>
          )}
        <ColorField name="backgroundColor" label="Background" />
      </Section>
    </Stack>
  );
}
