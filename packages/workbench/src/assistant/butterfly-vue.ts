import { inject, onBeforeUnmount, provide, type InjectionKey, type ObjectDirective } from 'vue';
import { createButterflyController, type ButterflyController, type ButterflyRegistration, type ButterflyTarget } from './butterfly';

const butterflyKey: InjectionKey<ButterflyController> = Symbol('tano-butterfly');
export function provideButterflyController() {
  const controller = createButterflyController();
  provide(butterflyKey, controller);
  onBeforeUnmount(controller.dispose);
  return controller;
}
export const useButterflyController = () => inject(butterflyKey, undefined);
export type ButterflyPerch = Omit<ButterflyTarget, 'element'>;
/** Add to any native element. Registration lifetime follows the element, not a global selector. */
export function butterflyPerchDirective(controller: ButterflyController | undefined): ObjectDirective<HTMLElement, ButterflyPerch | undefined> {
  const registrations = new WeakMap<HTMLElement, { id: string; handle: ButterflyRegistration }>();
  function sync(element: HTMLElement, value: ButterflyPerch | undefined) {
    const previous = registrations.get(element);
    if (previous && previous.id !== value?.id) { previous.handle.dispose(); registrations.delete(element); }
    if (!value || !controller) return;
    const target = { ...value, element: () => element };
    const current = registrations.get(element);
    if (current) current.handle.update(target);
    else registrations.set(element, { id: value.id, handle: controller.registerTarget(target) });
  }
  return {
    mounted: (element, binding) => sync(element, binding.value),
    updated: (element, binding) => { if (binding.value !== binding.oldValue) sync(element, binding.value); },
    unmounted: element => { registrations.get(element)?.handle.dispose(); registrations.delete(element); },
  };
}
