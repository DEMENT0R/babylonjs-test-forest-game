// Точка входа: движок, сцены и переключение состояний меню → выбор героя → игра,
// а внутри игры — смена уровней через портал.

import { Color3, Engine, Vector3 } from '@babylonjs/core';
import { Footsteps, GameAudio } from './audio';
import { Breath } from './breath';
import { CameraRig } from './camera';
import { BTN, gamepad } from './gamepad';
import { HEROES, loadHero, type HeroDef } from './heroes';
import { addShade, journal, RARE_CHANCE, SHADES } from './journal';
import type { LevelLayout } from './levels/generator';
import { completeDaily, completeLevel, dailyBest, formatTime, markPlayedToday, progress, setCurrentLevel, todayKey, totalStars } from './levels/progress';
import { QuestMarkers } from './levels/markers';
import { fitQuest, QuestRun } from './levels/quests';
import { dailyRecipe, recipeFor } from './levels/recipes';
import { clearInput, keys, Player, setupTouchControls } from './player';
import { Ripples } from './ripples';
import { applySettings, settings } from './settings';
import { StarSky } from './starsky';
import { say, setCrystals, setHintLevel, setLevelTitle, setQuest, setupHud, showCameraMode, tickFps } from './ui/hud';
import { setupFullscreen, toggleFullscreen } from './ui/fullscreen';
import { MainMenu } from './ui/menu';
import { activate, navigate, sendKey } from './ui/pad-nav';
import { SelectScreen, starsMissing } from './ui/select';
import { SettingsPanel } from './ui/settings-panel';
import { isTransitioning, setTransitionText, transition } from './ui/transition';
import { byId, plural } from './utils';
import { wind } from './wind';
import { World } from './world';

type GameState = 'menu' | 'select' | 'play';

const canvas = byId<HTMLCanvasElement>('c');
const engine = new Engine(canvas, true, { stencil: true });

let state: GameState = 'menu';
/** Игра уже начиналась — в меню доступно «Продолжить». */
let gameStarted = false;
let loadingHero = false;

function setState(s: GameState): void {
  state = s;
  document.body.dataset.state = s;
}

// ---------- Сцены и системы ----------

const world = new World(engine);
const player = new Player(world);
const audio = new GameAudio();
const footsteps = new Footsteps(audio, world);
const ripples = new Ripples(world.scene);
const breath = new Breath(world.scene);
const starSky = new StarSky(world.scene, world.camera, world.lighting.glow);

/** Текущий уровень кампании и время, проведённое в нём (только в игре, без пауз). */
let level = progress.current;
/** Дата «Леса дня», если сейчас идёт он, а не уровень кампании. */
let daily: string | null = null;
let layout: LevelLayout;
let levelTime = 0;
let quest: QuestRun;
/** Номер редкого кристалла на уровне; -1 — его нет. */
let rare = -1;
let markers: QuestMarkers | null = null;

// Браузер включает звук только после действия пользователя — первый клик или клавиша
for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => audio.unlock(), { capture: true });

function toggleSound(): void {
  settings.sound = !settings.sound;
  applySettings(engine);
  say(settings.sound ? 'Звук включён' : 'Звук выключен');
}

const settingsPanel = new SettingsPanel(
  engine,
  () => {
    rig.releaseLock();
    rig.cancelDrag();
    clearInput();
  },
  () => (state === 'menu' ? menu.focusSettings() : canvas.focus()),
);

const rig = new CameraRig(world, canvas, {
  isActive: () => state === 'play' && !settingsPanel.isOpen && !isTransitioning(),
  onPointerLockLost: () => {
    if (state === 'play' && !settingsPanel.isOpen) openMenu();
  },
  onModeChange: (mode) => showCameraMode(mode),
});

const select = new SelectScreen(engine, {
  onStart: (def) => void startGame(def),
  onBack: () => openMenu(),
  onSettings: () => settingsPanel.open(),
  isBlocked: () => settingsPanel.isOpen,
});

