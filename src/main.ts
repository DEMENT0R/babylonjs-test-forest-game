// Точка входа: движок, сцены и переключение состояний меню → выбор героя → игра,
// а внутри игры — смена уровней через портал.

import './fonts';
import { Color3, Vector3 } from '@babylonjs/core';
import { Footsteps, GameAudio } from './audio';
import { Breath } from './breath';
import { checkAchievements } from './achievements';
import { CameraRig } from './camera';
import { Combo, comboTier, WIND_FROM } from './combo';
import { skyFor } from './constellations';
import { BTN, gamepad } from './gamepad';
import { applyCoat, coatFor, COATS, HEROES, loadHero, openCoats, type HeroDef } from './heroes';
import {
  addNote,
  addShade,
  journal,
  NOTE_CHANCE,
  NOTES,
  RARE_CHANCE,
  save as saveJournal,
  SHADES,
  takeWelcome,
  welcomeNote,
} from './journal';
import type { LevelLayout } from './levels/generator';
import { amount, boostById, HONEY_WIND, materialOf, type BoostId } from './den/catalog';
import { DECOR } from './den/decor';
import { clearUrl, snapshotFromUrl } from './den/snapshot';
import { addMaterial, staminaWithPowers, takePacked } from './den/state';
import { completeDaily, completeLevel, dailyBest, daysPlayed, formatTime, markPlayedToday, progress, setCurrentLevel, todayKey, totalStars } from './levels/progress';
import { QuestMarkers } from './levels/markers';
import { fitQuest, QuestRun } from './levels/quests';
import { dailyRecipe, recipeFor } from './levels/recipes';
import { clearInput, keys, Player, setupTouchControls, setWalkLock, walkLocked } from './player';
import { setupPwa } from './pwa';
import { Ripples } from './ripples';
import { deviceTier, isMobile } from './device';
import { AutoScale, GameEngine } from './perf';
import { applySettings, pickPresetForDevice, settings } from './settings';
import { Sparks } from './sparks';
import { StarSky } from './starsky';
import { BASE_STAMINA, CRYSTAL_ENERGY, DASH_COST } from './stamina';
import {
  clearCombo,
  endCombo,
  say,
  setBoostLine,
  setComboLeft,
  setCrystals,
  setEnergy,
  setFirefly,
  setHintLevel,
  setLevelTitle,
  setQuest,
  setupHud,
  showCameraMode,
  showCombo,
  tickFps,
} from './ui/hud';
import { setupFullscreen, toggleFullscreen } from './ui/fullscreen';
import { MainMenu } from './ui/menu';
import { activate, navigate, sendKey } from './ui/pad-nav';
import { DenScreen } from './ui/den';
import { SelectScreen, starsMissing } from './ui/select';
import { SettingsPanel } from './ui/settings-panel';
import { continueTransition, isTransitioning, setTransitionText, transition } from './ui/transition';
import { freshUnlocks, isOpen, syncLocks } from './unlocks';
import { byId, plural, wrapAngle } from './utils';
import { wind } from './wind';
import { World } from './world';

type GameState = 'menu' | 'select' | 'play' | 'den';

const canvas = byId<HTMLCanvasElement>('c');
// Кадр всё равно идёт через пост-обработку, и сглаживание самого холста на телефоне
// только тратит память и время видеочипа
const engine = new GameEngine(canvas, !isMobile, { stencil: true });
const autoScale = new AutoScale(engine);
const PRESET_NAMES = { low: 'низкая', medium: 'средняя', high: 'высокая', ultra: 'ультра' } as const;
const picked = pickPresetForDevice(engine);
/** Весть о подобранной графике — покажется, когда игра начнётся. */
let presetNote = picked && `Графика подобрана под устройство: ${PRESET_NAMES[picked]} — можно поменять в настройках`;

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
// Телефону и программному рендеру — облегчённый звук: иначе аудиопоток не успевает и трещит
const audio = new GameAudio(isMobile || deviceTier(engine.getGlInfo().renderer) === 'weak');
const footsteps = new Footsteps(audio, world);
const ripples = new Ripples(world.scene);
const breath = new Breath(world.scene);
const sparks = new Sparks(world.scene);
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
const combo = new Combo();
/** «Ветер в спину» на длинной серии: во сколько раз быстрее бег и шаг. */
const WIND_BOOST = 1.15;
let markers: QuestMarkers | null = null;
/** Усилитель из котелка, взятый на этот уровень. */
let activeBoost: BoostId | null = null;
/** Уровень ещё не начали играть: усилитель возьмётся с первым кадром игры, а не когда уровень построен для фона меню. */
let boostPending = false;
/** Материалов для норы подобрано на этом уровне. */
let gathered = 0;
/** Сколько материалов разложить на уровне: от и до. */
const PICKUPS = [2, 4] as const;

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

