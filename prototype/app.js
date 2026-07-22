(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const title = $('#screen-title');
  const eyebrow = $('#screen-eyebrow');
  const toast = $('#toast');
  let toastTimer;

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function playNotificationPreview() {
    const AudioContext = window.AudioContext;
    if (!AudioContext) {
      notify('Audio preview is unavailable in this browser.');
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
    gain.connect(context.destination);
    [523.25, 659.25].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(context.currentTime + index * 0.12);
      oscillator.stop(context.currentTime + 0.45 + index * 0.12);
    });
    setTimeout(() => context.close(), 800);
    notify('Completion sound preview · local prototype only.');
  }

  function showScreen(name, updateHash = true) {
    const next = $(`[data-screen="${name}"]`);
    if (!next) return;
    $$('.screen').forEach((screen) => screen.classList.toggle('active', screen === next));
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screenTarget === name));
    title.textContent = next.dataset.title || 'HUE';
    eyebrow.textContent = next.dataset.eyebrow || 'HUE';
    if (updateHash) history.replaceState(null, '', `#${name}`);
    $('#main-content').scrollTo({ top: 0, behavior: 'smooth' });
    $$('.project-popover').forEach((popover) => popover.hidden = true);
    $$('dialog[open]').forEach((dialog) => dialog.close());
    document.title = `${title.textContent} · HUE prototype`;
  }

  $$('[data-screen-target]').forEach((button) => {
    button.addEventListener('click', () => showScreen(button.dataset.screenTarget));
  });

  function action(name) {
    const projectPopover = $('#project-popover');
    const workerDialog = $('#worker-dialog');
    const commandDialog = $('#command-dialog');
    const messages = {
      'open-settings': 'Settings are specified in screen S08 · product implementation TBI.',
      'mock-send': 'Prototype only — no message or task was sent.',
      'steer': 'Steering would be queued at the worker’s next safe boundary.',
      'pause': 'Pause requested in prototype. Durable pause semantics are TBI.',
      'cancel': 'Cancel would require an effect check before claiming the run stopped safely.',
      'show-replan': 'Plan revised after the first viewport test exposed an accessibility dependency.',
      'reject-approval': 'Mock approval rejected. No files or policies were changed.',
      'approve': 'Mock approval granted once. No real capability was issued.',
      'open-notification-settings': 'Notification policy: channels, privacy, sounds, quiet hours, grouping and retention · TBI.',
      'mock-mark-read': 'Mock notification marked read. The underlying semantic event remains durable.',
      'open-settings': 'Settings screen behavior is documented and TBI.',
    };
    if (name === 'project-menu') {
      projectPopover.hidden = !projectPopover.hidden;
      return;
    }
    if (name === 'toggle-density') {
      document.body.classList.toggle('compact');
      notify(document.body.classList.contains('compact') ? 'Compact density on' : 'Comfortable density on');
      return;
    }
    if (name === 'test-sound') {
      playNotificationPreview();
      return;
    }
    if (name === 'worker-detail') {
      workerDialog.showModal();
      return;
    }
    if (name === 'command') {
      commandDialog.showModal();
      setTimeout(() => $('input', commandDialog)?.focus(), 10);
      return;
    }
    if (name === 'close-dialog') {
      $$('dialog[open]').forEach((dialog) => dialog.close());
      return;
    }
    if (name === 'review-approval') {
      showScreen('approvals');
      return;
    }
    if (name === 'open-doc') {
      window.location.href = '../docs/05-system-architecture.md';
      return;
    }
    if (name === 'open-roadmap') {
      window.location.href = '../roadmap/ISSUES.md';
      return;
    }
    notify(messages[name] || 'Prototype interaction · product behavior TBI.');
  }

  $$('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action)));

  document.addEventListener('click', (event) => {
    const popover = $('#project-popover');
    if (!popover.hidden && !popover.contains(event.target) && !event.target.closest('[data-action="project-menu"]')) popover.hidden = true;
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      action('command');
    }
    if (event.key === 'Escape') $('#project-popover').hidden = true;
  });

  const initial = location.hash.slice(1);
  showScreen($(`[data-screen="${initial}"]`) ? initial : 'home', false);
})();