const menu = new MainMenu({
  onContinue: () => resumeGame(),
  onNewGame: () => (gameStarted ? restartLevel() : backToSelect()),
  onChangeHero: () => backToSelect(),
  onSettings: () => settingsPanel.open(),
  onPickLevel: (i) => pickLevel(i),
  onDaily: () => pickLevel(level, todayKey()),
});

setupHud({
  onMenu: () => openMenu(),
  onHeroSelect: () => backToSelect(),
  onSettings: () => settingsPanel.open(),
  onCycleCamera: () => {
    rig.cycleMode();
    canvas.focus();
  },
});
setupTouchControls();
setupFullscreen();

// ---------- Уровни ----------

const levelLabel = (i: number, l: LevelLayout) => `Уровень ${i} · ${l.biome.name}`;
const currentLabel = () => (daily ? `Лес дня · ${layout.biome.name}` : levelLabel(level, layout));

function updateCrystalsHud(): void {
  setCrystals(world.collected, world.crystals.length, layout.required, world.portalOpen);
}

function updateQuestHud(): void {
  setQuest(quest.goal, quest.status, quest.failed ? 'failed' : quest.complete ? 'done' : 'active');
}

/** Столбы света над полянами или озёрами, куда зовёт задание: озёра — голубые, поляны — золотые. */
function placeMarkers(): void {
  markers?.dispose();
  const places = quest.places;
  const swim = quest.quest.kind === 'swim';
  markers = places.length
    ? new QuestMarkers(
        world.scene,
        world.lighting,
        places.map((p) => ({ ...p, y: swim ? (layout.waterLevel ?? 0) : world.terrainAt(p.x, p.z) })),
        swim ? new Color3(0.3, 0.7, 1) : new Color3(1, 0.82, 0.45),
      )
    : null;
}

/** Задание следит за героем после его шага: прыжок, вода, поляны, собранные кристаллы. */
function tickQuest(dt: number, got: number[]): void {
  const was = { failed: quest.failed, complete: quest.complete };
  const { x, y, z } = player.pos;
  const surface = layout.waterLevel;
  quest.tick(dt, {
    x,
    z,
    running: player.running,
    jumped: player.jumped,
    onGround: player.onGround,
    wet: surface !== null && y < surface ? world.waterDepth(x, z) : 0,
  });
  quest.onCollect(got);
  markers?.update(dt, (id) => quest.reachedTarget(id));
  // Ночью садиться нечему
  if (quest.quest.kind === 'time' && !layout.biome.crystalLights) world.setDusk(quest.timeShare);
  if (quest.failed && !was.failed) say('Задание провалено — но уровень можно пройти');
  else if (quest.complete && !was.complete) say(`Задание выполнено${daily ? '' : ' ★'} — осталось дойти до портала`);
  updateQuestHud();
}

/** Построить уровень (или «Лес дня» на дату dailyDate) и поставить героя на старт. */
function beginLevel(index: number, dailyDate: string | null = null): void {
  daily = dailyDate;
  if (!daily) {
    level = index;
    setCurrentLevel(index);
  }
  const recipe = daily ? dailyRecipe(daily) : recipeFor(index);
  layout = world.loadLevel(recipe);
  quest = new QuestRun(fitQuest(recipe.quest, layout), layout);
  rare = Math.random() < RARE_CHANCE ? Math.floor(Math.random() * world.crystals.length) : -1;
  if (rare >= 0) world.markRare(rare, new Color3(...SHADES[layout.biome.id].color));
  placeMarkers();
  starSky.show(!!layout.biome.starSky, totalStars());
  audio.setAmbience(layout.biome.ambience);
  audio.setMusic(layout.biome.id);
  wind.setScale(layout.biome.ambience.wind);
  player.reset(layout.spawn);
  rig.reset();
  footsteps.reset();
  ripples.clear();
  levelTime = 0;
  setLevelTitle(currentLabel());
  setHintLevel(level);
  updateCrystalsHud();
  updateQuestHud();
}

/** Редкий кристалл: в коллекцию оттенков дневника. */
function foundRare(): void {
  const biome = layout.biome.id;
  const n = addShade(biome);
  const shade = SHADES[biome];
  const found = Object.values(journal.shades).filter(Boolean).length;
  audio.chime(true);
  say(n === 1 ? `Редкий кристалл! Новый оттенок «${shade.name}» — ${found} из ${Object.keys(SHADES).length}` : `Редкий кристалл «${shade.name}» · ×${n}`, 3000);
}