const den = new DenScreen(engine, {
  onBack: () => openMenu(),
  chime: () => audio.chime(true),
});

const menu = new MainMenu({
  onContinue: () => resumeGame(),
  onNewGame: () => (gameStarted ? restartLevel() : backToSelect()),
  onChangeHero: () => backToSelect(),
  onSettings: () => settingsPanel.open(),
  onPickLevel: (i) => pickLevel(i),
  onDaily: () => pickLevel(level, todayKey()),
  onDen: () => openDen(),
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
/** «Шагом» по кнопке на экране, клавише X или L3 на геймпаде. */
function toggleWalk(): void {
  setWalkLock(!walkLocked());
  say(walkLocked() ? 'Шагом — бег выключен' : 'Можно бежать');
}

setupTouchControls(toggleWalk);
setupFullscreen();
setupPwa();

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

/**
 * Построить уровень (или «Лес дня» на дату dailyDate) и поставить героя на старт.
 * Новый уровень берёт с собой усилитель из котелка; keepBoost — рестарт того же, усилитель остаётся прежний.
 */
function beginLevel(index: number, dailyDate: string | null = null, keepBoost = false): void {
  daily = dailyDate;
  if (!keepBoost || daily) activeBoost = null;
  boostPending = !daily && !keepBoost;
  showBoost();
  setFirefly(null);
  if (!daily) {
    level = index;
    setCurrentLevel(index);
  }
  const recipe = daily ? dailyRecipe(daily) : recipeFor(index);
  layout = world.loadLevel(recipe);
  quest = new QuestRun(fitQuest(recipe.quest, layout), layout);
  rare = Math.random() < RARE_CHANCE ? Math.floor(Math.random() * world.crystals.length) : -1;
  if (rare >= 0) world.markRare(rare, new Color3(...SHADES[layout.biome.id].color));
  // После долгого перерыва записка ждёт у старта; иначе изредка лежит на боковой поляне
  const spot = welcomeNote ? welcomeSpot() : journal.notes < NOTES.length && Math.random() < NOTE_CHANCE ? noteSpot() : null;
  if (spot) world.placeNote(spot.x, spot.z);
  placePickups();
  placeMarkers();
  starSky.show(!!layout.biome.starSky, totalStars());
  audio.setAmbience(layout.biome.ambience);
  audio.setMusic(layout.biome.id);
  wind.setScale(layout.biome.ambience.wind);
  // В задании «ни разу не побежав» шаг включается сам, на других уровнях — выключен
  setWalkLock(quest.quest.kind === 'walk');
  syncLocks(quest.quest.kind === 'walk' ? ['walk'] : []);
  applyStamina();
  player.reset(layout.spawn);
  rig.reset();
  footsteps.reset();
  ripples.clear();
  levelTime = 0;
  combo.reset();
  clearCombo();
  setLevelTitle(currentLabel());
  setHintLevel(level);
  updateCrystalsHud();
  updateQuestHud();
  autoScale.hold(3);
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

/**
 * Место для камня с запиской: на боковой поляне, не в дереве, не на платформе,
 * не в воде и не вплотную к кристаллу. null — подходящего места не нашлось.
 */
function noteSpot(): { x: number; z: number } | null {
  const side = layout.clearings.slice(1);
  for (let t = 0; t < 60 && side.length; t++) {
    const c = side[Math.floor(Math.random() * side.length)];
    const a = Math.random() * Math.PI * 2, r = Math.random() * c.r * 0.7;
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (freeSpot(x, z)) return { x, z };
  }
  return null;
}

/** Материалы для норы — свой у каждого биома — лежат на полянах и в лесу между ними. */
function placePickups(): void {
  gathered = 0;
  const id = materialOf(layout.biome.id).id;
  const n = PICKUPS[0] + Math.floor(Math.random() * (PICKUPS[1] - PICKUPS[0] + 1));
  const placed: { x: number; z: number }[] = [];
  const lim = layout.half * 0.85;
  for (let t = 0; t < 200 && placed.length < n; t++) {
    const x = (Math.random() * 2 - 1) * lim, z = (Math.random() * 2 - 1) * lim;
    // Не у самого старта и не кучей: каждый — повод свернуть с пути к кристаллам
    if (Math.hypot(x - layout.spawn.x, z - layout.spawn.z) < 12) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 15)) continue;
    if (!freeSpot(x, z)) continue;
    world.placePickup(x, z, id);
    placed.push({ x, z });
  }
}

/** Место для записки, которая ждала игрока: впереди от старта, по пути к порталу. */
function welcomeSpot(): { x: number; z: number } | null {
  const { x: sx, z: sz } = layout.spawn;
  const ahead = Math.atan2(layout.portal.z - sz, layout.portal.x - sx);
  for (let t = 0; t < 12; t++) {
    const a = ahead + (t % 2 ? 1 : -1) * (0.25 + Math.floor(t / 2) * 0.2);
    const x = sx + Math.cos(a) * 5.5, z = sz + Math.sin(a) * 5.5;
    if (freeSpot(x, z)) return { x, z };
  }
  return noteSpot();
}

/** Точка свободна: не в дереве, не на платформе, не в воде и не вплотную к кристаллу. */
function freeSpot(x: number, z: number): boolean {
  return (
    layout.obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + 1) &&
    layout.platforms.every((p) => Math.abs(p.x - x) > p.w / 2 + 1 || Math.abs(p.z - z) > p.d / 2 + 1) &&
    layout.crystals.every((c) => Math.hypot(c.x - x, c.z - z) > 2) &&
    (layout.waterLevel === null || world.terrainAt(x, z) > layout.waterLevel + 0.2)
  );
}

