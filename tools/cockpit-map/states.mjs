// The screens of the Cockpit Map: how to reach each one, and the key for its controls.
// `sel` is plain CSS for the control to number (the first match). In `name`, `fed`
// and `click`, `X` is a key cap and *word* is italic. The key's order is the order
// of the numbers on the picture, roughly reading order.
import { demo, depart, mode, settle, tab } from './setup.mjs';

const NONE = 'Nothing to press.';

/** The top bar, the same in Dash and Tour mode. */
const TOP_BAR = [
  { sel: '.topbar .modes', name: 'Display mode', fed: 'Your choice. Each screen remembers its own.', click: '*Tour*: the view, with nothing in front of it. *Dash*: this dashboard. *Work*: your work panels; in VS Code it takes you back to the editor. Keys `T` `D` `W`.' },
  { sel: '.top-btn[aria-label="Destinations"]', name: 'Destinations', fed: 'The journey packs.', click: 'Opens the destination board, to pick or change a journey. Key `G`.' },
  { sel: '.top-btn[aria-label="Passport"]', name: 'Passport', fed: 'Your trips, stamps and travel memories.', click: 'Opens your Passport. Key `P`.' },
  { sel: '.top-btn[aria-label="Capture my workplace"]', name: 'Capture my workplace', fed: 'The view and the dashboard as they are now.', click: 'Saves a picture, with private details left out. Key `C`.' },
  { sel: '.top-btn.sound-btn', name: 'Sound', fed: 'Your sound setting.', click: "Turns the tour's sound on or off: engine, road, weather and the Focus Mix. The radio has its own power and volume. Key `M`." },
  { sel: '.top-btn[aria-label="Settings"]', name: 'Settings', fed: 'This screen’s settings.', click: 'Opens Settings: display, alerts (a bell colour for each), sound, accessibility and performance. Key `S`; `?` lists every key.' },
];

const BELL = {
  sel: '.alert-bell',
  name: 'Alerts bell',
  fed: 'The loudest colour lit. By default *red* when something stopped the car, *orange* when something needs you, *blue* for files not yet committed; open PRs and branches only once you pick them a colour in Settings › Alerts. Dark when there is nothing.',
  click: 'Opens the dashboard on the Alerts tab.',
};