function restartLevel(): void {
  beginLevel(level, daily);
  resumeGame();
}

/** Выбор уровня или «Леса дня» в меню: строим его и сразу играем (или сначала выбираем героя). */
function pickLevel(index: number, dailyDate: string | null = null): void {
  beginLevel(index, dailyDate);
  if (player.hero) {
    gameStarted = true;
    resumeGame();
    say(currentLabel());
  } else {
    backToSelect();
  }
}

/**
 * «Почти!» на экране итога: рекорд, упущенный на считаные секунды, или сколько звёзд
 * осталось до следующего героя — то, ради чего хочется сыграть ещё раз.
 */
function almost(time: number, best: number | undefined, opened: readonly HeroDef[]): string[] {
  const out: string[] = [];
  if (opened.length) out.push(`Открыт новый герой: ${opened.map((h) => h.name).join(', ')}`);
  const behind = best === undefined ? 0 : Math.floor(time) - Math.floor(best);
  if (behind > 0 && behind <= 15) out.push(`Почти! До рекорда не хватило ${behind} ${plural(behind, 'секунды', 'секунд', 'секунд')}`);
  const hero = HEROES.find((h) => starsMissing(h) > 0);
  if (hero && !daily) {
    const n = starsMissing(hero);
    out.push(`Ещё ${n} ★ — и откроется ${hero.name.toLowerCase()}`);
  }
  return out;
}

/** Время на экране итога; рекорд сравнивается по показанным секундам, чтобы «0:42, рекорд 0:42» не звалось новым. */
function timeText(time: number, best: number | undefined): string {
  if (best === undefined) return formatTime(time);
  return Math.floor(time) < Math.floor(best) ? `${formatTime(time)} · новый рекорд!` : `${formatTime(time)} (рекорд ${formatTime(best)})`;
}

/**
 * Герой зашёл в открытый портал: запись результата и переход на следующий уровень.
 * После «Леса дня» игра возвращается к текущему уровню кампании.
 */
function finishLevel(): void {
  const time = levelTime;
  let eyebrow: string;
  let opened: HeroDef[] = [];
  let best: number | undefined;
  if (daily) {
    best = dailyBest(daily);
    completeDaily(daily, time);
    eyebrow = `Лес дня пройден · ${timeText(time, best)}`;
  } else {
    const star = world.collected === world.crystals.length;
    const questDone = quest.passed();
    best = progress.records[level]?.time;
    const lockedBefore = HEROES.filter((h) => starsMissing(h) > 0);
    completeLevel(level, star, questDone, time);
    opened = lockedBefore.filter((h) => !starsMissing(h));
    select.refreshLocks();
    eyebrow = `Уровень ${level} пройден · ${timeText(time, best)}${star ? ' · ★ все кристаллы' : ''}${questDone ? ' · ★ задание' : ''}`;
  }
  const streak = markPlayedToday();
  const notes: string[] = [];
  if (streak === 1) notes.push('🔥 Серия началась — загляни в лес и завтра');
  else if (streak) notes.push(`🔥 ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд!`);
  notes.push(...almost(time, best, opened));
  audio.portalEnter();
  rig.releaseLock();
  clearInput();
  const next = daily ? level : level + 1;
  void transition(
    { eyebrow, title: `Уровень ${next}`, sub: '', note: notes.join('\n') },
    () => {
      beginLevel(next);
      setTransitionText({
        title: levelLabel(next, layout),
        sub: `Кристаллов: ${layout.crystals.length}, портал откроется после ${layout.required}. ${quest.quest.intro}: ${quest.goal.toLowerCase()}`,
      });
    },
  ).then(() => {
    canvas.focus();
    if (opened.length) say(`Открыт новый герой: ${opened.map((h) => h.name).join(', ')} — смени его клавишей H`);
  });
}

// ---------- Переходы между состояниями ----------