/**
 * Запал с апгрейдами из норы и усилителем уровня; в Лесу дня у всех одинаковый — базовый.
 * Пока запал не открыт, особых движений нет вовсе: первые уровни — про бег, прыжок и кристаллы.
 */
function applyStamina(): void {
  player.special = isOpen('stamina');
  player.stamina = daily ? { ...BASE_STAMINA } : staminaWithPowers();
  if (activeBoost === 'feather') player.stamina.glide = true;
  player.regenScale = activeBoost === 'tea' ? 2 : 1;
  player.energy = Math.min(player.energy, player.stamina.max);
}

function showBoost(): void {
  const boost = activeBoost && boostById(activeBoost);
  setBoostLine(boost ? `${boost.name}: ${boost.desc[0].toLowerCase()}${boost.desc.slice(1)}` : null);
}

/** Уровень начался: взятый с собой усилитель тратится и сразу действует. */
function startBoost(): void {
  boostPending = false;
  activeBoost = takePacked();
  if (!activeBoost) return;
  showBoost();
  applyStamina();
  player.energy = player.stamina.max;
  if (activeBoost === 'honeycomb') wind.gustNow(1.1, 0.5);
  say(`С собой: ${boostById(activeBoost)!.name}`, 2200);
}

/** Светлячок: направление на ближайший несобранный кристалл относительно камеры. */
function updateFirefly(): void {
  if (activeBoost !== 'firefly') return;
  let best: Vector3 | null = null;
  let bestD = Infinity;
  for (const c of world.crystals) {
    if (!c.mesh.isEnabled()) continue;
    const d = Vector3.DistanceSquared(c.mesh.position, player.pos);
    if (d < bestD) {
      bestD = d;
      best = c.mesh.position;
    }
  }
  setFirefly(best && wrapAngle(Math.atan2(best.x - player.pos.x, best.z - player.pos.z) - rig.yaw));
}

