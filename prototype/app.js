(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const title = $('#screen-title');
  const eyebrow = $('#screen-eyebrow');
  const toast = $('#toast');
  const sessionList = $('#session-list');
  const sessionSearch = $('#session-search-input');
  let toastTimer;
  let activeSpaceId = 'hue';

  const spaces = {
    hue: {
      name: 'HUE',
      kind: 'Project',
      glyph: 'H',
      glyphClass: 'hue-space',
      overviewScreen: 'architecture',
      description: 'Product direction, design and implementation work.',
      sessions: [
        {
          id: 'hue-shell',
          group: 'Active now',
          title: 'Three-pane workspace shell',
          subtitle: 'Design direction · prototype',
          type: 'Design',
          status: 'running',
          time: 'now',
          user: 'Keep every project visible in a collapsible sidebar, show that project’s Sessions in the next column, and keep the main work window to the right.',
          assistant: 'The workspace now keeps the hierarchy visible: select a Space on the left, inspect its independent Sessions and status in the middle, then work in the selected Session on the right. Collapsing the Space rail preserves direct access through recognizable project identities.'
        },
        {
          id: 'hue-components',
          group: 'Active now',
          title: 'Svelte component foundation',
          subtitle: 'Implementation ready · HUE-054',
          type: 'Task',
          status: 'waiting',
          time: '8m',
          user: 'Prepare the HUE-owned Svelte component foundation without copying stock shadcn styling.',
          assistant: 'The accepted boundary is SvelteKit plus shadcn-svelte primitives behind HUE wrappers. The next implementation starts with tokens, the Space rail and Session sidebar, while application packaging stays separate.'
        },
        {
          id: 'hue-notifications',
          group: 'Active now',
          title: 'Notification delivery contract',
          subtitle: 'Review · verified evidence',
          type: 'Review',
          status: 'review',
          time: '1h',
          user: 'Review how completion alerts, sounds and phone delivery preserve privacy and evidence.',
          assistant: 'Task outcomes, notification lifecycle and delivery evidence remain separate. External channels receive redacted payloads and the in-app record remains canonical.'
        },
        {
          id: 'hue-architecture',
          group: 'Earlier',
          title: 'Control-plane architecture',
          subtitle: 'Discussion · three open decisions',
          type: 'Discussion',
          status: 'quiet',
          time: 'Mon',
          user: 'Compare the remaining application packaging and control-plane options.',
          assistant: 'The frontend is fixed, but Tauri, browser-plus-daemon and reuse boundaries remain evidence-driven packaging decisions.'
        }
      ]
    },
    notidian: {
      name: 'Notidian',
      kind: 'Project',
      glyph: 'N',
      glyphClass: 'notidian-space',
      overviewScreen: 'project',
      description: 'Local-first personal knowledge workspace.',
      sessions: [
        {
          id: 'notidian-sync',
          group: 'Active now',
          title: 'Sync reliability',
          subtitle: 'Developer working · reviewer waiting',
          type: 'Execution',
          status: 'running',
          time: 'now',
          user: 'Continue working on sync reliability in Notidian.',
          assistant: 'I loaded only the Notidian context pack, linked issue and existing worktree. The current blocker is an unverified conflict-retry path; no unrelated Space context was loaded.'
        },
        {
          id: 'notidian-mobile',
          group: 'Active now',
          title: 'Mobile navigation',
          subtitle: 'Approval required · 4 files',
          type: 'Task',
          status: 'waiting',
          time: '2m',
          user: 'Fix the mobile navigation while preserving direct project access.',
          assistant: 'The implementation is isolated in a worktree and is waiting for one reversible local-write approval before responsive verification can continue.'
        },
        {
          id: 'notidian-onboarding',
          group: 'Earlier',
          title: 'Onboarding implementation',
          subtitle: 'Review · repository evidence',
          type: 'Review',
          status: 'review',
          time: 'Fri',
          user: 'Review the onboarding implementation against the accepted product flow.',
          assistant: 'The review is linked to the current diff, screenshots and quality-gate output rather than a worker self-report.'
        },
        {
          id: 'notidian-direction',
          group: 'Earlier',
          title: 'Product direction',
          subtitle: 'Maintained summary available',
          type: 'Discussion',
          status: 'quiet',
          time: 'Jul 18',
          user: 'Summarize the durable Notidian product direction.',
          assistant: 'Notidian remains local-first, user-owned and portable. The maintained summary links back to decisions and source conversations.'
        }
      ]
    },
    valorlist: {
      name: 'Valorlist',
      kind: 'Project',
      glyph: 'V',
      glyphClass: 'valorlist-space',
      overviewScreen: 'project',
      description: 'Independent long-only systematic-trading research.',
      sessions: [
        { id: 'valorlist-replay', group: 'Current', title: 'Canonical replay', subtitle: 'Paper replication · preserved', type: 'Research', status: 'running', time: '18m', user: 'Continue the canonical replay without adapting the hypothesis.', assistant: 'The exact paper replication remains isolated from adaptation. Candidate-gate failures are preserved as evidence rather than treated as automatic rejection.' },
        { id: 'valorlist-costs', group: 'Current', title: 'After-cost validation', subtitle: 'Waiting for evidence', type: 'Review', status: 'waiting', time: '2h', user: 'Check whether the result survives the true after-cost assumptions.', assistant: 'The result remains inconclusive until the canonical replay and cost model both pass independently.' },
        { id: 'valorlist-universe', group: 'Earlier', title: 'Liquid universe selection', subtitle: '30–50 pairs · accepted', type: 'Decision', status: 'verified', time: 'Tue', user: 'Record the accepted universe constraints.', assistant: 'The durable decision keeps the universe liquid, long-only and spot/cash while execution remains on the one-minute surface.' }
      ]
    },
    supertaal: {
      name: 'Supertaal',
      kind: 'Project',
      glyph: 'S',
      glyphClass: 'supertaal-space',
      overviewScreen: 'project',
      description: 'Language-learning corpus and practice product.',
      sessions: [
        { id: 'supertaal-corpus', group: 'Current', title: 'Vocabulary corpus schema', subtitle: 'Verified · 4 evidence items', type: 'Outcome', status: 'verified', time: '1d', user: 'Confirm the vocabulary corpus publication shape.', assistant: 'Each language publishes one JSON vocabulary file with stable concept IDs and at least one practice example per word.' },
        { id: 'supertaal-progress', group: 'Current', title: 'Durable learner progress', subtitle: 'Data-model discussion', type: 'Discussion', status: 'quiet', time: 'Mon', user: 'Keep learner progress durable if vocabulary content is republished.', assistant: 'Progress binds to stable concept IDs rather than file positions, while PocketBase remains responsible for users, progress and administration.' }
      ]
    },
    health: {
      name: 'Health',
      kind: 'Area',
      glyph: '♥',
      glyphClass: 'health-space',
      overviewScreen: 'area',
      description: 'Ongoing goals, routines, observations and evidence.',
      sessions: [
        { id: 'health-hunger', group: 'Needs review', title: 'Afternoon hunger review', subtitle: 'Observation · 3 of 5 days', type: 'Review', status: 'waiting', time: 'today', user: 'Review the afternoon hunger pattern without turning inference into fact.', assistant: 'The observation is preserved separately from possible explanations. Meal composition and timing remain research questions until evidence changes their status.' },
        { id: 'health-routine', group: 'Current', title: 'Running + strength routine', subtitle: 'Ongoing · no blocker', type: 'Check-in', status: 'quiet', time: 'Sun', user: 'Review the current running and strength routine.', assistant: 'The routine remains current and user-maintained; this Session does not import repository or trading context.' }
      ]
    },
    parenting: {
      name: 'Parenting',
      kind: 'Area',
      glyph: 'P',
      glyphClass: 'parenting-space',
      overviewScreen: 'area',
      description: 'Ongoing family context, decisions and follow-ups.',
      sessions: [
        { id: 'parenting-week', group: 'Current', title: 'Weekly family review', subtitle: 'Check-in · quiet', type: 'Check-in', status: 'quiet', time: 'Sun', user: 'Open the weekly family review.', assistant: 'This independent Session uses only the Parenting Area context pack and explicitly linked family notes.' },
        { id: 'parenting-school', group: 'Earlier', title: 'School follow-up', subtitle: 'Waiting for reply', type: 'Follow-up', status: 'waiting', time: 'Thu', user: 'What is still waiting in the school follow-up?', assistant: 'One external reply is pending. HUE can remind you, but it does not claim the message was read or answered.' }
      ]
    }
  };

  const selectedSessions = Object.fromEntries(Object.entries(spaces).map(([id, space]) => [id, space.sessions[0]?.id]));

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function closePanes() {
    document.body.classList.remove('projects-pane-open', 'sessions-pane-open');
  }

  function updateMobileNavigation(screenName) {
    $$('.mobile-bottom-nav button').forEach((button) => button.classList.remove('active'));
    let selector = `[data-screen-target="${screenName}"]`;
    if (screenName === 'conversation') selector = '[data-action="open-sessions"]';
    if (['project', 'area', 'architecture'].includes(screenName)) selector = '[data-action="open-projects"]';
    const button = $(selector, $('.mobile-bottom-nav'));
    button?.classList.add('active');
  }

  function showScreen(name, updateHash = true, overrides = {}) {
    const next = $(`[data-screen="${name}"]`);
    if (!next) return;
    $$('.screen').forEach((screen) => screen.classList.toggle('active', screen === next));
    $$('.project-rail .nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screenTarget === name));
    title.textContent = overrides.title || next.dataset.title || 'HUE';
    eyebrow.textContent = overrides.eyebrow || next.dataset.eyebrow || 'HUE';
    updateMobileNavigation(name);
    if (updateHash) history.replaceState(null, '', `#${name}`);
    $('#main-content').scrollTo({ top: 0, behavior: 'smooth' });
    $$('dialog[open]').forEach((dialog) => dialog.close());
    closePanes();
    document.title = `${title.textContent} · HUE prototype`;
  }

  function currentSpace() {
    return spaces[activeSpaceId];
  }

  function sessionById(space, id) {
    return space.sessions.find((session) => session.id === id) || space.sessions[0];
  }

  function updateConversation(session) {
    const space = currentSpace();
    if (!session) return;
    $('#session-user-message').textContent = session.user;
    $('#session-hue-message').textContent = session.assistant;
    $('#session-route-pill').textContent = `${session.type} · ${space.name} · ${session.status}`;
    $('#session-proposal-title').textContent = `${space.name} context established`;
    $('#session-proposal-detail').textContent = `${space.kind} · ${space.sessions.length} current Sessions · context remains isolated.`;
    $('#session-context-space').textContent = `${space.name} context pack`;
    $('#composer-space-chip').textContent = `◇ ${space.name}`;
    const conversation = $('[data-screen="conversation"]');
    conversation.dataset.title = session.title;
    conversation.dataset.eyebrow = `${space.name} / Sessions / ${session.type}`;
  }

  function renderSessions(filter = '') {
    const space = currentSpace();
    const query = filter.trim().toLowerCase();
    const sessions = space.sessions.filter((session) => `${session.title} ${session.subtitle} ${session.type} ${session.status}`.toLowerCase().includes(query));
    sessionList.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement('p');
      empty.className = 'session-empty';
      empty.textContent = `No ${space.name} Sessions match “${filter}”.`;
      sessionList.append(empty);
      return;
    }

    let previousGroup = '';
    sessions.forEach((session) => {
      if (session.group !== previousGroup) {
        const label = document.createElement('p');
        label.className = 'session-group-label';
        label.textContent = session.group;
        sessionList.append(label);
        previousGroup = session.group;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `session-item${selectedSessions[activeSpaceId] === session.id ? ' active' : ''}`;
      button.dataset.sessionId = session.id;
      button.setAttribute('aria-label', `${session.title}, ${session.status}, ${session.subtitle}`);

      const status = document.createElement('i');
      status.className = `session-status ${session.status}`;
      status.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'session-item-copy';
      const strong = document.createElement('strong');
      strong.textContent = session.title;
      const small = document.createElement('small');
      small.textContent = session.subtitle;
      const meta = document.createElement('span');
      const type = document.createElement('b');
      type.className = 'session-type';
      type.textContent = session.type;
      const statusText = document.createElement('span');
      statusText.textContent = session.status;
      meta.append(type, statusText);
      copy.append(strong, small, meta);

      const time = document.createElement('time');
      time.textContent = session.time;
      button.append(status, copy, time);
      sessionList.append(button);
    });
  }

  function syncSpaceOverview(space) {
    const overview = $(`[data-screen="${space.kind === 'Area' ? 'area' : 'project'}"]`);
    if (!overview) return;
    overview.dataset.title = space.name;
    overview.dataset.eyebrow = `${space.kind === 'Area' ? 'Areas' : 'Projects'} / ${space.name} / Overview`;
    const heading = $('.project-hero h2', overview);
    const description = $('.project-hero > div > p', overview);
    const avatar = $('.project-hero .project-avatar', overview);
    const kindChip = $('.project-hero .state-chip', overview);
    if (heading) heading.textContent = space.name;
    if (description) description.textContent = space.description;
    if (avatar) {
      avatar.textContent = space.glyph;
      avatar.className = `project-avatar large ${space.kind === 'Area' ? 'blue' : space.glyphClass === 'notidian-space' ? 'green' : 'gold'}`;
    }
    if (kindChip) kindChip.textContent = space.kind === 'Area' ? 'Ongoing Area' : 'Finishable Project';
  }

  function setActiveSpace(spaceId, options = {}) {
    if (!spaces[spaceId]) return;
    activeSpaceId = spaceId;
    const space = currentSpace();
    $$('.space-nav-item').forEach((button) => button.classList.toggle('active', button.dataset.spaceTarget === spaceId));
    $('#session-space-name').textContent = space.name;
    $('#session-space-kind').textContent = `${space.kind} Sessions`;
    $('#session-space-description').textContent = space.description;
    const glyph = $('#session-space-glyph');
    glyph.textContent = space.glyph;
    glyph.className = `space-glyph ${space.glyphClass}`;
    sessionSearch.value = '';
    syncSpaceOverview(space);
    renderSessions();
    updateConversation(sessionById(space, selectedSessions[spaceId]));
    if (options.showOverview) showScreen(space.overviewScreen);
  }

  function selectSession(sessionId) {
    const space = currentSpace();
    const session = sessionById(space, sessionId);
    if (!session) return;
    selectedSessions[activeSpaceId] = session.id;
    renderSessions(sessionSearch.value);
    updateConversation(session);
    showScreen('conversation', true, {
      title: session.title,
      eyebrow: `${space.name} / Sessions / ${session.type}`
    });
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

  function railIsCollapsed() {
    if (document.body.classList.contains('project-rail-expanded')) return false;
    if (document.body.classList.contains('project-rail-collapsed')) return true;
    return window.matchMedia('(max-width: 1180px)').matches;
  }

  function updateRailToggle() {
    const collapsed = railIsCollapsed();
    const button = $('[data-action="toggle-project-rail"]');
    if (!button) return;
    button.setAttribute('aria-pressed', String(collapsed));
    button.setAttribute('aria-label', collapsed ? 'Expand Spaces sidebar' : 'Collapse Spaces sidebar');
    button.title = collapsed ? 'Expand Spaces sidebar' : 'Collapse Spaces sidebar';
  }

  function toggleProjectRail() {
    if (railIsCollapsed()) {
      document.body.classList.remove('project-rail-collapsed');
      document.body.classList.add('project-rail-expanded');
    } else {
      document.body.classList.remove('project-rail-expanded');
      document.body.classList.add('project-rail-collapsed');
    }
    updateRailToggle();
  }

  function action(name) {
    const workerDialog = $('#worker-dialog');
    const commandDialog = $('#command-dialog');
    const messages = {
      'open-settings': 'Settings screen behavior is documented and TBI.',
      'mock-send': 'Prototype only — no message or task was sent.',
      'steer': 'Steering would be queued at the worker’s next safe boundary.',
      'pause': 'Pause requested in prototype. Durable pause semantics are TBI.',
      'cancel': 'Cancel would require an effect check before claiming the run stopped safely.',
      'show-replan': 'Plan revised after the first viewport test exposed an accessibility dependency.',
      'reject-approval': 'Mock approval rejected. No files or policies were changed.',
      'approve': 'Mock approval granted once. No real capability was issued.',
      'open-notification-settings': 'Notification policy: channels, privacy, sounds, quiet hours, grouping and retention · TBI.',
      'mock-mark-read': 'Mock notification marked read. The underlying semantic event remains durable.',
      'new-space': 'Create/open Space flow is TBI. Every existing Project and Area remains visible in the rail.'
    };

    if (name === 'toggle-project-rail') {
      toggleProjectRail();
      return;
    }
    if (name === 'open-projects') {
      document.body.classList.remove('sessions-pane-open');
      document.body.classList.add('projects-pane-open');
      return;
    }
    if (name === 'open-sessions') {
      document.body.classList.remove('projects-pane-open');
      document.body.classList.add('sessions-pane-open');
      return;
    }
    if (name === 'close-panes') {
      closePanes();
      return;
    }
    if (name === 'new-session') {
      const space = currentSpace();
      const session = sessionById(space, selectedSessions[activeSpaceId]);
      updateConversation(session);
      showScreen('conversation', true, { title: `New Session · ${space.name}`, eyebrow: `${space.name} / Sessions / Draft` });
      notify(`New ${space.name} Session draft · prototype only.`);
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

  $$('[data-space-target]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveSpace(button.dataset.spaceTarget);
      if (button.dataset.screenTarget) showScreen(button.dataset.screenTarget);
    });
  });

  $$('[data-screen-target]:not([data-space-target])').forEach((button) => {
    button.addEventListener('click', () => showScreen(button.dataset.screenTarget));
  });

  $$('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action)));

  sessionList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-id]');
    if (button) selectSession(button.dataset.sessionId);
  });

  sessionSearch.addEventListener('input', () => renderSessions(sessionSearch.value));

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      action('command');
    }
    if (event.key === 'Escape') closePanes();
  });

  window.addEventListener('resize', updateRailToggle);

  const initial = location.hash.slice(1);
  const initialScreen = $(`[data-screen="${initial}"]`) ? initial : 'home';
  const initialSpace = initialScreen === 'project' ? 'notidian' : initialScreen === 'area' ? 'health' : 'hue';
  setActiveSpace(initialSpace);
  showScreen(initialScreen, false);
  updateRailToggle();
})();
