// Точка входа: движок, сцены и переключение состояний меню → выбор героя → игра,
// а внутри игры — смена уровней через портал.

import { Engine, Vector3 } from '@babylonjs/core';
import { Footsteps, GameAudio } from './audio';
import { CameraRig } from './camera';
import { BTN, gamepad } from './gamepad';
import { loadHero, type HeroDef } from './heroes';
import type { LevelLayout } from './levels/generator';
import { completeLevel, formatTime, progress, setCurrentLevel } from './levels/progress';
import { questGoal, QuestRun } from './levels/quests';
import { recipeFor } from './levels/recipes';
import { clearInput, keys, Player, setupTouchControls } from './player';
import { applySettings, settings } from './settings';
import { say, setCrystals, setHintLevel, setLevelTitle, setQuest, setupHud, showCameraMode, tickFps } from './ui/hud';
import { setupFullscreen, toggleFullscreen } from './ui/fullscreen';
import { MainMenu } from './ui/menu';
import { activate, navigate, sendKey } from './ui/pad-nav';
import { SelectScreen } from './ui/select';
import { SettingsPanel } from './ui/settings-panel';
import { isTransitioning, setTransitionText, transition } from './ui/transition';
import { byId } from './utils';
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

/** Текущий уровень и время, проведённое в нём (только в игре, без пауз). */
let level = progress.current;
let layout: LevelLayout;
let levelTime = 0;
let quest: QuestRun;

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

function updateCrystalsHud(): void {
  setCrystals(world.collected, world.crystals.length, layout.required, world.portalOpen);
}

function updateQuestHud(): void {
  setQuest(questGoal(quest.quest), quest.status, quest.failed ? 'failed' : 'active');
}

/** Построить уровень и поставить героя на старт. */
function beginLevel(index: number): void {
  level = index;
  setCurrentLevel(index);
  const recipe = recipeFor(index);
  layout = world.loadLevel(recipe);
  quest = new QuestRun(recipe.quest);
  audio.setAmbience(layout.biome.ambience);
  wind.setScale(layout.biome.ambience.wind);
  player.reset(layout.spawn);
  rig.reset();
  footsteps.reset();
  levelTime = 0;
  setLevelTitle(levelLabel(index, layout));
  setHintLevel(index);
  updateCrystalsHud();
  updateQuestHud();
}

function restartLevel(): void {
  beginLevel(level);
  resumeGame();
}

/** Выбор уровня в меню: строим его и сразу играем (или сначала выбираем героя). */
function pickLevel(index: number): void {
  beginLevel(index);
  if (player.hero) {
    gameStarted = true;
    resumeGame();
    say(levelLabel(index, layout));
  } else {
    backToSelect();
  }
}

/** Герой зашёл в открытый портал: запись результата и переход на следующий уровень. */
function finishLevel(): void {
  const star = world.collected === world.crystals.length;
  const time = levelTime;
  const questDone = quest.passed();
  completeLevel(level, star, questDone, time);
  audio.portalEnter();
  rig.releaseLock();
  clearInput();
  const next = level + 1;
  void transition(
    {
      eyebrow: `Уровень ${level} пройден · ${formatTime(time)}${star ? ' · ★ все кристаллы' : ''}${questDone ? ' · ★ задание' : ''}`,
      title: `Уровень ${next}`,
      sub: '',
    },
    () => {
      beginLevel(next);
      setTransitionText({
        title: levelLabel(next, layout),
        sub: `Кристаллов: ${layout.crystals.length}, портал откроется после ${layout.required}. ${quest.quest.intro}: ${questGoal(quest.quest).toLowerCase()}`,
      });
    },
  ).then(() => canvas.focus());
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
  say(gameStarted ? def.name : `${levelLabel(level, layout)} — собери кристаллы`);
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
      ? { heroName: player.hero.def.name, level, got: world.collected, total: world.crystals.length }
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
    return;
  }

  const active = !settingsPanel.isOpen && !isTransitioning();
  if (active) {
    levelTime += dt;
    const wasFailed = quest.failed;
    quest.tick(dt, player);
    if (quest.failed && !wasFailed) say('Задание провалено — но уровень можно пройти');
    updateQuestHud();
  }
  player.update(dt, { yaw: rig.yaw, modeId: rig.mode.id }, active);
  world.followSun(player.pos);
  rig.update(dt, player);
  footsteps.update(dt, player);

  const got = world.collectNear(player.center);
  if (got > 0) {
    const all = world.collected === world.crystals.length;
    audio.chime(all);
    if (!world.portalOpen && world.collected >= layout.required) {
      world.openPortal();
      audio.portalOpen();
      say(all ? 'Все кристаллы! ★ Портал открыт' : 'Портал открыт — он в каменном круге');
    } else {
      say(all ? 'Все кристаллы собраны! ★' : '+1 кристалл');
    }
    updateCrystalsHud();
  }
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
