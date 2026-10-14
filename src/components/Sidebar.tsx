import { useState } from 'react';
import { ActionIcon, Group, ScrollArea, Tabs, Title, Tooltip } from '@mantine/core';
import { IconArrowBackUp, IconArrowForwardUp, IconRefresh } from '@tabler/icons-react';
import { useConfig } from '../store';
import { DesignPanel } from './panels/DesignPanel';
import { MaskPanel } from './panels/MaskPanel';
import { ScenePanel } from './panels/ScenePanel';
import { RenderPanel } from './panels/RenderPanel';
import { RenderFooter } from './RenderFooter';

const TABS = [
  { value: 'design', label: 'Design', panel: DesignPanel },
  { value: 'shape', label: 'Shape', panel: MaskPanel },
  { value: 'scene', label: 'Scene', panel: ScenePanel },
  { value: 'render', label: 'Render', panel: RenderPanel }
];

function History() {
  const canUndo = useConfig(s => s.past.length > 0);
  const canRedo = useConfig(s => s.future.length > 0);
  const { undo, redo, reset } = useConfig.getState();
  return (
    <Group gap={2}>
      <Tooltip label="Undo (⌘Z)">
        <ActionIcon variant="subtle" color="gray" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <IconArrowBackUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Redo (⇧⌘Z)">
        <ActionIcon variant="subtle" color="gray" aria-label="Redo" disabled={!canRedo} onClick={redo}>
          <IconArrowForwardUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Reset all settings">
        <ActionIcon variant="subtle" color="gray" aria-label="Reset all settings" onClick={reset}>
          <IconRefresh size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function Sidebar() {
  const [tab, setTab] = useState<string | null>('design');
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Group justify="space-between">
          <Title order={5} fw={600}>Paper Quilling</Title>
          <History />
        </Group>
      </div>
      <Tabs value={tab} onChange={setTab} className="sidebar-tabs" keepMounted={false}>
        <Tabs.List grow px={8}>
          {TABS.map(t => <Tabs.Tab key={t.value} value={t.value}>{t.label}</Tabs.Tab>)}
        </Tabs.List>
        <ScrollArea className="sidebar-scroll" type="hover" scrollbarSize={6}>
          {TABS.map(({ value, panel: Panel }) => (
            <Tabs.Panel key={value} value={value} p={16}>
              <Panel />
            </Tabs.Panel>
          ))}
        </ScrollArea>
      </Tabs>
      <RenderFooter />
    </aside>
  );
}
