// Плитки Видов мест: один значок и цвет на Вид — в списке, на экране Вида и в форме.
import {
  Baby,
  Bandaids,
  BatteryWarning,
  Bank,
  Buildings,
  Certificate,
  GraduationCap,
  Heart,
  Hospital,
  IdentificationCard,
  MapPin,
  PawPrint,
  Pill,
  Receipt,
  Scales,
  ShieldCheck,
  Stethoscope,
  Users,
  CheckSquare,
} from '@phosphor-icons/react';
import type { AssignedPlaceKind, NearestPlaceKind } from '@maxtown/shared';
import type { IconComponent, TileColor } from './ui.tsx';

type PlaceVisual = { icon: IconComponent; tone: 'neutral' | TileColor };

export const assignedVisuals: Record<AssignedPlaceKind, PlaceVisual> = {
  'adult-clinic': { icon: Stethoscope, tone: 'pink' },
  'children-clinic': { icon: Baby, tone: 'pink' },
  'womens-clinic': { icon: Heart, tone: 'pink' },
  school: { icon: GraduationCap, tone: 'coral' },
  kindergarten: { icon: Baby, tone: 'coral' },
  'polling-station': { icon: CheckSquare, tone: 'blue' },
  magistrate: { icon: Scales, tone: 'blue' },
  'police-precinct': { icon: ShieldCheck, tone: 'teal' },
  'military-office': { icon: IdentificationCard, tone: 'teal' },
  other: { icon: MapPin, tone: 'neutral' },
};

export const nearestVisuals: Record<NearestPlaceKind, PlaceVisual> = {
  trauma: { icon: Bandaids, tone: 'coral' },
  'emergency-room': { icon: Hospital, tone: 'coral' },
  'pharmacy-24': { icon: Pill, tone: 'green' },
  'vet-24': { icon: PawPrint, tone: 'green' },
  mfc: { icon: Buildings, tone: 'blue' },
  'social-services': { icon: Users, tone: 'blue' },
  'social-fund': { icon: Bank, tone: 'blue' },
  tax: { icon: Receipt, tone: 'blue' },
  'registry-office': { icon: Certificate, tone: 'teal' },
  batteries: { icon: BatteryWarning, tone: 'teal' },
};