async function startGame(def: HeroDef): Promise<void> {
  if (!select.ready || loadingHero) return;
  loadingHero = true;
  select.setBusy(true);
  try {
    if (player.hero?.def !== def) player.setHero(await loadHero(def, world.lighting));
  } catch (err) {
    console.error(err);
    say('Не удалось загрузить героя');
    return;
  } finally {
    loadingHero = false;
    select.setBusy(false);
  }
  clearInput();
  footsteps.reset();
  setState('play');
  canvas.focus();
  say(gameStarted ? def.name : `${currentLabel()} — собери кристаллы`);
  gameStarted = true;
}

function backToSelect(): void {
  rig.releaseLock();
  rig.cancelDrag();
  menu.closeInfo();
  setState('select');
  select.chooseHero(player.hero?.def ?? select.selected);
}

function openMenu(): void {
  if (isTransitioning()) return;
  rig.releaseLock();
  rig.cancelDrag();
  clearInput();
  rig.beginMenuOrbit(gameStarted ? player.pos : new Vector3(layout.spawn.x, world.terrainAt(layout.spawn.x, layout.spawn.z), layout.spawn.z));
  setState('menu');
  menu.update(
    gameStarted && player.hero
      ? { heroName: player.hero.def.name, place: daily ? 'Лес дня' : `Уровень ${level}`, got: world.collected, total: world.crystals.length }
      : null,
  );
  menu.focusFirst();
}

function resumeGame(): void {
  if (!gameStarted) return;
  menu.closeInfo();
  footsteps.reset();
  setState('play');
  canvas.focus();
}

// ---------- Клавиатура ----------

