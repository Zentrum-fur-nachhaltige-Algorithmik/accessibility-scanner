/**
 * Browser-injectable audio-track test for media elements.
 * Exposes __mediaAudioState and __isDecorativeBackgroundVideo. The criteria for
 * captions, audio description and auto-playing audio (1.2.2, 1.2.3, 1.2.5,
 * 1.4.2) all speak about media that carries audio, so a video without an audio
 * track is outside all of them.
 */

const injectableCode = `
  /**
   * 'audio' when the element has decoded audio bytes or exposes an audio track,
   * 'silent' when it has decoded video and no audio at all, 'unknown' when
   * nothing has been decoded (the file did not load, or playback never started).
   */
  function __mediaAudioState(el) {
    if (!el) return 'unknown';
    if (el.audioTracks && typeof el.audioTracks.length === 'number') {
      return el.audioTracks.length > 0 ? 'audio' : 'silent';
    }
    if (el.mozHasAudio === true) return 'audio';
    if (el.mozHasAudio === false && el.readyState >= 1) return 'silent';
    const audioBytes = el.webkitAudioDecodedByteCount;
    const videoBytes = el.webkitVideoDecodedByteCount;
    if (typeof audioBytes !== 'number') return 'unknown';
    if (audioBytes > 0) return 'audio';
    if (el.readyState >= 2 && typeof videoBytes === 'number' && videoBytes > 0) return 'silent';
    return 'unknown';
  }

  /**
   * A looping background decoration rather than a media presentation: the
   * author declared autoplay and loop and gave the user no controls. A browser
   * grants autoplay only to media it can start silently, so the declaration
   * alone identifies the pattern; reading the \`muted\` property instead makes
   * the answer depend on whether the page's own script has run yet.
   */
  function __isDecorativeBackgroundVideo(el) {
    if (!el) return false;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.hasAttribute('controls')) return false;
    return el.hasAttribute('autoplay') && el.hasAttribute('loop');
  }
`;

module.exports = { injectableCode };
