import { MenuItem } from './ControlPanelTypes';
import { CinematicPanel } from './panels/CinematicPanel';
import { SettingsPanel } from './panels/SettingsPanel';
import { ToplistPanel } from './panels/toplist/ToplistPanel';
import { RadioPanel } from './panels/radio/RadioPanel';
import { TimeTrialPanel } from '../racing/TimeTrialPanel';
import { TheaterPanel } from './panels/theater/TheaterPanel';
import { QuestsPanel } from '../quests/UI/QuestsPanel';

export const MENU_ITEMS: () => MenuItem[] = () => [
  {
    id: 'quests',
    emoji: '📜',
    label: 'Quests',
    panel: QuestsPanel
  },
  {
    id: 'time-trial',
    emoji: '🏁',
    label: 'Racing',
    panel: TimeTrialPanel
  },
  {
    id: 'toplist',
    emoji: '🏆',
    label: 'Toplist',
    panel: ToplistPanel
  },
  ...(window.isSmallScreen ? [] : [
    {
      id: 'theater',
      emoji: '🎬',
      label: 'Theater',
      panel: TheaterPanel
    },
    {
      id: 'cinematic',
      emoji: '🎥',
      label: 'Cinematic',
      panel: CinematicPanel
    },
  ]),
  {
    id: 'radio',
    emoji: '📻',
    label: 'Radio',
    panel: RadioPanel
  },
  {
    id: 'settings',
    emoji: '⚙️',
    label: 'Settings',
    panel: SettingsPanel
  },
]; 