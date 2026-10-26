/* Decorative supplied video. This module stays independent of the atlas. */
const video = document.getElementById('heroVideo');
const hero = video?.closest('.hero-video-header');
const playButton = document.getElementById('heroPlayPause');
const muteButton = document.getElementById('heroMute');
const status = document.getElementById('heroVideoStatus');
if (video && hero && playButton && muteButton) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false, explicitPlay = false, playInFlight = false, playQueued = false, failed = false;
  const rect = hero.getBoundingClientRect();
  let visible = rect.bottom > 0 && rect.top < window.innerHeight;
  video.muted = true;
  function wantsPlayback() { return !userPaused && (!motion.matches || explicitPlay); }
  function canPlay() { return wantsPlayback() && visible && !document.hidden && !failed; }
  function update() {
    const playing = !video.paused && !video.ended;
    playButton.querySelector('.video-control-icon').textContent = playing ? 'Ⅱ' : '▶';
    playButton.querySelector('.video-control-label').textContent = playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} header video`);
    muteButton.querySelector('.video-control-label').textContent = video.muted ? 'Unmute' : 'Mute';
    muteButton.setAttribute('aria-label', `${video.muted ? 'Unmute' : 'Mute'} header video`);
    muteButton.classList.toggle('is-muted', video.muted);
    hero.classList.toggle('is-poster', failed || (motion.matches && !explicitPlay));
  }
  function message(text = '') {
    if (status) { status.textContent = text; status.hidden = !text; }
  }
  async function syncPlayback() {
    if (!canPlay()) { video.pause(); update(); return; }
    if (playInFlight) { playQueued = true; update(); return; }
    if (!video.paused) { update(); return; }
    playInFlight = true;
    try {
      await video.play();
      if (!canPlay()) video.pause();
      else message();
    } catch (error) {
      if (canPlay() && error.name !== 'AbortError') message('Select Play to start the film.');
    } finally {
      playInFlight = false; update();
      if (playQueued) { playQueued = false; syncPlayback(); }
    }
  }
  playButton.addEventListener('click', () => {
    if (!video.paused) { userPaused = true; video.pause(); update(); }
    else { userPaused = false; explicitPlay = true; failed = false; syncPlayback(); }
  });
  muteButton.addEventListener('click', () => { video.muted = !video.muted; update(); });
  for (const event of ['play', 'pause', 'ended', 'volumechange']) video.addEventListener(event, update);
  video.addEventListener('error', () => { failed = true; video.pause(); update(); message('The film is unavailable. Explore the interactive atlas below.'); });
  document.addEventListener('visibilitychange', syncPlayback);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      syncPlayback();
    }, { threshold: 0.04 }).observe(hero);
  }
  const motionChanged = () => { update(); syncPlayback(); };
  if (motion.addEventListener) motion.addEventListener('change', motionChanged);
  else motion.addListener(motionChanged);
  if (motion.matches) { video.autoplay = false; video.pause(); }
  update(); syncPlayback();
}
