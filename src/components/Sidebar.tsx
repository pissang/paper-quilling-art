import { useState, type ComponentType } from 'react';
import { ActionIcon, Group, ScrollArea, Tooltip, UnstyledButton } from '@mantine/core';
import {
  IconAdjustmentsHorizontal, IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCube, IconLetterCase, IconRefresh
} from '@tabler/icons-react';
import { useConfig } from '../store';
import { DesignPanel } from './panels/DesignPanel';
import { MaskPanel } from './panels/MaskPanel';
import { ScenePanel } from './panels/ScenePanel';
import { RenderPanel } from './panels/RenderPanel';
import { RenderFooter } from './RenderFooter';

const TABS: { value: string; label: string; icon: ComponentType<{ size?: number; stroke?: number }>; panel: ComponentType }[] = [
  { value: 'design', label: 'Design', icon: IconBrush, panel: DesignPanel },
  { value: 'shape', label: 'Shape', icon: IconLetterCase, panel: MaskPanel },
  { value: 'scene', label: 'Scene', icon: IconCube, panel: ScenePanel },
  { value: 'render', label: 'Render', icon: IconAdjustmentsHorizontal, panel: RenderPanel }
];

function History() {
  const canUndo = useConfig(s => s.past.length > 0);
  const canRedo = useConfig(s => s.future.length > 0);
  const { undo, redo, reset } = useConfig.getState();
  return (
    <Group gap={2}>
      <Tooltip label="Undo (⌘Z)">
        <ActionIcon aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <IconArrowBackUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Redo (⇧⌘Z)">
        <ActionIcon aria-label="Redo" disabled={!canRedo} onClick={redo}>
          <IconArrowForwardUp size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Reset all settings">
        <ActionIcon aria-label="Reset all settings" onClick={reset}>
          <IconRefresh size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--mantine-color-clay-5)" />
      <path d="M16 8a8 8 0 1 0 8 8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M16 12a4 4 0 1 0 4 4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity=".75" />
      <circle cx="16" cy="16" r="1.4" fill="#fff" />
    </svg>
  );
}

export function Sidebar() {
  const [tab, setTab] = useState('design');
  const Panel = TABS.find(t => t.value === tab)!.panel;
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <Group gap={10} wrap="nowrap">
          <Logo />
          <div>
            <div className="app-title">Paper Quilling</div>
            <div className="app-subtitle">Path traced in your browser</div>
          </div>
        </Group>
        <History />
      </header>
      <nav className="tab-bar" role="tablist">
        {TABS.map(({ value, label, icon: Icon }) => (
          <UnstyledButton
            key={value}
            role="tab"
            aria-selected={tab === value}
            className="tab"
            data-active={tab === value || undefined}
            onClick={() => setTab(value)}
          >
            <Icon size={17} stroke={1.7} />
            <span>{label}</span>
          </UnstyledButton>
        ))}
      </nav>
      <ScrollArea className="sidebar-scroll" type="scroll" scrollbarSize={6} offsetScrollbars>
        <div className="sidebar-content" role="tabpanel">
          <Panel />
        </div>
      </ScrollArea>
      <RenderFooter />
    </aside>
  );
}
