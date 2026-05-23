declare module "vanta/dist/vanta.net.min" {
  import type * as THREE from "three";

  type VantaNetOptions = {
    THREE: typeof THREE;
    el: HTMLElement;
    mouseControls?: boolean;
    touchControls?: boolean;
    gyroControls?: boolean;
    minHeight?: number;
    minWidth?: number;
    scale?: number;
    scaleMobile?: number;
    color?: number;
    backgroundColor?: number;
    maxDistance?: number;
    spacing?: number;
    backgroundAlpha?: number;
    showDots?: boolean;
    points?: number;
  };

  type VantaEffect = {
    destroy: () => void;
  };

  export default function VANTA_NET(options: VantaNetOptions): VantaEffect;
}
