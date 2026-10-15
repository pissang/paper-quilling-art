import { Button, SimpleGrid, Stack, Tooltip } from '@mantine/core';
import { IconDice5, IconLayersSubtract, IconLine, IconPalette, IconSpiral, IconTornado, IconWaveSine } from '@tabler/icons-react';
import { STYLES, type Config } from '../../config';
import { setConfig, useConfig } from '../../store';
import { ColorField, Note, Section, SliderField, SwitchField } from '../fields';

function StylePicker() {
  // A style is active while every one of its settings is unchanged.
  const active = useConfig(state => STYLES.findIndex(style =>
    (Object.keys(style.settings) as (keyof Config)[]).every(key => state.config[key] === style.settings[key])));
  return (
    <SimpleGrid cols={2} spacing={6}>
      {STYLES.map((style, idx) => (
        <Tooltip key={style.name} label={style.description} multiline w={220}>
          <Button
            size="xs"
            variant={idx === active ? 'filled' : 'light'}
            onClick={() => setConfig(style.settings)}
          >
            {style.name}
          </Button>
        </Tooltip>
      ))}
    </SimpleGrid>
  );
}

export function DesignPanel() {
  return (
    <Stack gap={12}>
      <Section title="Style" icon={<IconPalette size={15} />}>
        <StylePicker />
        <Note>Each style sets the options below; tune any of them afterwards.</Note>
      </Section>

      <Section
        title="Pieces"
        icon={<IconWaveSine size={15} />}
        right={
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconDice5 size={14} />}
            onClick={() => setConfig({ seed: Math.random() })}
          >
            Shuffle
          </Button>
        }
      >
        <SliderField name="elementSize" label="Size" min={0.3} max={2.5} step={0.05}
          hint="Half length of the largest pieces. Smaller pieces fill the gaps down to the minimum size." />
        <SliderField name="minElementSize" label="Min size" min={0.1} max={1} step={0.01} />
        <SliderField name="flowers" label="Flowers" min={0} max={1} step={0.05}
          hint="Share of the largest spots that become flowers of petals around a tight coil." />
        <SliderField name="gap" label="Gap" min={0} max={0.3} step={0.005} />
        <SliderField name="coilTurns" label="Coil turns" min={2} max={16} step={1}
          hint="Turns of paper in each loose coil. Fewer turns give open, airy coils." />
        <SliderField name="coilEccentricity" label="Off-centre eye" min={0} max={1} step={0.05}
          hint="How far the tight eye of a released coil drifts from its centre." />
        <SliderField name="tipPull" label="Tip pull" min={0} max={4} step={0.1}
          hint="How strongly pinching drags the inner turns towards the tip of a teardrop or leaf." />
        <SliderField name="thickness" label="Paper thickness" min={0.005} max={0.03} step={0.001} />
        <SliderField name="stripHeight" label="Strip width" min={0.1} max={1.5} step={0.01}
          hint="How tall the paper stands on the board." />
        <SliderField name="heightVariation" label="Height variation" min={0} max={1.5} step={0.01}
          hint="How much the color regions and pieces differ in height. Flowers always stand a little prouder." />
        <SliderField name="heightJitter" label="Piece height play" min={0} max={1.5} step={0.05}
          hint="How much single pieces stray from their region's height." />
        <SliderField name="imperfection" label="Handmade" min={0} max={1} step={0.05}
          hint="How irregular the strips are: slight lean and uneven height, like hand glued paper." />
        <SwitchField name="paperVisible" label="Show paper" />
      </Section>

      <Section title="Swirls" icon={<IconTornado size={15} />}>
        <SliderField name="swirls" label="Amount" min={0} max={1} step={0.05}
          hint="Share of each color region given to big open swirls of several strips. 0 turns them off." />
        <SliderField name="swirlStrips" label="Strips" min={1} max={10} step={1}
          hint="Strips rolled together in each swirl, shaded from the region's color and its neighbours." />
        <SliderField name="swirlSize" label="Size" min={1} max={4} step={0.1}
          hint="Largest swirl radius relative to the largest piece." />
        <SliderField name="swirlTightness" label="Curl" min={0.25} max={0.75} step={0.01}
          hint="How much each turn of a swirl shrinks. Lower values give open, wave-like curls with an off-centre eye." />
        <SwitchField name="coilFillers" label="Coils between"
          hint="Fill the space left between swirls with small coils only, no teardrops, leaves or flowers." />
      </Section>

      <Section title="Base card" icon={<IconLayersSubtract size={15} />}>
        <SwitchField name="baseCard" label="Card under regions"
          hint="Glue each color region onto card cut to its shape, so gaps show color instead of the board." />
        <SliderField name="cardTone" label="Card shade" min={-0.6} max={0.6} step={0.02}
          hint="Card color relative to the paper: negative is darker, positive lighter." />
      </Section>

      <Section title="Contours" icon={<IconLine size={15} />}>
        <SliderField name="contourLines" label="Outline strips" min={0} max={20} step={1}
          hint="Strips running along the edge of every color region, including its outline. High values fill regions with contour lines." />
        <SliderField name="contourSpacing" label="Spacing" min={0.03} max={0.3} step={0.005} />
        <SwitchField name="shadedContours" label="Shaded bundle"
          hint="Outline strips take the region's color and its nearest shades, dark to light." />
        <SliderField name="lineFill" label="Line fill" min={0.01} max={1} step={0.01}
          hint="Regions larger than this share of the subject, like a face, are filled with flowing strips instead of pieces. 1 turns it off." />
        <SliderField name="flowSmoothing" label="Edge follow" min={2} max={60} step={1}
          hint="How far in from the edge the flowing strips bend with it. Further in they run straight along the region's long axis." />
      </Section>

      <Section title="Cream paper" icon={<IconSpiral size={15} />}>
        <SliderField name="ornaments" label="Band" min={0} max={6} step={0.1}
          hint="Width of the band of cream scrolls around the subject. 0 turns them off." />
        <SliderField name="silhouette" label="Outline height" min={0} max={2.5} step={0.05}
          hint="Height of the cream strip around the whole subject, relative to the other strips. 0 hides it." />
        <ColorField name="ornamentColor" label="Color" />
      </Section>
    </Stack>
  );
}