addEventListener('keydown', (e) => {
  if (settingsPanel.isOpen) {
    settingsPanel.handleKey(e);
    return;
  }
  if (isTransitioning()) return;
  if (e.code === 'KeyO' && !e.repeat) {
    settingsPanel.open();
    return;
  }
  if (e.code === 'KeyM' && !e.repeat) {
    toggleSound();
    return;
  }
  if (e.code === 'KeyF' && !e.repeat) {
    toggleFullscreen();
    return;
  }
  switch (state) {
    case 'menu':
      if (e.code === 'Escape' && gameStarted && !menu.isInfoOpen) {
        e.preventDefault();
        resumeGame();
      } else {
        menu.handleKey(e);
      }
      return;
    case 'select':
      if (e.code === 'Escape') openMenu();
      else select.handleKey(e);
      return;
    case 'play':
      if (e.code === 'Escape') {
        openMenu();
        return;
      }
      keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyC' && !e.repeat) rig.cycleMode();
      if (e.code === 'KeyH' && !e.repeat) backToSelect();
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('blur', clearInput);

// ---------- Геймпад ----------

addEventListener('gamepadconnected', () => say('Геймпад подключён'));
// Подсказки показывают кнопки того устройства, которым пользовались последним
const setInputKind = (kind: 'pad' | 'keys') => {
  if (document.body.dataset.input !== kind) document.body.dataset.input = kind;
};
for (const type of ['keydown', 'pointerdown', 'pointermove'] as const) {
  addEventListener(type, (e) => e.isTrusted && setInputKind('keys'), { capture: true, passive: true });
}
addEventListener('gamepaddisconnected', () => say('Геймпад отключён'));
// Пока подключён геймпад, сенсорные стик и кнопка прыжка не нужны и только закрывают обзор
let padConnected = false;
const syncPadConnected = () => {
  if (gamepad.connected === padConnected) return;
  padConnected = gamepad.connected;
  document.body.toggleAttribute('data-pad', padConnected);
};

/** Экран, по которому сейчас ходит фокус геймпада; null — идёт игра. */
function padScreen(): HTMLElement | null {
  if (settingsPanel.isOpen) return byId('settings');
  if (state === 'menu') return byId('menu');
  if (state === 'select') return byId('select');
  return null;
}

/**
 * Кнопки геймпада вне движения и камеры: в игре Start — пауза, Y — режим камеры,
 * View/Back — настройки; в меню крестовина или стик водят фокус, A — выбрать, B — назад.
 */
function handleGamepad(): void {
  if (!gamepad.connected || isTransitioning()) return;
  if (gamepad.pressed(BTN.BACK)) {
    if (settingsPanel.isOpen) settingsPanel.close();
    else settingsPanel.open();
    return;
  }
  const screen = padScreen();
  if (!screen) {
    if (gamepad.pressed(BTN.START)) openMenu();
    else if (gamepad.pressed(BTN.Y)) rig.cycleMode();
    return;
  }
  const dir = gamepad.nav();
  if (dir) navigate(screen, dir);
  if (settingsPanel.isOpen) {
    if (gamepad.pressed(BTN.LB)) settingsPanel.switchTab(-1);
    if (gamepad.pressed(BTN.RB)) settingsPanel.switchTab(1);
  }
  if (gamepad.pressed(BTN.A)) {
    // На выборе героя A играет выбранным героем, если фокус не на кнопках внизу
    const onFootBtn = document.activeElement?.closest('.sel-foot button:not(#play)');
    if (state === 'select' && !settingsPanel.isOpen && !onFootBtn) sendKey('Enter');
    else activate(screen);
    // «Продолжить» по A не должно тут же подбросить героя в прыжке
    gamepad.consume(BTN.A);
  }
  if (gamepad.pressed(BTN.B) || (gamepad.pressed(BTN.START) && state === 'menu')) sendKey('Escape');
}

// ---------- Игровой цикл ----------

world.scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  // Траву приминает герой, стоящий на поляне (в меню — тоже, он там просто стоит)
  world.update(dt, player.hero ? player.pos : null, 0.3 + 0.35 * (player.hero?.def.height ?? 0));

  if (state === 'menu' || !player.hero) {
    const center = gameStarted ? player.pos : new Vector3(layout.spawn.x, world.terrainAt(layout.spawn.x, layout.spawn.z), layout.spawn.z);
    rig.updateMenuOrbit(dt, center);
    world.followSun(center);
    player.idle(dt);
    ripples.update(dt, null, null, 0, 0);
    breath.update(dt, player.hero, false, !!layout.biome.frost);
    return;
  }

  const active = !settingsPanel.isOpen && !isTransitioning();
  if (active) levelTime += dt;
  player.update(dt, { yaw: rig.yaw, modeId: rig.mode.id }, active);
  world.followSun(player.pos);
  rig.update(dt, player);
  footsteps.update(dt, player);
  breath.update(dt, player.hero, player.running, !!layout.biome.frost);
  ripples.update(dt, player.pos, layout.waterLevel, world.waterDepth(player.pos.x, player.pos.z), -player.vel.y);

  const got = world.collectNear(player.center);
  if (got.length > 0) {
    const all = world.collected === world.crystals.length;
    audio.chime(all);
    if (!world.portalOpen && world.collected >= layout.required) {
      world.openPortal();
      audio.portalOpen();
      say(all ? 'Все кристаллы! ★ Портал открыт' : 'Портал открыт — он в каменном круге');
    } else {
      say(all ? 'Все кристаллы собраны! ★' : '+1 кристалл');
    }
    if (got.includes(rare)) foundRare();
    updateCrystalsHud();
  }
  // После надписи о кристалле — чтобы весть о задании её перекрыла, а не наоборот
  if (active) tickQuest(dt, got);
  if (active && world.inPortal(player.pos)) finishLevel();
});

engine.runRenderLoop(() => {
  gamepad.poll();
  if (gamepad.used) setInputKind('pad');
  syncPadConnected();
  handleGamepad();
  wind.update(Math.min(engine.getDeltaTime() / 1000, 0.1));
  (state === 'select' ? select.scene : world.scene).render();
  tickFps(engine);
});
addEventListener('resize', () => engine.resize());

// ---------- Старт ----------

applySettings(engine);
beginLevel(level);
setState('menu');
showCameraMode(rig.mode, false);
menu.update(null);
byId('m-new').focus();
void select.load();

// Для отладки из консоли браузера; в production-сборку не попадает
if (import.meta.env.DEV) Object.assign(window, { __game: { world, player, rig, beginLevel, get layout() { return layout; }, get quest() { return quest; } } });
