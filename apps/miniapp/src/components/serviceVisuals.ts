import { ChatCircle, ChatCircleText, Drop, FileText, House, MapPin, Phone, UsersThree, WifiHigh, Wrench, Hammer } from '@phosphor-icons/react';
import type { ServiceIcon } from '../data/services.ts';
import type { IconComponent, TileColor } from './ui.tsx';

/**
 * Иконка и цвет каждого сервиса. Один сервис — один цвет на всех экранах:
 * на главной, в Сервисах и в пустых состояниях. Соседние в группе — разные.
 */
export const serviceVisuals: Record<ServiceIcon, { icon: IconComponent; color: TileColor }> = {
  'new-request': { icon: Wrench, color: 'coral' },
  requests: { icon: FileText, color: 'teal' },
  'house-state': { icon: House, color: 'green' },
  events: { icon: UsersThree, color: 'pink' },
  readings: { icon: Drop, color: 'blue' },
  contacts: { icon: Phone, color: 'blue' },
  places: { icon: MapPin, color: 'coral' },
  community: { icon: ChatCircle, color: 'pink' },
  'repair-mode': { icon: Hammer, color: 'coral' },
  internet: { icon: WifiHigh, color: 'green' },
  'management-questions': { icon: ChatCircleText, color: 'blue' },
};
