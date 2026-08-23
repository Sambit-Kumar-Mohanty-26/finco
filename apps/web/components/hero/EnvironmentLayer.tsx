/**
 * The environment the camera moves through.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE OPTION B SWAP POINT.
 *
 *  Today this is drawn in CSS/SVG. To upgrade to the scrubbed-video hero,
 *  replace the body of this component with:
 *
 *      <video ref={...} muted playsInline preload="auto"
 *             className="absolute inset-0 h-full w-full object-cover">
 *        <source src="/videos/hero-scrub-lg.mp4" media="(min-width: 64rem)" />
 *        <source src="/videos/hero-scrub-md.mp4" media="(min-width: 40rem)" />
 *        <source src="/videos/hero-scrub-sm.mp4" />
 *      </video>
 *
 *  and set `video.currentTime = progress * video.duration` from the same
 *  `progress` prop below. Nothing else changes: not the track, not the sticky
 *  pin, not the scroll maths, not the product DOM, not the fullscreen handoff,
 *  not the mobile strategy. The product UI must stay live DOM either way —
 *  Mercury bakes its dashboard into the video and ends on a frozen image; ours
 *  keeps executing.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `progress` is 0 at the top of the pin and 1 when the product fills the
 * viewport. It is passed for parity with the video implementation; the CSS
 * version reads `--hero-p` directly so it costs no React re-render.
 */
export function EnvironmentLayer({ progress }: { progress?: number }) {
  void progress; // the CSS version is driven by --hero-p; the video version will use this
  return (
    <div className="hero-env" aria-hidden="true">
      {/* the room: a warm floor plane receding to a horizon */}
      <div className="hero-env-floor" />
      {/* two soft light sources, the same aurora vocabulary as the rest of the page */}
      <div className="hero-env-glow hero-env-glow-a" />
      <div className="hero-env-glow hero-env-glow-b" />
      {/* ruled ledger paper, the surface the product sits on */}
      <div className="hero-env-rules" />
    </div>
  );
}
