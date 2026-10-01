import { createMotionPreferences, type MotionKey } from "./motion-preferences";

const ease = "cubic-bezier(.22,1,.36,1)";

/** Owns the dialog lifetime; motion changes presentation, never document state. */
export function mountLibraryMotion(overlay: HTMLDialogElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let animations: Animation[] = [];
  let content: Animation[] = [];
  let revision = 0;
  let pending: ((finished: boolean) => void) | undefined;
  let storedValue: string | null | undefined;
  let preferences = createMotionPreferences(undefined, false);
  const enabled = (key: MotionKey) => {
    if (reduced.matches) return false;
    const latest = localStorage.getItem("rhine-settings");
    if (latest !== storedValue) {
      storedValue = latest;
      let settings: {
        motion?: Parameters<typeof createMotionPreferences>[0];
        reduced?: boolean;
      } = {};
      try {
        settings = JSON.parse(latest || "{}");
      } catch {}
      preferences = createMotionPreferences(settings.motion, settings.reduced);
    }
    return preferences[key];
  };
  const sync = () => {
    overlay.dataset.surfaceMotion = enabled("surfaceTransitions")
      ? "on"
      : "off";
    overlay.dataset.breathe =
      enabled("idleWave") && !document.hidden ? "on" : "off";
    if (!enabled("surfaceTransitions"))
      animations.forEach((animation) => animation.finish());
    if (!enabled("documentReveal"))
      content.forEach((animation) => animation.finish());
  };
  reduced.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("rhine-motion-preferences", sync);
  overlay.dataset.motionState = "closed";
  const cancelContent = () => {
    content.forEach((animation) => animation.cancel());
    content = [];
  };
  const transition = (show: boolean): Promise<boolean> => {
    const token = ++revision;
    const wasClosed = !overlay.open;
    // Sample before cancelling so reversing a transition continues from its visible state.
    const surfaces = [
      overlay.querySelector<HTMLElement>("aside")!,
      overlay.querySelector<HTMLElement>(".library-controls")!,
      overlay.querySelector<HTMLElement>("main")!,
    ];
    const current = surfaces.map((element) => ({
      opacity: getComputedStyle(element).opacity,
      transform: getComputedStyle(element).transform,
    }));
    animations.forEach((animation) => animation.cancel());
    animations = [];
    cancelContent();
    pending?.(false);
    pending = undefined;
    sync();
    if (wasClosed && show) {
      overlay.dataset.motionState = "closed";
      overlay.showModal();
      // Establish the backdrop's initial opacity without animating its costly blur filter.
      void getComputedStyle(overlay, "::backdrop").opacity;
    }
    overlay.inert = !show;
    overlay.dataset.motionState = show ? "opening" : "closing";
    return new Promise((resolve) => {
      pending = resolve;
      const complete = () => {
        if (token !== revision) return;
        animations.forEach((animation) => animation.cancel());
        animations = [];
        if (!show) overlay.close();
        overlay.inert = false;
        overlay.dataset.motionState = show ? "open" : "closed";
        pending = undefined;
        resolve(true);
      };
      if (!enabled("surfaceTransitions") || (!show && wasClosed)) {
        complete();
        return;
      }
      surfaces.forEach((element, index) => {
        // The directory only fades: its spine stays attached to every tick and viewport edge.
        const offset =
          index === 0
            ? "none"
            : `translateY(${show ? (index === 1 ? -8 : 18) : 6}px)`;
        animations.push(
          element.animate(
            [
              {
                opacity: wasClosed ? 0 : current[index].opacity,
                transform: wasClosed ? offset : current[index].transform,
              },
              { opacity: show ? 1 : 0, transform: show ? "none" : offset },
            ],
            {
              duration: show ? (index === 2 ? 440 : 360) : 200,
              delay: show && wasClosed ? [30, 60, 100][index] : 0,
              easing: ease,
              fill: "both",
            },
          ),
        );
      });
      void Promise.all(animations.map((animation) => animation.finished))
        .then(complete)
        .catch(() => {});
    });
  };
  const revealDocument = () => {
    cancelContent();
    if (overlay.dataset.motionState !== "open" || !enabled("documentReveal"))
      return;
    for (const element of [
      overlay.querySelector<HTMLElement>("#preview"),
      overlay.querySelector<HTMLElement>(".document-heading"),
    ]) {
      if (!element) continue;
      const animation = element.animate([{ opacity: 0.35 }, { opacity: 1 }], {
        duration: 220,
        easing: ease,
      });
      content.push(animation);
      void animation.finished
        .finally(() => {
          content = content.filter((item) => item !== animation);
        })
        .catch(() => {});
    }
  };
  sync();
  return {
    show: () => transition(true),
    hide: () => transition(false),
    revealDocument,
    enabled,
  };
}
