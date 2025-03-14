import { StorageSpec } from 'react-cosmos-shared2/ui';
import { RootContext } from './shared';

const NAV_WIDTH_STORAGE_KEY = 'navWidth';
const NAV_WIDTH_DEFAULT = 320;

const NAV_WIDTH_MIN = 224;
const NAV_WIDTH_MAX = 512;

export function getNavWidthApi({ getMethodsOf }: RootContext) {
  const storage = getMethodsOf<StorageSpec>('storage');
  return {
    navWidth:
      storage.getItem<number>(NAV_WIDTH_STORAGE_KEY) || NAV_WIDTH_DEFAULT,
    setNavWidth: (newWidth: number) =>
      storage.setItem(NAV_WIDTH_STORAGE_KEY, restrictNavWidth(newWidth)),
  };
}

function restrictNavWidth(navWidth: number) {
  return Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, navWidth));
}
