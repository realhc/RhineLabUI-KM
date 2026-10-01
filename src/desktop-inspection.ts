import { InspectionOverlay } from './inspection-overlay';
import type { DecryptionFrame } from './decryption';

/** A hidden overlay has no projection or DOM work; visible frames use the original renderer. */
export class DesktopInspectionOverlay extends InspectionOverlay {
  private hidden = false;
  skippedFrames = 0;
  override render(frame: DecryptionFrame, project: (x:number,y:number)=>number[], showLabel:boolean, enabled=true) {
    const visible = enabled && (frame.intervals.length > 0 || frame.markers > 0 || frame.point > 0 || (showLabel && frame.label > 0));
    if (!visible) {
      this.skippedFrames++;
      if (!this.hidden) {
        document.querySelector<SVGSVGElement>('#inspection-marks')!.style.opacity = '0';
        document.querySelector<HTMLElement>('#inspection-text')!.style.opacity = '0';
        this.hidden = true;
      }
      return;
    }
    this.hidden = false;
    super.render(frame, project, showLabel, enabled);
  }
}