function restartLevel(): void {
  beginLevel(level, daily, true);
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
  const coat = COATS.find((c) => c.stars > totalStars());
  if (!hero && coat && !daily) out.push(`Ещё ${coat.stars - totalStars()} ★ до окраса «${coat.name}»`);
  const next = skyFor(totalStars()).next;
  if (next && !daily && next.left <= 3 && (!hero || starsMissing(hero) > next.left)) {
    out.push(`Ещё ${next.left} ★ до созвездия «${next.c.name}»`);
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
  journal.stats.levels++;
  saveJournal();
  let eyebrow: string;
  let opened: HeroDef[] = [];
  let best: number | undefined;
  /** Созвездие, которое собралось целиком на этом уровне. */
  let constellation: string | null = null;
  /** Окрас, открытый звёздами этого уровня. */
  let newCoat: string | null = null;
  if (daily) {
    best = dailyBest(daily);
    completeDaily(daily, time, quest.passed());
    eyebrow = `Лес дня пройден · ${timeText(time, best)}`;
  } else {
    const star = world.collected === world.crystals.length;
    const questDone = quest.passed();
    best = progress.records[level]?.time;
    const lockedBefore = HEROES.filter((h) => starsMissing(h) > 0);
    const coatsBefore = openCoats().length;
    const skyBefore = skyFor(totalStars()).done;
    completeLevel(level, star, questDone, time);
    const sky = skyFor(totalStars());
    if (sky.done > skyBefore) constellation = sky.lit[sky.done - 1].c.name;
    opened = lockedBefore.filter((h) => !starsMissing(h));
    newCoat = openCoats().length > coatsBefore ? openCoats().at(-1)!.name : null;
    select.refreshLocks();
    eyebrow = `Уровень ${level} пройден · ${timeText(time, best)}${star ? ' · ★ все кристаллы' : ''}${questDone ? ' · ★ задание' : ''}`;
  }
  const streak = markPlayedToday();
  const notes: string[] = [];
  if (streak === 1) notes.push('🔥 Серия началась — загляни в лес и завтра');
  else if (streak) notes.push(`🔥 ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд!`);
  // Новый день засчитан — у норы появилась новая деталь
  const grown = DECOR[daysPlayed() - 1];
  if (streak && grown && isOpen('den')) notes.push(`🌼 У норы появилось новое: ${grown.name}`);
  if (gathered) notes.push(`🧺 Для норы: ${amount(materialOf(layout.biome.id), gathered)}`);
  if (constellation) notes.push(`✦ Новое созвездие на небе: «${constellation}»`);
  if (newCoat) notes.push(`Открыт окрас «${newCoat}» — выбери его на экране героя`);
  notes.push(...almost(time, best, opened));
  if (daily) notes.push('Результатом можно поделиться — кнопка в меню под «Лесом дня»');
  // Достижения — первыми: это самое редкое, что бывает на экране итога; за ними — что открылось
  // (после достижений: первое из них открывает «Дневник»)
  const badges = checkAchievements().map((a) => `🏅 Достижение: «${a.name}» — ${a.desc[0].toLowerCase()}${a.desc.slice(1)}`);
  const unlocked = freshUnlocks();
  notes.unshift(...badges, ...unlocked.map((u) => `🔓 Открылось: ${u}`));
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
    else if (unlocked.length) say(`🔓 Открылось: ${unlocked.join('; ')}`, 4000);
    else if (constellation) say(`✦ Созвездие «${constellation}» — посмотри в меню «Небо»`, 3000);
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
  applyCoat(player.hero!, coatFor(def));
  clearInput();
  footsteps.reset();
  setState('play');
  canvas.focus();
  say(gameStarted ? def.name : `${currentLabel()} — собери кристаллы`);
  if (presetNote) {
    const note = presetNote;
    presetNote = null;
    setTimeout(() => say(note, 4500), 2200);
  }
  gameStarted = true;
}

function backToSelect(): void {
  rig.releaseLock();
  rig.cancelDrag();
  menu.closeInfo();
  select.setBiome(layout.biome);
  setState('select');
  select.chooseHero(player.hero?.def ?? select.selected);
}

function openDen(): void {
  rig.releaseLock();
  rig.cancelDrag();
  menu.closeInfo();
  den.setBiome(layout.biome);
  setState('den');
  den.open();
}

function openMenu(): void {
  if (isTransitioning()) return;
  den.close();
  rig.releaseLock();
  rig.cancelDrag();
  clearInput();
  rig.beginMenuOrbit(gameStarted ? player.pos : new Vector3(layout.spawn.x, world.terrainAt(layout.spawn.x, layout.spawn.z), layout.spawn.z));
  saveJournal();
  // Достижения за то, что случилось посреди уровня или в норе: сад, записки, километры
  const fresh = checkAchievements();
  // Находка посреди уровня могла открыть «Дневник» — сказать здесь, раз уж игрок в меню
  const unlocked = freshUnlocks();
  const news = [
    ...(fresh.length ? [`🏅 Достижение: «${fresh.map((a) => a.name).join('», «')}»`] : []),
    ...(unlocked.length ? [`🔓 Открылось: ${unlocked.join('; ')}`] : []),
  ];
  if (news.length) say(news.join(' · '), 3500 + 1000 * unlocked.length);
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
  // Апгрейд, купленный в норе посреди уровня, работает сразу
  applyStamina();
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
    case 'den':
      den.handleKey(e);
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
      if (e.code === 'KeyX' && !e.repeat) toggleWalk();
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
  if (state === 'den') return byId('den');
  return null;
}

/**
 * Кнопки геймпада вне движения и камеры: в игре Start — пауза, Y — режим камеры,
 * View/Back — настройки; в меню крестовина или стик водят фокус, A — выбрать, B — назад.
 */
function handleGamepad(): void {
  if (!gamepad.connected) return;
  if (isTransitioning()) {
    if (gamepad.pressed(BTN.A) || gamepad.pressed(BTN.B) || gamepad.pressed(BTN.START)) continueTransition();
    return;
  }
  if (gamepad.pressed(BTN.BACK)) {
    if (settingsPanel.isOpen) settingsPanel.close();
    else settingsPanel.open();
    return;
  }
  const screen = padScreen();
  if (!screen) {
    if (gamepad.pressed(BTN.START)) openMenu();
    else if (gamepad.pressed(BTN.Y)) rig.cycleMode();
    else if (gamepad.pressed(BTN.L3)) toggleWalk();
    return;
  }
  const dir = gamepad.nav();
  if (dir) navigate(screen, dir);
  if (settingsPanel.isOpen) {
    if (gamepad.pressed(BTN.LB)) settingsPanel.switchTab(-1);
    if (gamepad.pressed(BTN.RB)) settingsPanel.switchTab(1);
  } else if (state === 'menu') {
    if (gamepad.pressed(BTN.LB)) menu.switchTab(-1);
    if (gamepad.pressed(BTN.RB)) menu.switchTab(1);
  } else if (state === 'den') {
    if (gamepad.pressed(BTN.LB)) den.cycle(-1);
    if (gamepad.pressed(BTN.RB)) den.cycle(1);
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
    sparks.update(null, 0, 0);
    audio.setCombo(0);
    return;
  }

  const active = !settingsPanel.isOpen && !isTransitioning();
  if (active && boostPending) startBoost();
  if (active) levelTime += dt;
  const px = player.pos.x, pz = player.pos.z;
  const wasAir = !player.onGround, fallSpeed = -player.vel.y;
  // Ветер в спину — от длинной серии или от медовых сот в начале уровня
  const honey = activeBoost === 'honeycomb' && levelTime < HONEY_WIND;
  player.boost = combo.count >= WIND_FROM || honey ? WIND_BOOST : 1;
  player.update(dt, { yaw: rig.yaw, modeId: rig.mode.id }, active);
  if (active) {
    // Врезался в ствол или приземлился рядом — дерево вздрагивает и шелестит
    const landing = wasAir && player.onGround ? fallSpeed : 0;
    const heroR = 0.25 + 0.2 * player.hero.def.height;
    for (const h of world.touchTrees(player.pos, heroR, player.vel, landing)) {
      const dx = h.x - player.pos.x, dz = h.z - player.pos.z;
      const pan = (dx * Math.cos(rig.yaw) - dz * Math.sin(rig.yaw)) / Math.max(Math.hypot(dx, dz), 0.1);
      audio.rustle(h.strength, !!layout.biome.frost, pan);
    }
  }
  if (active) {
    const st = journal.stats;
    st.time += dt;
    // Скачок больше пары метров за кадр — это рестарт или телепорт, а не шаги
    const step = Math.hypot(player.pos.x - px, player.pos.z - pz);
    if (step < 2) st.distance += step;
    if (player.jumped) st.jumps++;
  }
  world.followSun(player.pos);
  rig.update(dt, player);
  footsteps.update(dt, player);
  // Запала почти нет — дышит часто, как на бегу
  const tired = player.energy < player.stamina.max * 0.25;
  breath.update(dt, player.hero, player.running || tired, !!layout.biome.frost);
  if (player.dashed) audio.whoosh(1);
  if (player.boosted) audio.whoosh(1.4);
  if (player.denied) audio.thud();
  setEnergy(player.energy, player.stamina.max, DASH_COST, dt, player.denied);
  updateFirefly();
  ripples.update(dt, player.pos, layout.waterLevel, world.waterDepth(player.pos.x, player.pos.z), -player.vel.y);

  const ended = combo.expire(levelTime);
  if (ended) endCombo(ended.record);
  setComboLeft(combo.left(levelTime));
  sparks.update(player.center, comboTier(combo.count), combo.left(levelTime));
  audio.setCombo(combo.count);
  const got = world.collectNear(player.center);
  if (got.length > 0) {
    journal.stats.crystals += got.length;
    player.addEnergy(CRYSTAL_ENERGY * got.length);
    const all = world.collected === world.crystals.length;
    const { count: n, reward } = combo.add(got.length, levelTime, journal.stats.bestCombo);
    journal.stats.bestCombo = Math.max(journal.stats.bestCombo, n);
    quest.onCombo(n);
    if (reward) {
      const m = materialOf(layout.biome.id);
      gathered += reward;
      addMaterial(m.id, reward);
      showCombo(n, comboTier(n), `+${amount(m, reward)} для норы`);
    } else {
      showCombo(n, comboTier(n));
    }
    audio.chime(all, n - 1);
    const windUp = n >= WIND_FROM && n - got.length < WIND_FROM;
    if (windUp) wind.gustNow(1.1, 0.5);
    if (!world.portalOpen && world.collected >= layout.required) {
      world.openPortal();
      audio.portalOpen();
      say(all ? 'Все кристаллы! ★ Портал открыт' : 'Портал открыт — он в каменном круге');
    } else {
      say(all ? 'Все кристаллы собраны! ★' : windUp ? 'Ветер в спину!' : '+1 кристалл');
    }
    if (got.includes(rare)) foundRare();
    updateCrystalsHud();
  }
  for (const id of world.collectPickups(player.center)) {
    gathered++;
    const n = addMaterial(id);
    const m = materialOf(layout.biome.id);
    audio.chime(false, 2);
    say(`+${amount(m, 1)} для норы · всего ${n}`);
  }
  if (world.takeNote(player.center)) {
    audio.chime(false);
    const where = welcomeNote ? 'Записка ждала тебя у круга' : 'Записка путника';
    takeWelcome();
    say(`${where}, ${journal.notes + 1} из ${NOTES.length}: «${addNote()}»`, 6000);
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
  (state === 'select' ? select.scene : state === 'den' ? den.scene : world.scene).render();
  tickFps(engine);
  autoScale.update(engine.getDeltaTime() / 1000, state === 'play' && !settingsPanel.isOpen && !isTransitioning());
});
addEventListener('resize', () => engine.resize());
// Телефон может выгрузить вкладку из фона — счётчики дневника сохраняются при уходе
addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && saveJournal());

// ---------- Старт ----------

applySettings(engine);
beginLevel(level);
setState('menu');
showCameraMode(rig.mode, false);
menu.update(null);
byId('m-new').focus();
void select.load();
// Ссылка «в гости»: сразу в нору друга; из неё — в своё меню
const visit = snapshotFromUrl();
if (visit) {
  den.setBiome(world.layout.biome);
  setState('den');
  den.open(visit);
} else if (visit === null) {
  clearUrl();
  say('Ссылка на нору не открылась — похоже, она обрезана', 3500);
}

// Для отладки из консоли браузера; в production-сборку не попадает
if (import.meta.env.DEV) Object.assign(window, { __game: { world, player, rig, select, den, beginLevel, get layout() { return layout; }, get quest() { return quest; } } });
