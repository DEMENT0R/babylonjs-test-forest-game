// Точка входа: движок, сцены и переключение состояний меню → выбор героя → игра.

import { Engine, Vector3 } from '@babylonjs/core';
import { CameraRig } from './camera';
import { loadHero, type HeroDef } from './heroes';
import { clearInput, keys, Player, setupTouchControls } from './player';
import { applySettings } from './settings';
import { say, setCrystals, setupHud, showCameraMode, tickFps } from './ui/hud';
import { MainMenu } from './ui/menu';
import { SelectScreen } from './ui/select';
import { SettingsPanel } from './ui/settings-panel';
import { byId } from './utils';
import { World } from './world';

type GameState = 'menu' | 'select' | 'play';

const canvas = byId<HTMLCanvasElement>('c');
const engine = new Engine(canvas, true, { stencil: true });

let state: GameState = 'menu';
/** Игра уже начиналась — в меню доступно «Продолжить». */
let gameStarted = false;
let firstStart = true;
let loadingHero = false;

function setState(s: GameState): void {
  state = s;
  document.body.dataset.state = s;
}

// ---------- Сцены и системы ----------

const world = new World(engine);
const player = new Player(world);

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
  isActive: () => state === 'play' && !settingsPanel.isOpen,
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
  onNewGame: () => newGame(),
  onChangeHero: () => backToSelect(),
  onSettings: () => settingsPanel.open(),
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
  setState('play');
  gameStarted = true;
  canvas.focus();
  say(firstStart ? `${def.name}: собери кристаллы` : def.name);
  firstStart = false;
}

function backToSelect(): void {
  rig.releaseLock();
  rig.cancelDrag();
  menu.closeInfo();
  setState('select');
  select.chooseHero(player.hero?.def ?? select.selected);
}

function openMenu(): void {
  rig.releaseLock();
  rig.cancelDrag();
  clearInput();
  rig.beginMenuOrbit(gameStarted ? player.pos : Vector3.Zero());
  setState('menu');
  menu.update(
    gameStarted && player.hero
      ? { heroName: player.hero.def.name, got: world.collected, total: world.crystals.length }
      : null,
  );
  menu.focusFirst();
}

function resumeGame(): void {
  if (!gameStarted) return;
  menu.closeInfo();
  setState('play');
  canvas.focus();
}

function newGame(): void {
  world.resetCrystals();
  setCrystals(0, world.crystals.length);
  player.reset();
  rig.reset();
  backToSelect();
}

// ---------- Клавиатура ----------

addEventListener('keydown', (e) => {
  if (settingsPanel.isOpen) {
    settingsPanel.handleKey(e);
    return;
  }
  if (e.code === 'KeyO' && !e.repeat) {
    settingsPanel.open();
    return;
  }
  switch (state) {
    case 'menu':
      if (e.code === 'Escape' && gameStarted) {
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

// ---------- Игровой цикл ----------

world.scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  world.spinCrystals(dt);

  if (state === 'menu' || !player.hero) {
    const center = gameStarted ? player.pos : Vector3.Zero();
    rig.updateMenuOrbit(dt, center);
    world.followSun(center);
    player.idle(dt);
    return;
  }

  player.update(dt, { yaw: rig.yaw, modeId: rig.mode.id }, !settingsPanel.isOpen);
  world.followSun(player.pos);
  rig.update(dt, player);

  const got = world.collectNear(player.center);
  if (got > 0) {
    setCrystals(world.collected, world.crystals.length);
    say(world.collected === world.crystals.length ? 'Все кристаллы собраны!' : '+1 кристалл');
  }
});

engine.runRenderLoop(() => {
  (state === 'select' ? select.scene : world.scene).render();
  tickFps(engine);
});
addEventListener('resize', () => engine.resize());

// ---------- Старт ----------

applySettings(engine);
setState('menu');
setCrystals(0, world.crystals.length);
showCameraMode(rig.mode, false);
menu.update(null);
byId('m-new').focus();
void select.load();