export const STATES = [
  {
    id: 'dash',
    short: 'Dashboard',
    group: 'dash',
    title: 'The dashboard',
    intro: 'Dash mode, while you code and an agent works. Nothing sits on the windshield. Press `D` from anywhere to come here.',
    query: '?fresh&speed=5',
    // A laptop's battery, so its lights are in the picture.
    async init(page) {
      await page.addInitScript(() => {
        navigator.getBattery = async () => ({ level: 0.78, charging: false, dischargingTime: 9000, addEventListener() {} });
      });
    },
    async setup(page) {
      await depart(page);
      await demo(page, 'Type code', 'Agent edits', 'Agent edits');
      await mode(page, 'd');
      await settle(page, 900);
    },
    items: [
      ...TOP_BAR,
      { sel: '.mirror-wrap .mirror', name: 'Rear-view mirror', fed: 'Nothing. It is a plain mirror, kept clear of text.', click: 'Only its bell does anything.' },
      BELL,
      { sel: '.gauge[aria-label="Speedometer: development activity"]', name: 'Activity', fed: 'Your coding: edits, saves, moving around and focus. Each one kicks the needle up; with nothing new the reading halves every 15 s. Like a speedometer, it reads 0 while the car is stopped. Red zone from 75%.', click: NONE },
      { sel: '.gauge[aria-label="Agents at work"]', name: 'Agents', fed: 'How many agents are at work now: your agent and the sub-agents it starts, until each reports back. 0 to 8; six or more at once is the red zone, where your plan’s usage goes fastest.', click: NONE },
      { sel: '.gauge[aria-label="Tool calls in the last minute"]', name: 'Tools', fed: 'Tool calls and commands started in the last minute. Full at 30. No red zone: a busy agent is no fault.', click: NONE },
      { sel: '.screen .tabs', name: 'Screen tabs', fed: 'Nav, Radio, PRs, Trip, Console, and the bell for Alerts. The PRs count turns amber when one needs you.', click: 'Switches the screen. Each tab has its own section below. `R` opens Radio.' },
      { sel: '.gauge[aria-label="Agent context window left"]', name: 'Context', fed: "How much of your agent's context window is left, as Claude Code reports it. Red under 25%.", click: NONE },
      { sel: '.gauge[aria-label="Temperature: warnings and errors"]', name: 'Issues', fed: 'Errors and warnings in Problems, and failing checks. Red past three issues.', click: NONE },
      { sel: '.gauge-btn', name: 'Changes', fed: 'Files changed and not committed, from Git, like the Source Control badge. ↑N: commits to push. Red past 20 files.', click: 'Opens Source Control in VS Code.' },
      { sel: '.gauge[aria-label="Journey progress"]', name: 'Journey', fed: 'How far along the journey is, with the percent done: empty on the left as you set off, full on the right when you arrive. Empty again after you refuel. ∞ on a free drive.', click: NONE },
      { sel: '.battery-meter', name: 'Battery', fed: "This computer's battery: five lights, one per fifth of a charge. Amber at 25% and under, red at 10%; the top light pulses while charging. Hidden where the browser reports no battery.", click: NONE },
      { sel: '.cache-dots', name: 'Prompt cache', fed: "Claude's prompt cache for this session: how much of its input was read from the cache, and the minutes until the cache goes cold. Each dot turns *orange* under the level you set in Settings (50%, 15 min); the timer turns *red* at 0, when the next reply writes the cache again.", click: NONE },
      { sel: '.gear', name: 'Gear', fed: '*P* stopped, *R* reviewing a diff, *N* thinking, *D* coding, an agent at work or verifying. The hint beside it says which.', click: NONE },
      { sel: '.glovebox', name: 'Glovebox', fed: "Your project's docs: README, CONTRIBUTING, CHANGELOG and docs/. Pull the handle.", click: 'Lists the docs; picking one opens it in VS Code, Markdown in its preview. Hidden on a phone.' },
    ],
  },
  {
    id: 'stopped',
    short: 'Stopped',
    group: 'dash',
    title: 'Stopped for you',
    intro: 'Your agent asked a question, so the car pulled over at once, here at a turnout just out of Monterey. At one of the journey’s scenic stops the Nav screen names it. It drives on when you answer.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits', 'Agent asks');
      await page.locator('.stop-card.show').waitFor({ timeout: 15_000 });
      await mode(page, 'd');
      await settle(page);
    },
    items: [
      BELL,
      { sel: '.stop-card.show .alert', name: 'Stop pill', fed: 'Why the car stopped, coloured like the bells, and what resumes the drive: a question, a plan or approval, an agent that stopped, a failing build, your turn, a breather, refuelling, or parked. A long message wraps and the pill grows taller.', click: "Takes you where you act: the agent's terminal (else the editor), the PR on GitHub, or Problems. When parked, *Resume journey* sits under it." },
      { sel: '.gauge[aria-label="Speedometer: development activity"]', name: 'Stop pins', fed: 'Activity reads 0 while stopped. Each dial on the left leaves a white pin where its needle stood when the car stopped, until the drive resumes.', click: NONE },
      { sel: '.gear', name: 'Gear', fed: '*P* while stopped.', click: NONE },
    ],
  },
  {
    id: 'nav',
    close: '.screen',
    short: 'Nav',
    group: 'tab',
    title: 'Nav',
    intro: 'Where the journey goes and how far along it is.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Type code', 'Type code');
      await mode(page, 'd');
      await tab(page, 'nav');
    },
    items: [
      { sel: '.pane-nav .route-map', name: 'Route map', fed: 'The journey’s route, its towns, and the car on it.', click: NONE },
      { sel: '.pane-nav .route-stop', name: 'Scenic stops', fed: 'Where the journey’s scenic stops are on the route (green diamonds). The one the car is stopped at lights up.', click: NONE },
      { sel: '.nav-route', name: 'Route', fed: 'The journey pack and its road.', click: NONE },
      { sel: '.nav-loc', name: 'Where you are', fed: 'The town you are near, and the scene outside. At a scenic stop, its name: *Stopped at Bixby Creek Overlook*.', click: NONE },
      { sel: '.nav-meta', name: 'Trip and progress', fed: 'The trip length you picked (Coffee Run to Expedition) and how far along you are.', click: NONE },
      { sel: '.nav-objective', name: 'Objective', fed: 'What you said you would get done, on your ticket.', click: NONE },
      { sel: '.btn-arrive', name: 'Arrive', fed: 'Shown until you arrive.', click: 'Marks the objective done: the car takes the final approach and arrives, and you get a stamp. Key `A`.' },
    ],
  },
  {
    id: 'radio-fm',
    close: '.screen',
    short: 'Radio FM',
    group: 'tab',
    title: 'Radio, FM, playing',
    caption: 'Close-up of the screen, CLI companion playing a real station',
    intro: "Internet radio. A real station plays through VibeTour's local server (the CLI companion here; in VS Code, the extension). Searches and streams go out from there, never from the tour page. A Companion Display keeps playing; in VS Code the radio stops when the panel closes. `R` opens it.",
    needs: 'companion',
    async setup(page) {
      await depart(page);
      await page.keyboard.press('r');
      await page.locator('.band.band-fm').click();
      await page.locator('.deck-power').click();
      await page.locator('.deck-live.is-live').waitFor({ timeout: 25_000 }).catch(() => console.warn('  the station did not go live'));
      await settle(page, 4_000);
    },
    items: [
      { sel: '.band.band-fm', name: 'Band: FM and CB', fed: 'Your last choice.', click: '*FM* plays internet radio. *CB* lists your agents; an amber dot on it means one is waiting.' },
      { sel: 'canvas.deck-eq', name: 'Equalizer lights', fed: 'The music playing, this radio or the tour’s Focus Mix: columns rise with the level and the beat.', click: 'Nothing to press. Off in Settings › Sound.' },
      { sel: '.deck-live', name: 'LIVE', fed: 'The stream: OFF, tuning, LIVE (pulsing with the beat), or NO SIGNAL.', click: NONE },
      { sel: '.deck-station', name: 'Station', fed: 'The station you tuned.', click: NONE },
      { sel: '.deck-title', name: 'Song', fed: 'The song title the station sends inside its stream.', click: NONE },
      { sel: '.deck-meta', name: 'Stream', fed: 'Codec, bitrate and the station’s country.', click: NONE },
      { sel: '.deck-power', name: 'Power', fed: 'On or off.', click: 'Turns the radio on or off. It plays even with the tour’s sound off.' },
      { sel: '.deck-prev', name: 'Previous preset', fed: 'Your presets.', click: 'Tunes the previous saved preset.' },
      { sel: '.deck-play', name: 'Play / stop', fed: 'Playing or stopped.', click: 'Starts or stops the station.' },
      { sel: '.deck-next', name: 'Next preset', fed: 'Your presets.', click: 'Tunes the next saved preset.' },
      { sel: '.deck-vol', name: 'Volume', fed: 'The radio’s own volume, apart from the tour’s.', click: 'Drag. Saved when you let go.' },
      { sel: '.deck-presets', name: 'Presets 1–6', fed: 'Six saved stations; SomaFM channels to start.', click: 'Tap to tune. Hold, or Shift-click, to save the station playing.' },
      { sel: '.deck-set', name: 'SET', fed: 'Armed or not.', click: 'Press, then press a preset to save the station playing there.' },
      { sel: '.deck-dsp', name: 'Tone', fed: 'Bass, treble, fader (rear to front) and balance (left to right).', click: 'Drag each one.' },
      { sel: '.deck-toggle[title^="Surround"]', name: 'Surround', fed: 'On or off.', click: 'Widens the sound around you.' },
      { sel: '.deck-toggle[title^="Stereo mix"]', name: 'ST MIX', fed: 'Stereo, wide or mono.', click: 'Cycles through the three.' },
    ],
  },
  {
    id: 'radio-fm-local',
    close: '.screen',
    short: 'FM nearby',
    group: 'tab',
    title: 'Radio, FM, stations nearby',
    caption: 'Close-up of the screen, CLI companion, FM scrolled down',
    intro: 'Below the tone controls, the FM screen lists stations near where the journey is.',
    needs: 'companion',
    async setup(page) {
      await depart(page);
      await page.keyboard.press('r');
      await page.locator('.band.band-fm').click();
      await page.locator('.deck-local .deck-row').first().waitFor({ timeout: 20_000 }).catch(() => console.warn('  no local stations listed'));
      await page.evaluate(() => document.querySelector('.deck-local')?.scrollIntoView({ block: 'start' }));
      await settle(page, 800);
    },
    items: [
      { sel: '.deck-local', name: 'Local stations', fed: 'Stations near where the journey is, from the Radio Browser directory. Formats the player cannot decode are left out, with a count.', click: 'Click one to tune it. The one playing is marked.' },
    ],
  },
  {
    id: 'radio-fm-search',
    close: '.screen',
    short: 'FM search',
    group: 'tab',
    title: 'Radio, FM, search and SomaFM',
    caption: 'Close-up of the screen, CLI companion, FM scrolled to the end',
    intro: 'Further down: a search of the whole directory, and SomaFM\u2019s own channels. A link to support SomaFM ends the list.',
    needs: 'companion',
    async setup(page) {
      await depart(page);
      await page.keyboard.press('r');
      await page.locator('.band.band-fm').click();
      await page.evaluate(() => document.querySelector('form.deck-search-row')?.scrollIntoView({ block: 'start' }));
      await settle(page, 800);
    },
    items: [
      { sel: 'form.deck-search-row', name: 'Search', fed: 'The Radio Browser directory.', click: 'Type a name, or #tag for a genre, and press Enter. Click a result to tune it.' },
      { sel: '.deck-fm > section:nth-of-type(3)', name: 'SomaFM channels', fed: "SomaFM's curated channels.", click: 'Click one to tune it.' },
    ],
  },
  {
    id: 'radio-cb',
    close: '.screen',
    short: 'Radio CB',
    group: 'tab',
    title: 'Radio, CB',
    intro: 'Your agents on the air, with what each is doing.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits', 'Agent asks');
      await page.keyboard.press('r');
      await page.locator('.band.band-cb').click();
      await settle(page, 800);
    },
    items: [
      { sel: '.band.band-cb', name: 'CB band', fed: 'Agents on the air; an amber dot while one waits for you or needs help.', click: 'Shows your agents. *FM* goes back to the radio.' },
      { sel: '.deck-cb .station', name: 'Agent', fed: 'Each agent: its role, name, what it is doing, and its status: Working, Using tools, Waiting for you, Standing by, Finished or Needs help.', click: NONE },
    ],
  },
  {
    id: 'prs',
    close: '.screen',
    short: 'PRs',
    group: 'tab',
    title: 'PRs',
    intro: "The repository's open pull requests, once you connect GitHub. The demo shows a sample list.",
    async setup(page) {
      await depart(page);
      await mode(page, 'd');
      await tab(page, 'prs');
      await page.locator('.prs .btn-primary').click().catch(() => {});
      await page.locator('.pr-row').first().waitFor({ timeout: 10_000 }).catch(() => {});
      await settle(page, 800);
    },
    items: [
      { sel: '.tab-prs', name: 'PRs tab', fed: 'The number of open PRs; amber when one of yours needs you.', click: 'Opens this list.' },
      { sel: '.pr-row.on-branch', name: 'On your branch', fed: 'A lit branch: the PR on the branch you are on, listed first.', click: 'Opens it on GitHub.' },
      { sel: '.pr-row .pr-ci', name: 'CI', fed: 'Its checks: passing, failing, running or none.', click: NONE },
      { sel: '.pr-row.needs-you', name: 'Needs you', fed: 'Yours, with failing CI, a conflict or changes requested. It also lights the bells, orange by default.', click: 'Opens it on GitHub.' },
      { sel: '.pr-row:not(.on-branch):not(.needs-you)', name: 'Pull request', fed: 'GitHub: number, title, how far ahead and behind, when and by whom it was opened, draft, conflict, review.', click: 'Opens it on GitHub.' },
    ],
  },
  {
    id: 'trip',
    close: '.screen',
    short: 'Trip',
    group: 'tab',
    title: 'Trip',
    intro: "This journey's numbers so far.",
    async setup(page) {
      await depart(page);
      await demo(page, 'Type code', 'Type code', 'Agent edits', 'Commit');
      await mode(page, 'd');
      await tab(page, 'trip');
      await settle(page, 800);
    },
    items: [
      { sel: '.trip .trip-row:nth-child(1)', name: 'Coding time', fed: 'Time you spent coding on this journey.', click: NONE },
      { sel: '.trip .trip-row:nth-child(2)', name: 'Time on the road', fed: 'Time the car was moving.', click: NONE },
      { sel: '.trip .trip-row:nth-child(3)', name: 'Sessions', fed: 'Sittings this journey has spanned.', click: NONE },
      { sel: '.trip .trip-row:nth-child(4)', name: 'Files touched', fed: 'Files you edited or saved.', click: NONE },
      { sel: '.trip .trip-row:nth-child(5)', name: 'Test runs passed', fed: 'Test runs that passed.', click: NONE },
      { sel: '.trip .trip-row:nth-child(6)', name: 'Commits', fed: 'Commits on the way.', click: NONE },
      { sel: '.trip .trip-row:nth-child(7)', name: 'Agent time', fed: 'Time your agents spent working.', click: NONE },
    ],
  },
  {
    id: 'console',
    close: '.screen',
    short: 'Console',
    group: 'tab',
    title: 'Console',
    intro: 'Your terminal at a glance, and what just happened.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits', 'Tests fail');
      await page.waitForTimeout(13_000);
      await demo(page, 'Commit', 'Tests pass');
      await mode(page, 'd');
      await tab(page, 'console');
      await settle(page, 800);
    },
    items: [
      { sel: '.console .proc.running', name: 'Running', fed: 'Commands running in your terminal and tasks, with how long they have run.', click: NONE },
      { sel: '.console .proc.fail', name: 'Last results', fed: 'The last test, build and lint results: passed or failed.', click: NONE },
      { sel: '.recent-list', name: 'Recent', fed: "The last eight events: saves, results, commits, branch switches, your agents' questions, finishes and problems, PRs opened.", click: NONE },
    ],
  },
  {
    id: 'alerts',
    close: '.screen',
    short: 'Alerts',
    group: 'tab',
    title: 'Alerts',
    intro: 'Everything that needs you on the left, then the open PRs and the branches beside main; the file you are in and the files not yet committed on the right. Each side scrolls on its own. The mirror’s bell opens this tab.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits', 'Agent edits', 'Agent edits', 'Agent asks');
      await page.locator('.stop-card.show').waitFor({ timeout: 15_000 }).catch(() => {});
      await mode(page, 'd');
      await tab(page, 'alerts');
      await settle(page, 800);
    },
    items: [
      { sel: '.tab-alerts', name: 'Alerts tab', fed: 'Lit like the mirror’s bell.', click: 'Opens this tab.' },
      { sel: '.alerts-list .alert', name: 'Needs you', fed: 'One pill per alert while it holds, most urgent first: questions, plans, approvals, stops, your turn, PRs. Each kind has a bell colour in Settings › Alerts, and the pill shows it; *Off* hides it.', click: "Takes you where you act: the agent's terminal (else the editor), the PR on GitHub, or Problems." },
      { sel: '.file-pill.file-active', name: 'Editing', fed: 'The file open in your editor.', click: 'Opens it in VS Code.' },
      { sel: '.alerts-files .file-pills', name: 'Changed', fed: 'Files changed and not committed, from Git. Names are hidden in Streaming Mode. They light the bells blue by default.', click: 'Opens the file in VS Code.' },
    ],
  },
  {
    id: 'alerts-repo',
    close: '.screen',
    short: 'Alerts: PRs, branches',
    group: 'tab',
    title: 'Alerts: open PRs and branches',
    intro: 'Further down the left side, under what needs you: the open PRs in green and the branches beside main in violet, each with its icon, so neither reads as a file. They light the bells only in a colour you pick for them in Settings › Alerts; both are *Off* to start.',
    async setup(page) {
      await depart(page);
      await mode(page, 'd');
      await tab(page, 'prs');
      await page.locator('.prs .btn-primary').click().catch(() => {});
      await page.locator('.pr-row').first().waitFor({ timeout: 10_000 }).catch(() => {});
      await tab(page, 'alerts');
      await settle(page, 600);
      // Scroll the left side so Open PRs is at its top.
      await page.locator('.alerts-list').evaluate((list) => {
        const group = list.querySelector('[aria-label="Open PRs"]');
        if (group) list.scrollTop += group.getBoundingClientRect().top - list.getBoundingClientRect().top;
      });
      await settle(page, 400);
    },
    items: [
      {
        sel: '.alerts-group[aria-label="Open PRs"] .file-pills',
        name: 'Open PRs',
        fed: "GitHub, once you connect it: the repository's open pull requests, in the PRs tab's order. Titles are hidden in Streaming Mode.",
        click: 'Opens it on GitHub.',
      },
      {
        sel: '.file-pill-branch.branch-current',
        name: 'Your branch',
        fed: 'Git: the branch checked out here, in bold and listed first, with how many commits it is behind main (↓) and ahead of it (↑).',
        click: "Opens GitHub's comparison with main, once the branch is pushed.",
      },
      {
        sel: '.file-pill-branch:not(.branch-current)',
        name: 'Branch ahead of main',
        fed: 'Git: each local branch with commits main lacks, newest first, as *↓behind | ↑ahead*. Names are hidden in Streaming Mode.',
        click: "Opens GitHub's comparison with main. A branch that was never pushed isn't a button.",
      },
    ],
  },
  {
    id: 'tour',
    short: 'Tour mode',
    group: 'mode',
    title: 'Tour mode',
    intro: 'The view and nothing in front of it: no dashboard, no strip and no windshield line while the car drives. When the car stops, the dashboard comes up with the stop pill, and goes again when the drive resumes. The top bar shows when you move the mouse and fades after a few seconds. Press `T`.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits');
      await mode(page, 't');
      await page.mouse.move(640, 300);
      await settle(page, 900);
    },
    items: [
      { sel: '.topbar', name: 'Top bar', fed: 'The same buttons as on the dashboard.', click: 'See *The dashboard*, 1–6.' },
      BELL,
    ],
  },
  {
    id: 'work',
    short: 'Work mode',
    group: 'mode',
    title: 'Work mode',
    intro: 'Your work in panels over a blurred view. In VS Code, Work mode takes you back to the editor instead, so these panels show on a Companion Display and in the browser. Press `W`.',
    async setup(page) {
      await depart(page);
      await demo(page, 'Agent edits', 'Errors');
      await mode(page, 'w');
      await settle(page, 1_000);
    },
    items: [
      { sel: '.work-header .btn', name: 'Back to the view', fed: '—', click: 'Back to Tour mode. Key `T`.' },
      { sel: '.work-explorer', name: 'Explorer', fed: 'The active file, branch, changes, sync, last commit and files touched.', click: NONE },
      { sel: '.work-problems', name: 'Problems', fed: 'Errors and warnings from Problems.', click: 'Opens the file at that line in VS Code.' },
      { sel: '.work-agents', name: 'Agents', fed: 'Your agents and their status.', click: NONE },
      { sel: '.work-terminal', name: 'Terminal', fed: 'Running commands and recent results.', click: NONE },
      { sel: '.work-journey', name: 'Journey', fed: 'The route map and where you are.', click: NONE },
    ],
  },
];
