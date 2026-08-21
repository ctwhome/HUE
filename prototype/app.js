(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const title = $('#screen-title');
  const eyebrow = $('#screen-eyebrow');
  const toast = $('#toast');
  const sessionList = $('#session-list');
  const sessionSearch = $('#session-search-input');
  const projectRail = $('.project-rail');
  const sessionSidebar = $('.session-sidebar');
  const paneBackdrop = $('.pane-backdrop');
  const navigationAnnouncer = $('#navigation-announcer');
  const mobileDrawerQuery = window.matchMedia('(max-width: 760px)');
  const narrowDrawerQuery = window.matchMedia('(max-width: 900px)');
  const DRAWER_EDGE = 28;
  const GESTURE_LOCK = 10;
  const DISTANCE_THRESHOLD = 0.3;
  const VELOCITY_THRESHOLD = 0.55;
  let toastTimer;
  let activeSpaceId = 'hue';
  let paneReturnFocus = null;
  let restoringHistory = false;
  let gesture = null;
  let scrollMomentumFrame = 0;
  let suppressClickUntil = 0;

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

  function currentScreenName() {
    return $('.screen.active')?.dataset.screen || 'home';
  }

  function currentPane() {
    if (document.body.classList.contains('projects-pane-open')) return 'projects';
    if (document.body.classList.contains('sessions-pane-open')) return 'sessions';
    return null;
  }

  function currentLayer() {
    const dialog = $('dialog[open]');
    if (dialog) return `dialog:${dialog.id}`;
    return currentPane();
  }

  function snapshotState(layer = currentLayer()) {
    return {
      huePrototype: true,
      screen: currentScreenName(),
      spaceId: activeSpaceId,
      sessionId: selectedSessions[activeSpaceId],
      layer
    };
  }

  function writeHistory(mode = 'push', layer = currentLayer()) {
    if (restoringHistory) return;
    const state = snapshotState(layer);
    if (mode === 'replace') history.replaceState(state, '', `#${state.screen}`);
    else history.pushState(state, '', `#${state.screen}`);
  }

  function announceNavigation(message) {
    if (!navigationAnnouncer || !message) return;
    navigationAnnouncer.textContent = '';
    requestAnimationFrame(() => { navigationAnnouncer.textContent = message; });
  }

  function updateMobileNavigation(screenName = currentScreenName()) {
    $$('.mobile-bottom-nav button').forEach((button) => button.classList.remove('active'));
    const pane = currentPane();
    let selector = pane ? `[data-action="open-${pane}"]` : `[data-screen-target="${screenName}"]`;
    if (!pane && screenName === 'conversation') selector = '[data-action="open-sessions"]';
    if (!pane && ['project', 'area', 'architecture'].includes(screenName)) selector = '[data-action="open-projects"]';
    const button = $(selector, $('.mobile-bottom-nav'));
    button?.classList.add('active');
  }

  function syncDrawerAccessibility() {
    const pane = currentPane();
    const projectsHidden = mobileDrawerQuery.matches && pane !== 'projects';
    const sessionsHidden = narrowDrawerQuery.matches && pane !== 'sessions';
    projectRail.inert = projectsHidden;
    sessionSidebar.inert = sessionsHidden;
    projectRail.setAttribute('aria-hidden', String(projectsHidden));
    sessionSidebar.setAttribute('aria-hidden', String(sessionsHidden));
    paneBackdrop.setAttribute('aria-hidden', String(!pane));
    $$('[data-action="open-projects"]').forEach((button) => button.setAttribute('aria-expanded', String(pane === 'projects')));
    $$('[data-action="open-sessions"]').forEach((button) => button.setAttribute('aria-expanded', String(pane === 'sessions')));
    updateMobileNavigation();
  }

  function applyPane(pane, options = {}) {
    const previous = currentPane();
    document.body.classList.toggle('projects-pane-open', pane === 'projects');
    document.body.classList.toggle('sessions-pane-open', pane === 'sessions');
    syncDrawerAccessibility();
    if (options.announce !== false && pane !== previous) {
      if (pane === 'projects') announceNavigation('Spaces menu opened.');
      else if (pane === 'sessions') announceNavigation(`${currentSpace().name} Sessions opened.`);
      else if (previous) announceNavigation('Navigation menu closed.');
    }
  }

  function openPane(pane, options = {}) {
    if (pane === 'projects' && !mobileDrawerQuery.matches) return;
    if (pane === 'sessions' && !narrowDrawerQuery.matches) return;
    if (currentPane() === pane && !options.force) {
      closePanes();
      return;
    }
    paneReturnFocus = options.trigger || document.activeElement;
    const replacingLayer = Boolean(history.state?.huePrototype && history.state.layer);
    applyPane(pane, { announce: options.announce });
    if (options.history !== false) writeHistory(options.historyMode || (replacingLayer ? 'replace' : 'push'), pane);
  }

  function closeDialogsDirect() {
    $$('dialog[open]').forEach((dialog) => dialog.close());
  }

  function closePanes(options = {}) {
    const layer = currentLayer();
    if (options.history !== false && layer && history.state?.huePrototype && history.state.layer) {
      history.back();
      return;
    }
    closeDialogsDirect();
    applyPane(null, { announce: options.announce });
    if (options.restoreFocus !== false && paneReturnFocus instanceof HTMLElement && paneReturnFocus.isConnected) {
      paneReturnFocus.focus({ preventScroll: true });
    }
    paneReturnFocus = null;
  }

  function showScreen(name, updateHistory = true, overrides = {}, historyMode) {
    const next = $(`[data-screen="${name}"]`);
    if (!next) return;
    const hadLayer = Boolean(currentLayer());
    closeDialogsDirect();
    applyPane(null, { announce: false });
    $$('.screen').forEach((screen) => screen.classList.toggle('active', screen === next));
    $$('.project-rail .nav-item').forEach((item) => item.classList.toggle('active', item.dataset.screenTarget === name));
    title.textContent = overrides.title || next.dataset.title || 'HUE';
    eyebrow.textContent = overrides.eyebrow || next.dataset.eyebrow || 'HUE';
    updateMobileNavigation(name);
    $('#main-content').scrollTo({ top: 0, behavior: restoringHistory ? 'auto' : 'smooth' });
    document.title = `${title.textContent} · HUE prototype`;
    if (updateHistory) writeHistory(historyMode || (hadLayer ? 'replace' : 'push'), null);
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

  function openDialog(dialog, source) {
    if (!dialog) return;
    const replacingLayer = Boolean(history.state?.huePrototype && history.state.layer);
    paneReturnFocus = source || document.activeElement;
    closeDialogsDirect();
    applyPane(null, { announce: false });
    dialog.showModal();
    writeHistory(replacingLayer ? 'replace' : 'push', `dialog:${dialog.id}`);
  }

  function action(name, source) {
    const workerDialog = $('#worker-dialog');
    const commandDialog = $('#command-dialog');
    const projectDialog = $('#project-dialog');
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
      'mock-mark-read': 'Mock notification marked read. The underlying semantic event remains durable.'
    };

    if (name === 'toggle-project-rail') {
      toggleProjectRail();
      return;
    }
    if (name === 'open-projects') {
      openPane('projects', { trigger: source });
      return;
    }
    if (name === 'show-projects') {
      openPane('projects', { trigger: source, force: true, historyMode: 'replace' });
      return;
    }
    if (name === 'open-sessions') {
      openPane('sessions', { trigger: source });
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
      openDialog(workerDialog, source);
      return;
    }
    if (name === 'command') {
      openDialog(commandDialog, source);
      setTimeout(() => $('input', commandDialog)?.focus(), 10);
      return;
    }
    if (name === 'new-space') {
      openDialog(projectDialog, source);
      setTimeout(() => $('#project-name')?.focus(), 10);
      return;
    }
    if (name === 'close-dialog') {
      closePanes();
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
      window.location.href = '../docs/roadmap/ISSUES.md';
      return;
    }
    notify(messages[name] || 'Prototype interaction · product behavior TBI.');
  }

  function restoreAppState(state) {
    restoringHistory = true;
    closeDialogsDirect();
    applyPane(null, { announce: false });

    const nextState = state?.huePrototype ? state : {
      screen: $(`[data-screen="${location.hash.slice(1)}"]`) ? location.hash.slice(1) : 'home',
      spaceId: activeSpaceId,
      sessionId: selectedSessions[activeSpaceId],
      layer: null
    };

    if (spaces[nextState.spaceId]) {
      if (spaces[nextState.spaceId].sessions.some((session) => session.id === nextState.sessionId)) {
        selectedSessions[nextState.spaceId] = nextState.sessionId;
      }
      setActiveSpace(nextState.spaceId);
    }

    const session = sessionById(currentSpace(), selectedSessions[activeSpaceId]);
    updateConversation(session);
    showScreen(nextState.screen || 'home', false, nextState.screen === 'conversation' ? {
      title: session.title,
      eyebrow: `${currentSpace().name} / Sessions / ${session.type}`
    } : {});

    if (nextState.layer === 'projects' || nextState.layer === 'sessions') {
      applyPane(nextState.layer, { announce: true });
    } else if (typeof nextState.layer === 'string' && nextState.layer.startsWith('dialog:')) {
      const dialog = $(`#${nextState.layer.slice(7)}`);
      dialog?.showModal();
    }
    restoringHistory = false;
  }

  function drawerForPane(pane) {
    return pane === 'projects' ? projectRail : sessionSidebar;
  }

  function clearGestureVisuals(drawer) {
    drawer?.classList.remove('drawer-dragging');
    drawer?.style.removeProperty('transform');
    document.body.classList.remove('drawer-gesture-active');
    document.body.style.removeProperty('--drawer-scrim-opacity');
  }

  function beginDrawerGesture(event) {
    if (!mobileDrawerQuery.matches || event.pointerType === 'mouse' || !event.isPrimary || $('dialog[open]')) return;
    if (scrollMomentumFrame) {
      cancelAnimationFrame(scrollMomentumFrame);
      scrollMomentumFrame = 0;
    }
    const pane = currentPane();
    let mode = null;
    let targetPane = pane;

    if (pane && drawerForPane(pane).contains(event.target)) {
      mode = 'close';
    } else if (!pane && (event.target.closest('.drawer-edge-swipe-zone') || event.clientX <= DRAWER_EDGE)) {
      mode = 'open';
      targetPane = 'sessions';
    }
    if (!mode) return;

    gesture = {
      pointerId: event.pointerId,
      mode,
      pane: targetPane,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityX: 0,
      velocityY: 0,
      progress: mode === 'open' ? 0 : 1,
      locked: false,
      drawer: drawerForPane(targetPane),
      width: drawerForPane(targetPane).getBoundingClientRect().width,
      scrollTarget: event.target.closest('.session-list, .project-rail nav'),
      startScrollTop: event.target.closest('.session-list, .project-rail nav')?.scrollTop || 0
    };
  }

  function lockDrawerGesture() {
    const drawer = gesture.drawer;
    drawer.classList.add('drawer-dragging');
    document.body.classList.add('drawer-gesture-active');
    if (gesture.mode === 'open') {
      drawer.style.transform = `translate3d(${-gesture.width}px, 0, 0)`;
      applyPane(gesture.pane, { announce: false });
    }
    document.body.style.setProperty('--drawer-scrim-opacity', String(gesture.progress));
    gesture.locked = true;
  }

  function moveDrawerGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;

    if (!gesture.locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < GESTURE_LOCK) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        if (!gesture.scrollTarget) {
          gesture = null;
          return;
        }
        gesture.mode = 'scroll';
        gesture.locked = true;
      } else if (gesture.mode === 'open' && dx <= 0) {
        gesture = null;
        return;
      } else {
        lockDrawerGesture();
      }
    }

    event.preventDefault();
    const now = event.timeStamp;
    const elapsed = Math.max(1, now - gesture.lastTime);
    gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
    gesture.velocityY = (event.clientY - gesture.lastY) / elapsed;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastTime = now;

    if (gesture.mode === 'scroll') {
      gesture.scrollTarget.scrollTop = gesture.startScrollTop - dy;
      return;
    }

    const translateX = gesture.mode === 'open'
      ? Math.min(0, Math.max(-gesture.width, -gesture.width + Math.max(0, dx)))
      : Math.min(0, Math.max(-gesture.width, Math.min(0, dx)));
    gesture.progress = 1 + translateX / gesture.width;
    gesture.drawer.style.transform = `translate3d(${translateX}px, 0, 0)`;
    document.body.style.setProperty('--drawer-scrim-opacity', String(gesture.progress));
  }

  function continueScrollMomentum(activeGesture) {
    if (!activeGesture.scrollTarget || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let velocity = activeGesture.velocityY;
    if (Math.abs(velocity) < 0.08) return;
    const tick = () => {
      velocity *= 0.92;
      activeGesture.scrollTarget.scrollTop -= velocity * 16;
      if (Math.abs(velocity) >= 0.02) {
        scrollMomentumFrame = requestAnimationFrame(tick);
      } else {
        scrollMomentumFrame = 0;
      }
    };
    scrollMomentumFrame = requestAnimationFrame(tick);
  }

  function finishDrawerGesture(event, cancelled = false) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const activeGesture = gesture;
    gesture = null;
    if (!activeGesture.locked) return;
    if (activeGesture.mode === 'scroll') {
      continueScrollMomentum(activeGesture);
      return;
    }

    const opening = activeGesture.mode === 'open';
    const completed = !cancelled && (opening
      ? activeGesture.progress >= DISTANCE_THRESHOLD || activeGesture.velocityX >= VELOCITY_THRESHOLD
      : activeGesture.progress <= 1 - DISTANCE_THRESHOLD || activeGesture.velocityX <= -VELOCITY_THRESHOLD);
    const shouldBeOpen = opening ? completed : !completed;
    const targetX = shouldBeOpen ? 0 : -activeGesture.width;
    suppressClickUntil = performance.now() + 350;

    activeGesture.drawer.classList.remove('drawer-dragging');
    activeGesture.drawer.getBoundingClientRect();
    activeGesture.drawer.style.transform = `translate3d(${targetX}px, 0, 0)`;
    document.body.style.setProperty('--drawer-scrim-opacity', shouldBeOpen ? '1' : '0');

    window.setTimeout(() => {
      clearGestureVisuals(activeGesture.drawer);
      if (opening && completed) {
        paneReturnFocus = null;
        writeHistory('push', activeGesture.pane);
        announceNavigation(`${currentSpace().name} Sessions opened.`);
      } else if (opening) {
        applyPane(null, { announce: false });
      } else if (completed) {
        applyPane(null, { announce: true });
        if (history.state?.huePrototype && history.state.layer) history.back();
      }
    }, 230);
  }

  $$('[data-space-target]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveSpace(button.dataset.spaceTarget);
      const isMobileRailSelection = mobileDrawerQuery.matches && projectRail.contains(button);
      if (isMobileRailSelection) {
        applyPane(null, { announce: false });
        writeHistory('replace', null);
        openPane('sessions', { trigger: button, force: true, historyMode: 'push' });
      } else if (button.dataset.screenTarget) {
        showScreen(button.dataset.screenTarget);
      }
    });
  });

  $$('[data-screen-target]:not([data-space-target])').forEach((button) => {
    button.addEventListener('click', () => showScreen(button.dataset.screenTarget));
  });

  $$('[data-action]').forEach((button) => button.addEventListener('click', () => action(button.dataset.action, button)));

  $('#project-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = data.get('name').trim();
    const path = data.get('path').trim();
    const id = `project-${Date.now()}`;
    const glyph = name.charAt(0).toUpperCase();
    const button = document.createElement('button');

    spaces[id] = {
      name,
      path,
      kind: 'Project',
      glyph,
      glyphClass: 'custom-space',
      overviewScreen: 'project',
      description: `Local project at ${path}.`,
      sessions: []
    };
    selectedSessions[id] = undefined;
    button.type = 'button';
    button.className = 'space-nav-item';
    button.dataset.spaceTarget = id;
    button.dataset.screenTarget = 'project';
    button.title = name;
    button.setAttribute('aria-label', `${name} project`);
    const icon = document.createElement('span');
    icon.className = 'space-glyph custom-space';
    icon.textContent = glyph;
    const copy = document.createElement('span');
    copy.className = 'space-copy rail-label';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = path;
    copy.append(strong, small);
    button.append(icon, copy);
    button.addEventListener('click', () => {
      setActiveSpace(id);
      showScreen('project');
    });
    $('[data-project-list-end]').before(button);
    form.reset();
    closeDialogsDirect();
    paneReturnFocus = null;
    setActiveSpace(id);
    showScreen('project', true, {}, 'replace');
    notify(`${name} added to Projects.`);
  });

  sessionList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-session-id]');
    if (button) selectSession(button.dataset.sessionId);
  });

  sessionSearch.addEventListener('input', () => renderSessions(sessionSearch.value));

  document.addEventListener('pointerdown', beginDrawerGesture, { passive: true });
  window.addEventListener('pointermove', moveDrawerGesture, { passive: false });
  window.addEventListener('pointerup', (event) => finishDrawerGesture(event));
  window.addEventListener('pointercancel', (event) => finishDrawerGesture(event, true));
  document.addEventListener('click', (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closePanes();
    });
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      action('command', document.activeElement);
    }
    if (event.key === 'Escape' && currentLayer()) {
      event.preventDefault();
      closePanes();
    }
  });

  function handleViewportChange() {
    if (!narrowDrawerQuery.matches) applyPane(null, { announce: false });
    else if (!mobileDrawerQuery.matches && currentPane() === 'projects') applyPane(null, { announce: false });
    updateRailToggle();
    syncDrawerAccessibility();
  }

  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('popstate', (event) => restoreAppState(event.state));

  const initial = location.hash.slice(1);
  const initialScreen = $(`[data-screen="${initial}"]`) ? initial : 'home';
  const initialSpace = initialScreen === 'project' ? 'notidian' : initialScreen === 'area' ? 'health' : 'hue';
  setActiveSpace(initialSpace);
  showScreen(initialScreen, false);
  updateRailToggle();
  syncDrawerAccessibility();
  history.replaceState(snapshotState(null), '', `#${initialScreen}`);
})();
